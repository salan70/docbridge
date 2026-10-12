//! Dart scanning on the tree-sitter-dart grammar.
//!
//! The behavior mirrors the shipped Dart worker (`scanner.dart`): the same
//! canonical IDs, visibility rules, `@doc` extraction, diagnostics, and
//! positions. Differences from the shipped worker are findings of the gate, not
//! corrections to make here.

use std::collections::HashSet;

use tree_sitter::{Node, Tree};

use crate::models::{
    CodeSymbol, Diagnostic, DocLink, Position, SourceLocation, SourceRange, WorkerFile,
    WorkerFileResponse,
};
use crate::position::PositionConverter;
use crate::syntax;

const PARSE_FALLBACK_DETAIL: &str = "Dart parser reported syntax errors.";
const CONSTRUCTOR_SIGNATURES: [&str; 4] = [
    "constructor_signature",
    "constant_constructor_signature",
    "factory_constructor_signature",
    "redirecting_factory_constructor_signature",
];
const MEMBER_SIGNATURES: [&str; 3] = ["function_signature", "getter_signature", "setter_signature"];
const VARIABLE_LISTS: [&str; 3] = [
    "initialized_identifier_list",
    "static_final_declaration_list",
    "identifier_list",
];

/// The shipped worker accepts a `visibility` option and ignores it: a Dart
/// declaration is visible when every name segment of its canonical ID is public.
pub fn scan_file(file: &WorkerFile, _visibility: Option<&[String]>) -> WorkerFileResponse {
    let language = tree_sitter_dart::LANGUAGE.into();
    let lines = PositionConverter::new(&file.content);
    let Some(tree) = syntax::parse(&language, &file.content) else {
        return parse_error_response(file, 1, 1, PARSE_FALLBACK_DETAIL);
    };
    // The shipped scanner reports the earliest of its errors, and a byte order
    // mark outside a string or comment is one of them.
    let syntax_error = first_syntax_error(&tree).map(|node| {
        (
            node.start_byte(),
            format!("syntax error near {}.", node.kind()),
        )
    });
    let byte_order_mark = first_stray_byte_order_mark(&tree, &file.content)
        .map(|offset| (offset, "Illegal character '65279'.".to_string()));
    let first_error = match (syntax_error, byte_order_mark) {
        (Some(syntax), Some(mark)) => Some(if mark.0 <= syntax.0 { mark } else { syntax }),
        (syntax, mark) => syntax.or(mark),
    };
    if let Some((offset, detail)) = first_error {
        let position = lines.position(offset);
        return parse_error_response(file, position.line, position.column, &detail);
    }

    let root = tree.root_node();
    let mut collector = Collector {
        source: &file.content,
        lines,
        comments: comment_spans(root),
        declarations: Vec::new(),
    };
    collector.collect(root);
    build_response(file, collector.declarations)
}

fn parse_error_response(
    file: &WorkerFile,
    line: usize,
    column: usize,
    detail: &str,
) -> WorkerFileResponse {
    WorkerFileResponse {
        file_path: file.file_path.clone(),
        symbols: vec![],
        undocumented_symbols: vec![],
        links: vec![],
        diagnostics: vec![diagnostic(
            "code_parse_error",
            &file.file_path,
            None,
            "error",
            format!("Dart parse error: {detail}"),
            at(&file.file_path, line, column),
            None,
        )],
    }
}

struct Declaration {
    symbol_name: String,
    canonical_id: String,
    line: usize,
    column: usize,
    visible: bool,
    unsupported: bool,
    name_range: Option<SourceRange>,
    declaration_range: Option<SourceRange>,
    signature_range: Option<SourceRange>,
    doc_targets: Vec<DocTarget>,
}

#[derive(Clone)]
struct DocTarget {
    target: String,
    line: usize,
    column: usize,
    range: SourceRange,
}

/// What every symbol of one source declaration shares: where it starts, where
/// it ends, and its `@doc` targets.
struct Shape {
    start: usize,
    end: usize,
    doc_targets: Vec<DocTarget>,
}

struct Collector<'a> {
    source: &'a str,
    lines: PositionConverter<'a>,
    /// Byte spans of every comment in document order.
    comments: Vec<(usize, usize)>,
    declarations: Vec<Declaration>,
}

