//! Swift scanning on the tree-sitter-swift grammar.
//!
//! The behavior mirrors the shipped Swift worker (`Scanner.swift`): the same
//! canonical IDs, visibility rules, `@doc` extraction, diagnostics, and
//! positions. Differences from the shipped worker are findings of the gate, not
//! corrections to make here.

use std::collections::HashSet;
use std::ops::Range;

use tree_sitter::Node;

use crate::models::{
    CodeSymbol, Diagnostic, DocLink, Position, SourceLocation, SourceRange, WorkerFile,
    WorkerFileResponse,
};
use crate::position::PositionConverter;
use crate::syntax::{self, Scope};

const ACCESS_KEYWORDS: [&str; 5] = ["open", "public", "internal", "fileprivate", "private"];
const DEFAULT_VISIBILITY: [&str; 2] = ["public", "open"];
const PARSE_FALLBACK_DETAIL: &str = "Swift parser reported syntax errors.";

pub fn scan_file(
    file: &WorkerFile,
    visibility: Option<&[String]>,
    scope: Scope,
) -> WorkerFileResponse {
    let language = tree_sitter_swift::LANGUAGE.into();
    let Some(tree) = syntax::parse(&language, &file.content) else {
        return parse_error_response(file, 1, 1, PARSE_FALLBACK_DETAIL);
    };
    let first_error = syntax::first_error(&tree);
    if let (Some(node), Scope::File) = (first_error, scope) {
        return reject_file(file, node);
    }

    let allowed: HashSet<&str> = match visibility {
        Some(levels) => levels.iter().map(String::as_str).collect(),
        None => DEFAULT_VISIBILITY.into_iter().collect(),
    };
    let mut collector = Collector {
        source: &file.content,
        converter: PositionConverter::new(&file.content),
        visibility: allowed,
        declarations: Vec::new(),
    };
    collector.collect(tree.root_node());
    let Some(first_error) = first_error else {
        return build_response(file, collector.declarations, Vec::new());
    };

    let spans: Vec<Range<usize>> = collector
        .declarations
        .iter()
        .filter(|declaration| !declaration.unsupported)
        .map(|declaration| declaration.span.clone())
        .collect();
    let Some(regions) = syntax::error_regions(&syntax::all_errors(&tree), &spans) else {
        return reject_file(file, first_error);
    };
    let mut errors = Vec::new();
    let mut kept = Vec::new();
    for declaration in collector.declarations {
        if !syntax::is_dropped(&declaration.span, &regions) {
            kept.push(declaration);
            continue;
        }
        let region = regions
            .iter()
            .find(|region| region.span == declaration.span && !declaration.unsupported);
        if let Some(region) = region {
            let position = collector.converter.position(region.error_start);
            errors.push(diagnostic(
                "code_parse_error",
                &format!("{}#{}", file.file_path, declaration.canonical_id),
                None,
                "error",
                format!(
                    "Swift parse error: syntax error near {}.",
                    region.error_kind
                ),
                at(&file.file_path, position.line, position.column),
                None,
            ));
        }
    }
    build_response(file, kept, errors)
}

fn reject_file(file: &WorkerFile, node: Node) -> WorkerFileResponse {
    let position = PositionConverter::new(&file.content).position(node.start_byte());
    let detail = format!("syntax error near {}.", node.kind());
    parse_error_response(file, position.line, position.column, &detail)
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
            format!("Swift parse error: {detail}"),
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
    /// The bytes of the declaration node, without its doc comments.
    span: Range<usize>,
}

struct DocTarget {
    target: String,
    line: usize,
    column: usize,
    range: SourceRange,
}

/// A declaration or statement in a scope, with the comments before it.
struct Item<'t> {
    node: Node<'t>,
    comments: Vec<Node<'t>>,
    /// End of the token before the comments, which ends the line the first
    /// comment may trail.
    previous_end: Option<usize>,
}

/// The members of one scope still to visit. Scopes are kept on an explicit
/// stack so nesting depth never becomes call depth.
struct Frame<'t> {
    items: Vec<Item<'t>>,
    next: usize,
    qualifier: Option<String>,
}