impl<'a> Collector<'a> {
    /// Declarations only nest through types, so the walk is a fixed number of
    /// levels deep whatever the input holds.
    fn collect(&mut self, root: Node) {
        for node in children(root) {
            self.top_level(node);
        }
    }

    fn top_level(&mut self, node: Node) {
        match node.kind() {
            "function_declaration"
            | "getter_declaration"
            | "setter_declaration"
            | "external_function_declaration"
            | "external_getter_declaration"
            | "external_setter_declaration" => {
                let Some(signature) = node.child_by_field_name("signature") else {
                    return;
                };
                let Some(name) = signature.child_by_field_name("name") else {
                    return;
                };
                let signature_end = self.body_start(node, node);
                let shape = self.shape(node, node);
                let symbol_name = self.text(name).to_string();
                // `set` cannot name a type, so a function it types is a setter
                // the grammar failed to recognize.
                let setter = signature.kind() == "setter_signature"
                    || signature
                        .child_by_field_name("return_type")
                        .is_some_and(|return_type| self.text(return_type) == "set");
                let canonical_id = if setter {
                    format!("{symbol_name}=")
                } else {
                    symbol_name.clone()
                };
                self.record(&shape, name, symbol_name, canonical_id, signature_end);
            }
            "top_level_variable_declaration" | "external_variable_declaration" => {
                // `typedef` cannot name a type, so a variable it types is an
                // alias such as `typedef A = Future<void> Function();`.
                if children(node)
                    .iter()
                    .any(|child| child.kind() == "type" && self.text(*child) == "typedef")
                {
                    self.mark_unsupported_if_annotated(node);
                    return;
                }
                let shape = self.shape(node, node);
                for name in variable_names(node) {
                    let symbol_name = self.text(name).to_string();
                    let canonical_id = symbol_name.clone();
                    self.record(&shape, name, symbol_name, canonical_id, node.end_byte());
                }
            }
            "class_declaration" | "enum_declaration" | "mixin_declaration" => {
                match node.child_by_field_name("name") {
                    Some(name) => {
                        let shape = self.shape(node, node);
                        let symbol_name = self.text(name).to_string();
                        let signature_end = node
                            .child_by_field_name("body")
                            .map_or(node.end_byte(), |body| body.start_byte());
                        self.record(
                            &shape,
                            name,
                            symbol_name.clone(),
                            symbol_name.clone(),
                            signature_end,
                        );
                        self.members(node, &symbol_name, Some(&symbol_name));
                    }
                    None => self.mark_unsupported_if_annotated(node),
                }
            }
            "extension_declaration" => {
                // An extension produces no symbol; its members qualify against
                // the extended type.
                let qualifier = node
                    .child_by_field_name("class")
                    .map(|extended| self.extended_type_name(extended))
                    .unwrap_or_default();
                if !qualifier.is_empty() {
                    self.members(node, &qualifier, None);
                }
            }
            "type_alias" | "extension_type_declaration" => {
                self.mark_unsupported_if_annotated(node);
            }
            _ => {}
        }
    }

    /// `owner` is the name of the type that declares the members, which an
    /// extension does not have.
    fn members(&mut self, declaration: Node, qualifier: &str, owner: Option<&str>) {
        let Some(body) = declaration.child_by_field_name("body") else {
            return;
        };
        for member in children(body) {
            if member.kind() == "class_member" {
                self.member(member, qualifier, owner);
            }
        }
    }