struct Collector<'a> {
    source: &'a str,
    converter: PositionConverter<'a>,
    visibility: HashSet<&'a str>,
    declarations: Vec<Declaration>,
}

impl<'a> Collector<'a> {
    fn collect<'t>(&mut self, root: Node<'t>) {
        let mut stack = vec![Frame {
            items: scope_items(root),
            next: 0,
            qualifier: None,
        }];
        while let Some(frame) = stack.last_mut() {
            let Some(item) = frame.items.get_mut(frame.next) else {
                stack.pop();
                continue;
            };
            let item = Item {
                node: item.node,
                comments: std::mem::take(&mut item.comments),
                previous_end: item.previous_end,
            };
            frame.next += 1;
            let qualifier = frame.qualifier.clone();
            if let Some(child) = self.handle(&item, qualifier.as_deref()) {
                stack.push(child);
            }
        }
    }

    /// Record the declaration `node` stands for. Returns the scope of its
    /// members when it has any worth visiting.
    fn handle<'t>(&mut self, item: &Item<'t>, qualifier: Option<&str>) -> Option<Frame<'t>> {
        let node = item.node;
        match node.kind() {
            "class_declaration" => {
                let name = node.child_by_field_name("name")?;
                let is_extension = node
                    .child_by_field_name("declaration_kind")
                    .is_some_and(|kind| kind.kind() == "extension");
                if is_extension {
                    // An extension produces no symbol; its members qualify
                    // against the extended type.
                    return self.members(node, Some(self.text(name).to_string()));
                }
                self.handle_type(item, name, qualifier)
            }
            "protocol_declaration" => {
                let name = node.child_by_field_name("name")?;
                self.handle_type(item, name, qualifier)
            }
            "function_declaration" | "protocol_function_declaration" => {
                if let Some(name) = node.child_by_field_name("name") {
                    let symbol_name = self.text(name).to_string();
                    let labels = self.argument_labels(node);
                    let canonical_id = format!("{}{symbol_name}({labels})", prefix(qualifier));
                    let signature_end = signature_end(node);
                    self.record(item, symbol_name, canonical_id, name, signature_end);
                } else {
                    self.mark_unsupported_if_annotated(item);
                }
                None
            }
            "init_declaration" => {
                let keyword = children(node)
                    .into_iter()
                    .find(|child| !child.is_named() && child.kind() == "init");
                if let Some(keyword) = keyword {
                    let labels = self.argument_labels(node);
                    let canonical_id = format!("{}init({labels})", prefix(qualifier));
                    let signature_end = signature_end(node);
                    self.record(
                        item,
                        "init".to_string(),
                        canonical_id,
                        keyword,
                        signature_end,
                    );
                } else {
                    self.mark_unsupported_if_annotated(item);
                }
                None
            }
            "property_declaration" | "protocol_property_declaration" => {
                let identifier = node
                    .child_by_field_name("name")
                    .and_then(|pattern| pattern.child_by_field_name("bound_identifier"));
                if let Some(identifier) = identifier {
                    let symbol_name = self.text(identifier).to_string();
                    let canonical_id = format!("{}{symbol_name}", prefix(qualifier));
                    self.record(item, symbol_name, canonical_id, identifier, node.end_byte());
                } else {
                    self.mark_unsupported_if_annotated(item);
                }
                None
            }
            _ => {
                self.mark_unsupported_if_annotated(item);
                None
            }
        }
    }

    fn handle_type<'t>(
        &mut self,
        item: &Item<'t>,
        name: Node<'t>,
        qualifier: Option<&str>,
    ) -> Option<Frame<'t>> {
        let node = item.node;
        let symbol_name = self.text(name).to_string();
        let canonical_id = match qualifier {
            Some(qualifier) => format!("{qualifier}.{symbol_name}"),
            None => symbol_name.clone(),
        };
        let signature_end = children(node)
            .into_iter()
            .filter(|child| child.kind() == "inheritance_specifier")
            .map(|child| child.end_byte())
            .next_back()
            .unwrap_or_else(|| name.end_byte());
        // Members qualify by the bare type name, not the canonical ID of a
        // nested type, as in the shipped worker.
        let members = self.members(node, Some(symbol_name.clone()));
        self.record(item, symbol_name, canonical_id, name, signature_end);
        members
    }

    fn members<'t>(&self, node: Node<'t>, qualifier: Option<String>) -> Option<Frame<'t>> {
        let body = node.child_by_field_name("body")?;
        Some(Frame {
            items: scope_items(body),
            next: 0,
            qualifier,
        })
    }

    /// The parameter labels of a function or initializer, `_:` for an
    /// unlabeled one.
    fn argument_labels(&self, node: Node) -> String {
        let mut labels = String::new();
        for parameter in children(node)
            .into_iter()
            .filter(|child| child.kind() == "parameter")
        {
            let label = parameter
                .child_by_field_name("external_name")
                .or_else(|| parameter.child_by_field_name("name"))
                .map_or("", |label| self.text(label));
            labels.push_str(if label == "_" { "_" } else { label });
            labels.push(':');
        }
        labels
    }

    fn text(&self, node: Node) -> &'a str {
        &self.source[node.start_byte()..node.end_byte()]
    }

    fn range(&self, start: usize, end: usize) -> SourceRange {
        SourceRange {
            start: self.converter.position(start),
            end: self.converter.position(end),
        }
    }

    /// Record a supported declaration. Visibility filtering and the documented
    /// versus undocumented split happen when the response is built.
    fn record(
        &mut self,
        item: &Item,
        symbol_name: String,
        canonical_id: String,
        name: Node,
        signature_end: usize,
    ) {
        let node = item.node;
        let (doc_targets, doc_start) = self.doc_targets(item);
        let visible = self.visibility.contains(self.access_level(node));
        let position = self.converter.position(name.start_byte());
        let declaration_start = doc_start.unwrap_or_else(|| node.start_byte());
        let declaration = Declaration {
            symbol_name,
            canonical_id,
            line: position.line,
            column: position.column,
            visible,
            unsupported: false,
            name_range: Some(self.range(name.start_byte(), name.end_byte())),
            declaration_range: Some(self.range(declaration_start, node.end_byte())),
            signature_range: Some(self.range(declaration_start, signature_end)),
            doc_targets,
            span: node.start_byte()..node.end_byte(),
        };
        self.declarations.push(declaration);
    }

    fn mark_unsupported_if_annotated(&mut self, item: &Item) {
        let node = item.node;
        let (doc_targets, _) = self.doc_targets(item);
        if doc_targets.is_empty() {
            return;
        }
        let position = self.converter.position(node.start_byte());
        self.declarations.push(Declaration {
            symbol_name: String::new(),
            canonical_id: String::new(),
            line: position.line,
            column: position.column,
            visible: true,
            unsupported: true,
            name_range: None,
            declaration_range: None,
            signature_range: None,
            doc_targets,
            span: node.start_byte()..node.end_byte(),
        });
    }

    /// The access level a declaration states for itself. Setter-scoped
    /// modifiers such as `private(set)` do not count.
    fn access_level(&self, node: Node) -> &'static str {
        let Some(modifiers) = children(node)
            .into_iter()
            .find(|child| child.kind() == "modifiers")
        else {
            return "internal";
        };
        for modifier in children(modifiers) {
            let text = self.text(modifier);
            if let Some(keyword) = ACCESS_KEYWORDS.iter().find(|keyword| **keyword == text) {
                return keyword;
            }
        }
        "internal"
    }

    /// `@doc` targets in the doc comments that lead `node`, and the start of
    /// the first such comment.
    fn doc_targets(&self, item: &Item) -> (Vec<DocTarget>, Option<usize>) {
        let mut targets = Vec::new();
        let mut start = None;
        for comment in self.leading_comments(item) {
            let text = self.text(comment);
            if !is_doc_comment(comment.kind(), text) {
                continue;
            }
            start.get_or_insert(comment.start_byte());
            for (offset, target) in doc_matches(text) {
                let begin = comment.start_byte() + offset;
                let position = self.converter.position(begin);
                targets.push(DocTarget {
                    target: target.to_string(),
                    line: position.line,
                    column: position.column,
                    range: SourceRange {
                        start: position.clone(),
                        end: Position {
                            line: position.line,
                            column: position.column + target.encode_utf16().count(),
                        },
                    },
                });
            }
        }
        (targets, start)
    }

    /// The comments that lead `item`, in document order. A comment that
    /// starts on the line of the previous token trails that token and does not
    /// lead the item.
    fn leading_comments<'t>(&self, item: &Item<'t>) -> Vec<Node<'t>> {
        let Some(previous_end) = item.previous_end else {
            return item.comments.clone();
        };
        let line_end = self.source.as_bytes()[previous_end..]
            .iter()
            .position(|byte| *byte == b'\n' || *byte == b'\r')
            .map_or(self.source.len(), |index| previous_end + index);
        item.comments
            .iter()
            .copied()
            .filter(|comment| comment.start_byte() >= line_end)
            .collect()
    }
}

fn children(node: Node) -> Vec<Node> {
    let mut cursor = node.walk();
    node.children(&mut cursor).collect()
}

fn is_comment(node: Node) -> bool {
    matches!(node.kind(), "comment" | "multiline_comment")
}

/// The declarations and statements directly in a scope. The contents of a
/// conditional compilation block are skipped; only its `#if` is an item.
fn scope_items(scope: Node) -> Vec<Item> {
    let mut items = Vec::new();
    let mut depth = 0usize;
    let mut comments = Vec::new();
    let mut previous_end = None;
    for child in children(scope) {
        if is_comment(child) {
            comments.push(child);
            continue;
        }
        let mut is_item = child.is_named() && child.kind() != "shebang_line";
        if child.kind() == "directive" {
            match child.child(0).map(|token| token.kind()) {
                Some("#if") => depth += 1,
                Some("#endif") => {
                    depth = depth.saturating_sub(1);
                    is_item = false;
                }
                Some("#else" | "#elseif") => is_item = false,
                _ => {}
            }
        }
        let nested = depth > usize::from(child.kind() == "directive" && is_item);
        if is_item && !nested {
            items.push(Item {
                node: child,
                comments: std::mem::take(&mut comments),
                previous_end,
            });
        }
        comments.clear();
        previous_end = Some(child.end_byte());
    }
    items
}