    fn member(&mut self, node: Node, qualifier: &str, owner: Option<&str>) {
        let Some(inner) = children(node)
            .into_iter()
            .find(|child| matches!(child.kind(), "declaration" | "method_declaration"))
        else {
            return;
        };
        let shape = self.shape(node, node);
        let signature = member_signature(inner);
        let kind = signature.map(|signature| signature.kind());
        match (signature, kind) {
            (Some(_), Some("operator_signature")) => {}
            (Some(signature), Some(kind)) if MEMBER_SIGNATURES.contains(&kind) => {
                let Some(name) = signature.child_by_field_name("name") else {
                    return;
                };
                let signature_end = self.body_start(inner, node);
                let symbol_name = self.text(name).to_string();
                let canonical_id = format!("{qualifier}.{}", setter_suffixed(&symbol_name, kind));
                self.record(&shape, name, symbol_name, canonical_id, signature_end);
            }
            (Some(signature), Some(kind)) if CONSTRUCTOR_SIGNATURES.contains(&kind) => {
                let mut cursor = signature.walk();
                let names: Vec<Node> = signature
                    .children_by_field_name("name", &mut cursor)
                    .filter(|name| name.kind() != ".")
                    .collect();
                drop(cursor);
                let (Some(first), constructor_name) = (names.first().copied(), names.get(1)) else {
                    return;
                };
                let signature_end = self.body_start(inner, node);
                // The grammar reads a method without a return type as an
                // unnamed constructor; it is one only in the type it names.
                let is_method = kind == "constructor_signature"
                    && constructor_name.is_none()
                    && owner != Some(self.text(first));
                if is_method {
                    let symbol_name = self.text(first).to_string();
                    let canonical_id = format!("{qualifier}.{symbol_name}");
                    self.record(&shape, first, symbol_name, canonical_id, signature_end);
                    return;
                }
                let name_token = constructor_name.copied().unwrap_or(first);
                let symbol_name = constructor_name
                    .map_or("new", |name| self.text(*name))
                    .to_string();
                let canonical_id = format!("{qualifier}.{symbol_name}");
                self.record(&shape, name_token, symbol_name, canonical_id, signature_end);
            }
            (None, _) => {
                for name in variable_names(inner) {
                    let symbol_name = self.text(name).to_string();
                    let canonical_id = format!("{qualifier}.{symbol_name}");
                    self.record(&shape, name, symbol_name, canonical_id, node.end_byte());
                }
            }
            _ => {}
        }
    }

    fn record(
        &mut self,
        shape: &Shape,
        name: Node,
        symbol_name: String,
        canonical_id: String,
        signature_end: usize,
    ) {
        let location = self.lines.position(name.start_byte());
        let visible = is_public_canonical(&canonical_id);
        let name_range = self.range(name.start_byte(), name.end_byte());
        let declaration_range = self.range(shape.start, shape.end);
        let signature_range = self.range(shape.start, signature_end);
        self.declarations.push(Declaration {
            symbol_name,
            canonical_id,
            line: location.line,
            column: location.column,
            visible,
            unsupported: false,
            name_range: Some(name_range),
            declaration_range: Some(declaration_range),
            signature_range: Some(signature_range),
            doc_targets: shape.doc_targets.clone(),
        });
    }

    fn mark_unsupported_if_annotated(&mut self, node: Node) {
        let shape = self.shape(node, node);
        if shape.doc_targets.is_empty() {
            return;
        }
        let (_, first) = leading_tokens(node);
        let location = self.lines.position(first);
        self.declarations.push(Declaration {
            symbol_name: String::new(),
            canonical_id: String::new(),
            line: location.line,
            column: location.column,
            visible: true,
            unsupported: true,
            name_range: None,
            declaration_range: None,
            signature_range: None,
            doc_targets: shape.doc_targets,
        });
    }

    /// The start of the first token after the metadata, which ends the
    /// signature of a member that has no body: the `;` that closes it.
    fn body_start(&self, inner: Node, outer: Node) -> usize {
        if let Some(body) = inner.child_by_field_name("body") {
            return body.start_byte();
        }
        children(outer)
            .into_iter()
            .chain(children(inner))
            .find(|child| child.kind() == ";")
            .map_or(outer.end_byte(), |semicolon| semicolon.start_byte())
    }

    /// `outer` is the node whose tokens bound the declaration, `leading` the
    /// one that carries the metadata.
    fn shape(&self, outer: Node, leading: Node) -> Shape {
        let (metadata, first) = leading_tokens(leading);
        let doc = self.documentation_comment(&metadata, first);
        let start = doc.map_or(first, |(start, _)| start);
        let doc_targets = doc
            .map(|(start, end)| self.doc_targets(start, end))
            .unwrap_or_default();
        Shape {
            start,
            end: outer.end_byte(),
            doc_targets,
        }
    }

    /// The documentation comment of a declaration: the one before the first
    /// token after the metadata, else the one before the last annotation that
    /// has one.
    fn documentation_comment(&self, metadata: &[usize], first: usize) -> Option<(usize, usize)> {
        self.dart_doc(first).or_else(|| {
            metadata
                .iter()
                .rev()
                .find_map(|start| self.dart_doc(*start))
        })
    }