/// The end of a function or initializer signature: the last token that is not
/// a comment before a generic `where` clause or the body.
fn signature_end(node: Node) -> usize {
    let mut end = node.start_byte();
    for child in children(node) {
        if matches!(child.kind(), "type_constraints" | "function_body") {
            break;
        }
        if !matches!(child.kind(), "comment" | "multiline_comment") {
            end = child.end_byte();
        }
    }
    end
}

fn prefix(qualifier: Option<&str>) -> String {
    qualifier.map_or_else(String::new, |qualifier| format!("{qualifier}."))
}

fn is_doc_comment(kind: &str, text: &str) -> bool {
    let bytes = text.as_bytes();
    match kind {
        "comment" => text.starts_with("///"),
        "multiline_comment" => text.starts_with("/**") && bytes.get(3) != Some(&b'/'),
        _ => false,
    }
}

/// Whether the character is `\s` in the ICU regular expressions the shipped
/// worker uses: `[\t\n\f\r\p{Z}]`.
fn is_regex_space(character: char) -> bool {
    matches!(
        character,
        '\t' | '\n' | '\u{c}' | '\r' | ' ' | '\u{a0}' | '\u{1680}' | '\u{2000}'
            ..='\u{200a}' | '\u{2028}' | '\u{2029}' | '\u{202f}' | '\u{205f}' | '\u{3000}'
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

/// `parse_errors` are the diagnostics of the declarations dropped for syntax
/// errors; they follow the others.
fn build_response(
    file: &WorkerFile,
    declarations: Vec<Declaration>,
    parse_errors: Vec<Diagnostic>,
) -> WorkerFileResponse {
    let path = file.file_path.as_str();
    let mut symbols: Vec<CodeSymbol> = Vec::new();
    let mut undocumented: Vec<CodeSymbol> = Vec::new();
    let mut links: Vec<DocLink> = Vec::new();
    let mut diagnostics: Vec<Diagnostic> = Vec::new();
    // A set, because a search of `undocumented` for every symbol is quadratic
    // in a file of many declarations.
    let mut undocumented_endpoints: HashSet<String> = HashSet::new();
    let mut seen_endpoints: HashSet<String> = HashSet::new();
    let mut duplicate_endpoints: HashSet<String> = HashSet::new();

    for declaration in declarations {
        if declaration.unsupported {
            diagnostics.push(diagnostic(
                "unsupported_declaration",
                path,
                None,
                "error",
                "Swift declaration annotated with @doc is not supported.".to_string(),
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
            if undocumented_endpoints.insert(symbol.endpoint.clone()) {
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
                    format!("Duplicate Swift code symbol endpoint: {}", symbol.endpoint),
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
                location: SourceLocation {
                    file_path: path.to_string(),
                    line: doc.line,
                    column: doc.column,
                },
                target_range: Some(doc.range.clone()),
            });
        }
    }

    diagnostics.extend(parse_errors);
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
        language: "swift".to_string(),
        file_path: path.to_string(),
        symbol_name: declaration.symbol_name.clone(),
        canonical_id: declaration.canonical_id.clone(),
        endpoint: format!("{path}#{}", declaration.canonical_id),
        location: SourceLocation {
            file_path: path.to_string(),
            line: declaration.line,
            column: declaration.column,
        },
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
        language: Some("swift".to_string()),
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
        && !file_path.chars().any(char::is_whitespace)
        && !file_path.split('/').any(|segment| segment == "..")
        && file_path != source_file_path
        && !fragment.is_empty()
        && !fragment.chars().any(char::is_whitespace)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn scan(source: &str, visibility: Option<&[&str]>) -> WorkerFileResponse {
        scan_in(source, visibility, Scope::File)
    }

    fn scan_in(source: &str, visibility: Option<&[&str]>, scope: Scope) -> WorkerFileResponse {
        let file = WorkerFile {
            file_path: "Sources/A.swift".to_string(),
            content: source.to_string(),
        };
        let visibility: Option<Vec<String>> =
            visibility.map(|levels| levels.iter().map(|level| level.to_string()).collect());
        scan_file(&file, visibility.as_deref(), scope)
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
    fn members_qualify_by_type_and_carry_argument_labels() {
        let source = "\
public struct Auth {
    /// @doc docs/a.md#login
    public func login(email: String, _ password: String) {}
    /// @doc docs/a.md#init
    public init(token: String) {}
    /// @doc docs/a.md#user
    public var user: String
}
";
        let response = scan(source, None);
        assert_eq!(
            ids(&response.symbols),
            ["Auth.login(email:_:)", "Auth.init(token:)", "Auth.user"]
        );
        assert_eq!(response.links.len(), 3);
        assert_eq!(
            response.links[0].source,
            "Sources/A.swift#Auth.login(email:_:)"
        );
        assert_eq!(response.links[0].location.line, 2);
        assert_eq!(response.links[0].location.column, 14);
        assert_eq!(ids(&response.undocumented_symbols), ["Auth"]);
    }

    #[test]
    fn default_visibility_is_public_and_open() {
        let source = "\
struct Hidden {}
fileprivate struct Also {}
public struct Shown {
    private(set) public var a: Int
    public private(set) var b: Int
    internal func c() {}
}
";
        let response = scan(source, None);
        assert_eq!(
            ids(&response.undocumented_symbols),
            ["Shown", "Shown.a", "Shown.b"]
        );
        let all = scan(source, Some(&["internal", "fileprivate"]));
        assert_eq!(
            ids(&all.undocumented_symbols),
            ["Hidden", "Also", "Shown.c()"]
        );
    }

    #[test]
    fn extension_members_qualify_by_the_extended_type() {
        let source = "extension Outer.Inner {\n    public func f() {}\n}\n";
        let response = scan(source, None);
        assert_eq!(ids(&response.undocumented_symbols), ["Outer.Inner.f()"]);
    }

    #[test]
    fn annotated_declaration_without_a_canonical_form_is_unsupported() {
        let source = "/// @doc docs/a.md#alias\npublic typealias Token = String\n";
        let response = scan(source, None);
        assert_eq!(codes(&response), ["unsupported_declaration"]);
        assert!(response.symbols.is_empty());
        let location = response.diagnostics[0].location.as_ref().expect("location");
        assert_eq!((location.line, location.column), (2, 1));
    }

    #[test]
    fn duplicate_endpoint_and_links_are_reported_once() {
        let source = "\
/// @doc a.md#x @doc a.md#x @doc /abs.md#y
public func f() {}
/// @doc a.md#z
public func f() {}
";
        let response = scan(source, None);
        assert_eq!(ids(&response.symbols), ["f()"]);
        assert_eq!(
            codes(&response),
            [
                "duplicate_link",
                "invalid_link_target",
                "duplicate_code_symbol"
            ]
        );
        assert_eq!(response.diagnostics[0].severity, "warning");
        assert_eq!(response.links.len(), 1);
    }

    #[test]
    fn a_comment_on_the_previous_token_line_does_not_lead_the_declaration() {
        let source = "\
public struct S { /// @doc a.md#same
    public func f() {} /// @doc a.md#trail
    public func g() {}
}
";
        let response = scan(source, None);
        assert!(response.links.is_empty());
        assert_eq!(ids(&response.undocumented_symbols), ["S", "S.f()", "S.g()"]);
    }

    fn signature_end_of(source: &str) -> (usize, usize) {
        let response = scan(source, None);
        let symbol = &response.undocumented_symbols[0];
        let range = symbol.signature_range.as_ref().expect("range");
        (range.end.line, range.end.column)
    }

    #[test]
    fn the_signature_ends_before_a_comment_that_precedes_the_body() {
        assert_eq!(signature_end_of("public func f() /* note */ {}\n"), (1, 16));
        assert_eq!(signature_end_of("public func g() // note\n{}\n"), (1, 16));
        assert_eq!(
            signature_end_of("/// doc\npublic func h() /// tail\n{}\n"),
            (2, 16)
        );
        assert_eq!(signature_end_of("public init() /* note */ {}\n"), (1, 14));
    }

    #[test]
    fn one_rejected_declaration_yields_one_diagnostic() {
        let response = declaration_scope("public var a = , b = 2\npublic func f() {}\n");
        assert_eq!(rejected_ids(&response), ["Sources/A.swift#a"]);
    }

    #[test]
    fn the_declaration_range_starts_at_the_first_doc_comment() {
        let source = "// plain\n/// intro\n\n/// @doc a.md#x\npublic func f() {}\n";
        let response = scan(source, None);
        let symbol = &response.symbols[0];
        let range = symbol.declaration_range.as_ref().expect("range");
        assert_eq!((range.start.line, range.start.column), (2, 1));
        assert_eq!((range.end.line, range.end.column), (5, 19));
    }

    #[test]
    fn conditional_compilation_contents_are_skipped() {
        let source = "\
#if DEBUG
public func hidden() {}
#else
public func alsoHidden() {}
#endif
public func shown() {}
";
        let response = scan(source, None);
        assert_eq!(ids(&response.undocumented_symbols), ["shown()"]);
    }

    #[test]
    fn an_undocumented_endpoint_declared_twice_is_listed_once() {
        let source = "public func f() {}\npublic func f() {}\npublic func g() {}\n";
        let response = scan(source, None);
        let endpoints: Vec<&str> = response
            .undocumented_symbols
            .iter()
            .map(|symbol| symbol.endpoint.as_str())
            .collect();
        assert_eq!(endpoints.len(), 2, "{endpoints:?}");
        assert_ne!(endpoints[0], endpoints[1]);
    }

    #[test]
    fn a_syntax_error_yields_one_diagnostic_and_nothing_else() {
        let response = scan("/// @doc a.md#x\npublic func f( {}\n", None);
        assert_eq!(codes(&response), ["code_parse_error"]);
        assert!(response.symbols.is_empty());
        assert!(response.undocumented_symbols.is_empty());
        assert!(response.links.is_empty());
    }

    fn declaration_scope(source: &str) -> WorkerFileResponse {
        scan_in(
            source,
            Some(&["public", "internal", "private"]),
            Scope::Declaration,
        )
    }

    fn rejected_ids(response: &WorkerFileResponse) -> Vec<&str> {
        response
            .diagnostics
            .iter()
            .filter(|diagnostic| diagnostic.code == "code_parse_error")
            .map(|diagnostic| diagnostic.target.as_str())
            .collect()
    }

    #[test]
    fn an_error_in_a_function_body_drops_only_that_function() {
        let source = "\
public func a() {}
public func b() {
    let x = (
}
public func c() {}
";
        let response = declaration_scope(source);
        assert_eq!(ids(&response.undocumented_symbols), ["a()", "c()"]);
        assert_eq!(rejected_ids(&response), ["Sources/A.swift#b()"]);
        let location = response.diagnostics[0].location.as_ref().expect("location");
        assert!((3..=4).contains(&location.line), "{}", location.line);
        assert_eq!(response.diagnostics[0].severity, "error");
    }

    #[test]
    fn an_error_in_a_member_drops_only_that_member() {
        let source = "\
public struct S {
    public func a() {}
    public func b() {
        let x = (
    }
    public func c() {}
}
";
        let response = declaration_scope(source);
        assert_eq!(ids(&response.undocumented_symbols), ["S", "S.a()", "S.c()"]);
        assert_eq!(rejected_ids(&response), ["Sources/A.swift#S.b()"]);
    }

    #[test]
    fn an_error_outside_every_declaration_rejects_the_file() {
        let response = declaration_scope("public func a() {}\nlet x = (\n");
        assert_eq!(codes(&response), ["code_parse_error"]);
        assert!(response.undocumented_symbols.is_empty());
        assert_eq!(rejected_ids(&response), ["Sources/A.swift"]);
    }

    #[test]
    fn the_file_scope_rejects_the_whole_file() {
        let source = "public func a() {}\npublic func b() {\n    let x = (\n}\n";
        let response = scan(source, None);
        assert_eq!(codes(&response), ["code_parse_error"]);
        assert!(response.undocumented_symbols.is_empty());
        let scoped = declaration_scope(source);
        assert_eq!(ids(&scoped.undocumented_symbols), ["a()"]);
    }

    #[test]
    fn a_dropped_declaration_takes_its_links_with_it() {
        let source = "\
/// @doc a.md#a
public func a() {}
/// @doc a.md#b
public func b() {
    let x = (
}
";
        let response = declaration_scope(source);
        assert_eq!(ids(&response.symbols), ["a()"]);
        assert_eq!(response.links.len(), 1);
        assert_eq!(rejected_ids(&response), ["Sources/A.swift#b()"]);
    }

    #[test]
    fn deeply_nested_types_do_not_overflow_the_stack() {
        let depth = 2_000;
        let opening: String = (0..depth)
            .map(|index| format!("public struct T{index} {{ "))
            .collect();
        let source = format!("{opening}{}", "}".repeat(depth));
        let response = scan(&source, None);
        assert_eq!(response.undocumented_symbols.len(), depth);
    }

    #[test]
    fn doc_matches_follow_the_regular_expression() {
        let matches = doc_matches("@doc a.md#x @docs b.md#y @doc\n  c.md#z @doc");
        assert_eq!(matches, [(5, "a.md#x"), (32, "c.md#z")]);
    }
}