    /// The comments between the token before `position` and `position`.
    fn preceding_comments(&self, position: usize) -> &[(usize, usize)] {
        let end = self.comments.partition_point(|span| span.1 <= position);
        let mut start = end;
        let mut limit = position;
        while start > 0 {
            let (comment_start, comment_end) = self.comments[start - 1];
            if !self.source[comment_end..limit]
                .chars()
                .all(char::is_whitespace)
            {
                break;
            }
            start -= 1;
            limit = comment_start;
        }
        &self.comments[start..end]
    }

    /// The span of the dartdoc before `position`, following the analyzer's
    /// `findDartDoc`: the first `///` line, unless a `/**` block follows it, in
    /// which case the last block; a `///` line after a block starts over. A
    /// run of `///` lines extends to the last one, and non-doc comments between
    /// the lines belong to the span.
    fn dart_doc(&self, position: usize) -> Option<(usize, usize)> {
        let comments = self.preceding_comments(position);
        let mut found: Option<usize> = None;
        let mut line_run = false;
        for (index, (start, end)) in comments.iter().enumerate() {
            let text = &self.source[*start..*end];
            if text.starts_with("///") {
                if !line_run {
                    found = Some(index);
                    line_run = true;
                }
            } else if text.starts_with("/**") {
                found = Some(index);
                line_run = false;
            }
        }
        let first = found?;
        if !line_run {
            return Some(comments[first]);
        }
        let last = comments[first..]
            .iter()
            .rev()
            .find(|(start, end)| self.source[*start..*end].starts_with("///"))?;
        Some((comments[first].0, last.1))
    }

    fn doc_targets(&self, start: usize, end: usize) -> Vec<DocTarget> {
        let text = &self.source[start..end];
        doc_matches(text)
            .into_iter()
            .map(|(offset, target)| {
                let begin = self.lines.position(start + offset);
                let length = target.encode_utf16().count();
                DocTarget {
                    target: target.to_string(),
                    line: begin.line,
                    column: begin.column,
                    range: SourceRange {
                        start: begin.clone(),
                        end: Position {
                            line: begin.line,
                            column: begin.column + length,
                        },
                    },
                }
            })
            .collect()
    }

    fn range(&self, start: usize, end: usize) -> SourceRange {
        SourceRange {
            start: self.lines.position(start),
            end: self.lines.position(end),
        }
    }

    fn text(&self, node: Node) -> &'a str {
        &self.source[node.start_byte()..node.end_byte()]
    }

    /// The analyzer's `toSource()` of the extended type up to the first `<`.
    fn extended_type_name(&self, extended: Node) -> String {
        let parts = children(extended);
        let named_type = parts.iter().all(|part| {
            matches!(
                part.kind(),
                "type_identifier" | "." | "?" | "type_arguments"
            )
        });
        let text = if named_type {
            parts
                .iter()
                .take_while(|part| part.kind() != "type_arguments")
                .map(|part| self.text(*part))
                .collect::<String>()
        } else {
            self.text(extended).to_string()
        };
        text.split('<').next().unwrap_or("").trim().to_string()
    }
}

/// The first `ERROR` or `MISSING` node, or else the deepest node that has an
/// error below it. The grammar inserts a zero-width `identifier` for a missing
/// name (`class { }`, `1 +;`); it carries the error flag but is neither `ERROR`
/// nor `MISSING`, so `syntax::first_error` does not report it.
fn first_syntax_error(tree: &Tree) -> Option<Node<'_>> {
    if let Some(node) = syntax::first_error(tree) {
        return Some(node);
    }
    let mut node = tree.root_node();
    if !node.has_error() {
        return None;
    }
    while let Some(child) = children(node).into_iter().find(|child| child.has_error()) {
        node = child;
    }
    Some(node)
}

/// The offset of the first U+FEFF that is not inside a comment or the text of
/// a string, where the Dart scanner reads it as an illegal character.
fn first_stray_byte_order_mark(tree: &Tree, source: &str) -> Option<usize> {
    let root = tree.root_node();
    source
        .match_indices('\u{feff}')
        .map(|(offset, mark)| (offset, offset + mark.len()))
        .find(|(start, end)| {
            let kind = root
                .descendant_for_byte_range(*start, *end)
                .map(|node| node.kind());
            !kind.is_some_and(|kind| {
                matches!(
                    kind,
                    "comment" | "block_comment" | "documentation_block_comment"
                ) || kind.starts_with("template_chars")
                    || kind.starts_with("raw_string_literal")
            })
        })
        .map(|(start, _)| start)
}

fn children(node: Node) -> Vec<Node> {
    let mut cursor = node.walk();
    node.children(&mut cursor).collect()
}

/// Spans of every comment under `root`, in document order. The walk keeps no
/// call stack per level.
fn comment_spans(root: Node) -> Vec<(usize, usize)> {
    let mut spans = Vec::new();
    let mut cursor = root.walk();
    loop {
        let node = cursor.node();
        if node.kind() == "comment" {
            spans.push((node.start_byte(), node.end_byte()));
        } else if cursor.goto_first_child() {
            continue;
        }
        while !cursor.goto_next_sibling() {
            if !cursor.goto_parent() {
                return spans;
            }
        }
    }
}

/// The start of each annotation in the metadata of `node`, and the start of
/// the first token after the metadata. A member's annotations sit on the
/// `class_member` or on the declaration inside it.
fn leading_tokens(node: Node) -> (Vec<usize>, usize) {
    let mut metadata = Vec::new();
    let mut current = node;
    loop {
        let mut next = None;
        for child in children(current) {
            match child.kind() {
                "annotation" => metadata.push(child.start_byte()),
                "comment" => {}
                _ => {
                    next = Some(child);
                    break;
                }
            }
        }
        let Some(child) = next else {
            return (metadata, current.start_byte());
        };
        let wrapper = matches!(child.kind(), "declaration" | "method_declaration");
        if current.kind() == "class_member" && wrapper {
            current = child;
            continue;
        }
        return (metadata, child.start_byte());
    }
}

/// The signature of a class member: the signature node itself, or the one
/// inside its `method_signature`. A field has none.
fn member_signature(inner: Node) -> Option<Node> {
    let is_signature = |kind: &str| {
        MEMBER_SIGNATURES.contains(&kind)
            || CONSTRUCTOR_SIGNATURES.contains(&kind)
            || kind == "operator_signature"
    };
    for child in children(inner) {
        if is_signature(child.kind()) {
            return Some(child);
        }
        if child.kind() == "method_signature" {
            return children(child)
                .into_iter()
                .find(|part| is_signature(part.kind()));
        }
    }
    None
}

/// The name node of every variable a declaration introduces.
fn variable_names(declaration: Node) -> Vec<Node> {
    let mut names = Vec::new();
    for list in children(declaration) {
        if !VARIABLE_LISTS.contains(&list.kind()) {
            continue;
        }
        for entry in children(list) {
            match entry.kind() {
                "identifier" => names.push(entry),
                "initialized_identifier" | "static_final_declaration" => {
                    names.extend(entry.child_by_field_name("name"));
                }
                _ => {}
            }
        }
    }
    names
}

fn setter_suffixed(name: &str, signature_kind: &str) -> String {
    if signature_kind == "setter_signature" {
        format!("{name}=")
    } else {
        name.to_string()
    }
}

/// A Dart endpoint is public only when every name segment of its canonical ID
/// is public.
fn is_public_canonical(canonical_id: &str) -> bool {
    canonical_id.split('.').all(|segment| {
        let name = segment.strip_suffix('=').unwrap_or(segment);
        !name.starts_with('_')
    })
}

/// Whether the character is `\s` in Dart regular expressions, which follow
/// JavaScript: white space and line terminators.
fn is_regex_space(character: char) -> bool {
    matches!(
        character,
        '\t'..='\r' | ' ' | '\u{a0}' | '\u{1680}' | '\u{2000}'..='\u{200a}' | '\u{2028}'
            | '\u{2029}' | '\u{202f}' | '\u{205f}' | '\u{3000}' | '\u{feff}'
    )
}

/// Every `@doc\s+(\S+)` match in `text` as the byte offset and text of the
/// target.
fn doc_matches(text: &str) -> Vec<(usize, &str)> {
    let mut matches = Vec::new();
    let mut from = 0;
    while let Some(found) = text[from..].find("@doc") {
        let start = from + found;
        let after_tag = start + "@doc".len();
        let target_start = skip_while(text, after_tag, is_regex_space);
        let target_end = skip_while(text, target_start, |character| !is_regex_space(character));
        if target_start == after_tag || target_end == target_start {
            from = start + 1;
            continue;
        }
        matches.push((target_start, &text[target_start..target_end]));
        from = target_end;
    }
    matches
}

fn skip_while(text: &str, from: usize, predicate: impl Fn(char) -> bool) -> usize {
    text[from..]
        .char_indices()
        .find(|(_, character)| !predicate(*character))
        .map_or(text.len(), |(index, _)| from + index)
}

fn build_response(file: &WorkerFile, declarations: Vec<Declaration>) -> WorkerFileResponse {
    let path = file.file_path.as_str();
    let mut symbols: Vec<CodeSymbol> = Vec::new();
    let mut undocumented: Vec<CodeSymbol> = Vec::new();
    let mut links: Vec<DocLink> = Vec::new();
    let mut diagnostics: Vec<Diagnostic> = Vec::new();
    let mut seen_endpoints: HashSet<String> = HashSet::new();
    let mut duplicate_endpoints: HashSet<String> = HashSet::new();

    for declaration in declarations {
        if declaration.unsupported {
            diagnostics.push(diagnostic(
                "unsupported_declaration",
                path,
                None,
                "error",
                "Dart declaration annotated with @doc is not supported.".to_string(),
                at(path, declaration.line, declaration.column),
                declaration.name_range.clone(),
            ));
            continue;
        }
        if !declaration.visible {
            continue;
        }

        let symbol = make_symbol(path, &declaration);
        if declaration.doc_targets.is_empty() {
            if !undocumented
                .iter()
                .any(|existing| existing.endpoint == symbol.endpoint)
            {
                undocumented.push(symbol);
            }
            continue;
        }

        if seen_endpoints.contains(&symbol.endpoint) {
            if !duplicate_endpoints.contains(&symbol.endpoint) {
                diagnostics.push(diagnostic(
                    "duplicate_code_symbol",
                    &symbol.endpoint,
                    None,
                    "error",
                    format!("Duplicate Dart code symbol endpoint: {}", symbol.endpoint),
                    at(path, declaration.line, declaration.column),
                    declaration.name_range.clone(),
                ));
                duplicate_endpoints.insert(symbol.endpoint.clone());
            }
            continue;
        }
        seen_endpoints.insert(symbol.endpoint.clone());
        let endpoint = symbol.endpoint.clone();
        symbols.push(symbol);

        let mut seen_targets: HashSet<&str> = HashSet::new();
        for doc in &declaration.doc_targets {
            if !is_valid_link_target(&doc.target, path) {
                diagnostics.push(diagnostic(
                    "invalid_link_target",
                    &doc.target,
                    Some(&endpoint),
                    "error",
                    "Link target must be a project-root-relative file path and fragment in file#fragment form."
                        .to_string(),
                    at(path, doc.line, doc.column),
                    Some(doc.range.clone()),
                ));
                continue;
            }
            if !seen_targets.insert(doc.target.as_str()) {
                diagnostics.push(diagnostic(
                    "duplicate_link",
                    &doc.target,
                    Some(&endpoint),
                    "warning",
                    format!("Duplicate @doc link from {endpoint} to {}.", doc.target),
                    at(path, doc.line, doc.column),
                    Some(doc.range.clone()),
                ));
                continue;
            }
            links.push(DocLink {
                source: endpoint.clone(),
                target: doc.target.clone(),
                location: at(path, doc.line, doc.column),
                target_range: Some(doc.range.clone()),
            });
        }
    }

    WorkerFileResponse {
        file_path: file.file_path.clone(),
        symbols,
        undocumented_symbols: undocumented,
        links,
        diagnostics,
    }
}

fn make_symbol(path: &str, declaration: &Declaration) -> CodeSymbol {
    CodeSymbol {
        kind: "code".to_string(),
        language: "dart".to_string(),
        file_path: path.to_string(),
        symbol_name: declaration.symbol_name.clone(),
        canonical_id: declaration.canonical_id.clone(),
        endpoint: format!("{path}#{}", declaration.canonical_id),
        location: at(path, declaration.line, declaration.column),
        name_range: declaration.name_range.clone(),
        declaration_range: declaration.declaration_range.clone(),
        signature_range: declaration.signature_range.clone(),
    }
}

fn diagnostic(
    code: &str,
    target: &str,
    source: Option<&str>,
    severity: &str,
    message: String,
    location: SourceLocation,
    range: Option<SourceRange>,
) -> Diagnostic {
    Diagnostic {
        severity: severity.to_string(),
        code: code.to_string(),
        target: target.to_string(),
        language: Some("dart".to_string()),
        source: source.map(str::to_string),
        message,
        location: Some(location),
        range,
    }
}

fn at(path: &str, line: usize, column: usize) -> SourceLocation {
    SourceLocation {
        file_path: path.to_string(),
        line,
        column,
    }
}

fn is_valid_link_target(target: &str, source_file_path: &str) -> bool {
    let parts: Vec<&str> = target.split('#').collect();
    let [file_path, fragment] = parts[..] else {
        return false;
    };
    !file_path.is_empty()
        && !file_path.starts_with('/')
        && !file_path.starts_with("./")
        && !file_path.starts_with("../")
        && !file_path.contains('\\')
        && !file_path.chars().any(is_regex_space)
        && !file_path.split('/').any(|segment| segment == "..")
        && file_path != source_file_path
        && !fragment.is_empty()
        && !fragment.chars().any(is_regex_space)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn scan(source: &str, visibility: Option<&[&str]>) -> WorkerFileResponse {
        let file = WorkerFile {
            file_path: "lib/a.dart".to_string(),
            content: source.to_string(),
        };
        let visibility: Option<Vec<String>> =
            visibility.map(|levels| levels.iter().map(|level| level.to_string()).collect());
        scan_file(&file, visibility.as_deref())
    }

    fn ids(symbols: &[CodeSymbol]) -> Vec<&str> {
        symbols
            .iter()
            .map(|symbol| symbol.canonical_id.as_str())
            .collect()
    }

    fn codes(response: &WorkerFileResponse) -> Vec<&str> {
        response
            .diagnostics
            .iter()
            .map(|diagnostic| diagnostic.code.as_str())
            .collect()
    }

    #[test]
    fn members_qualify_by_type_and_setters_carry_an_equals_sign() {
        let source = "set top(int v) {}\nclass A {\n  A();\n  A.named();\n  int x = 1, y = 2;\n  int get g => 1;\n  set g(int v) {}\n  void run() {}\n  bool operator ==(Object o) => true;\n}\n";
        let response = scan(source, None);
        assert_eq!(
            ids(&response.undocumented_symbols),
            ["top=", "A", "A.new", "A.named", "A.x", "A.y", "A.g", "A.g=", "A.run"]
        );
        let unnamed = &response.undocumented_symbols[2];
        assert_eq!(unnamed.symbol_name, "new");
        let name = unnamed.name_range.as_ref().expect("name range");
        assert_eq!(
            (name.start.line, name.start.column, name.end.column),
            (3, 3, 4)
        );
    }

    #[test]
    fn a_method_without_a_return_type_is_not_a_constructor() {
        let response = scan("class A {\n  A();\n  run() {}\n}\n", None);
        assert_eq!(ids(&response.undocumented_symbols), ["A", "A.new", "A.run"]);
    }

    #[test]
    fn private_names_are_hidden_and_the_visibility_option_is_ignored() {
        let source = "class _P { void m() {} }\nclass A { void _m() {} void m() {} }\n";
        let response = scan(source, Some(&["private"]));
        assert_eq!(ids(&response.undocumented_symbols), ["A", "A.m"]);
    }

    #[test]
    fn extension_members_qualify_by_the_extended_type() {
        let source = "extension Named<T> on List<T> {\n  int get size => 1;\n}\nextension on _Hidden {\n  void m() {}\n}\n";
        let response = scan(source, None);
        assert_eq!(ids(&response.undocumented_symbols), ["List.size"]);
    }

    #[test]
    fn a_doc_run_spans_the_plain_comments_between_its_lines() {
        let source =
            "/// @doc docs/a.md#one\n// plain\n/// @doc docs/a.md#two\n@deprecated\nvoid f() {}\n";
        let response = scan(source, None);
        assert!(response.diagnostics.is_empty());
        assert_eq!(response.links.len(), 2);
        let range = response.symbols[0]
            .declaration_range
            .as_ref()
            .expect("declaration range");
        assert_eq!((range.start.line, range.start.column), (1, 1));
        let signature = response.symbols[0]
            .signature_range
            .as_ref()
            .expect("signature range");
        assert_eq!((signature.end.line, signature.end.column), (5, 10));
    }

    #[test]
    fn a_block_after_a_line_run_replaces_it() {
        let source = "/// @doc docs/a.md#line\n/** @doc docs/a.md#block */\nvoid f() {}\n";
        let response = scan(source, None);
        assert_eq!(response.links.len(), 1);
        assert_eq!(response.links[0].target, "docs/a.md#block");
    }

    #[test]
    fn a_setter_the_grammar_reads_as_a_function_is_still_a_setter() {
        // As the last declaration of the file, the grammar gives the setter
        // the return type `set`.
        let response = scan("int get top => 1;\nset top(int v) {}\n", None);
        assert_eq!(ids(&response.undocumented_symbols), ["top", "top="]);
    }

    #[test]
    fn a_function_type_alias_the_grammar_reads_as_a_variable_is_an_alias() {
        let source = "typedef Callback = Future<void> Function();\nint a = 1;\n";
        let response = scan(source, None);
        assert_eq!(ids(&response.undocumented_symbols), ["a"]);
        assert!(response.diagnostics.is_empty());

        let annotated = format!("/// @doc docs/a.md#t\n{source}");
        assert_eq!(codes(&scan(&annotated, None)), ["unsupported_declaration"]);
    }

    #[test]
    fn an_annotated_typedef_is_unsupported() {
        let response = scan("/// @doc docs/a.md#t\ntypedef T = int;\n", None);
        assert_eq!(codes(&response), ["unsupported_declaration"]);
        let location = response.diagnostics[0].location.as_ref().expect("location");
        assert_eq!((location.line, location.column), (2, 1));
    }

    #[test]
    fn duplicate_endpoint_and_links_are_reported_once() {
        let source = "/// @doc a.md#x\n/// @doc a.md#x\nvoid f() {}\n/// @doc a.md#y\nvoid f() {}\n/// @doc /a.md#y\nvoid g() {}\n";
        let response = scan(source, None);
        assert_eq!(
            codes(&response),
            [
                "duplicate_link",
                "duplicate_code_symbol",
                "invalid_link_target"
            ]
        );
        assert_eq!(response.diagnostics[0].severity, "warning");
    }

    #[test]
    fn target_whitespace_follows_the_dart_regular_expression_class() {
        // U+FEFF is `\s` in a Dart regular expression.
        let response = scan("/// @doc\u{feff}a.md#x\nvoid f() {}\n", None);
        assert_eq!(response.links.len(), 1);
        assert_eq!(response.links[0].target, "a.md#x");
    }

    #[test]
    fn a_syntax_error_yields_one_diagnostic_and_nothing_else() {
        let response = scan("class A {}\nclass {\n", None);
        assert_eq!(codes(&response), ["code_parse_error"]);
        assert!(response.symbols.is_empty());
        assert!(response.undocumented_symbols.is_empty());
    }

    #[test]
    fn a_missing_name_is_a_syntax_error() {
        let response = scan("class { }\n", None);
        assert_eq!(codes(&response), ["code_parse_error"]);
    }

    #[test]
    fn a_byte_order_mark_is_a_syntax_error_outside_strings_and_comments() {
        assert_eq!(
            codes(&scan("\u{feff}class A {}\n", None)),
            ["code_parse_error"]
        );
        let inside = scan("class A { String s = \"\u{feff}\"; // \u{feff}\n}\n", None);
        assert!(inside.diagnostics.is_empty());
    }

    #[test]
    fn deeply_nested_input_does_not_overflow_the_stack() {
        let depth = 20_000;
        let source = format!(
            "void f() {{ var x = {}1{}; }}\n/// @doc a.md#b\nclass A {{}}\n",
            "(".repeat(depth),
            ")".repeat(depth)
        );
        let response = scan(&source, None);
        assert_eq!(ids(&response.symbols), ["A"]);
    }

    #[test]
    fn doc_matches_follow_the_regular_expression() {
        assert_eq!(doc_matches("@doc a#b @doc"), [(5, "a#b")]);
        assert_eq!(doc_matches("@docs a#b"), []);
        assert_eq!(doc_matches("@doc\n@doc x#y"), [(5, "@doc")]);
    }
}
