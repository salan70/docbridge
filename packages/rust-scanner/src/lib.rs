//! DocBridge Rust scanner: syn-based `@doc` extraction for the worker protocol.

mod models;

pub use models::*;

use proc_macro2::LineColumn;
use std::collections::HashSet;
use syn::spanned::Spanned;
use syn::{
    Attribute, Expr, ExprLit, Field, Fields, File, Generics, ImplItem, Item, ItemFn, ItemImpl,
    ItemMod, Lit, Meta, TraitItem, Visibility,
};

/// Scan a worker request JSON payload and return the response JSON.
pub fn scan_request_json(request_json: &str) -> Result<String, String> {
    let request: WorkerRequest =
        serde_json::from_str(request_json).map_err(|error| error.to_string())?;
    let response = scan_request(&request);
    serde_json::to_string(&response).map_err(|error| error.to_string())
}

fn scan_request(request: &WorkerRequest) -> WorkerResponse {
    let files = request
        .files
        .iter()
        .map(|file| scan_file(file, request.options.visibility.as_deref()))
        .collect();
    WorkerResponse {
        schema_version: 1,
        request_id: request.request_id.clone(),
        language: "rust".to_string(),
        files,
    }
}

fn scan_file(file: &WorkerFile, visibility: Option<&[String]>) -> WorkerFileResponse {
    let parsed = match syn::parse_file(&file.content) {
        Ok(file) => file,
        Err(_) => {
            return WorkerFileResponse {
                file_path: file.file_path.clone(),
                symbols: vec![],
                undocumented_symbols: vec![],
                links: vec![],
                diagnostics: vec![diagnostic(
                    "code_parse_error",
                    &file.file_path,
                    "Rust parser reported syntax errors.",
                    None,
                    Some(SourceLocation {
                        file_path: file.file_path.clone(),
                        line: 1,
                        column: 1,
                    }),
                    None,
                )],
            };
        }
    };

    let visibility_set: HashSet<String> = visibility
        .map(|values| values.iter().cloned().collect())
        .unwrap_or_else(|| HashSet::from(["pub".to_string()]));
    let converter = PositionConverter::new(&file.content);
    let declarations = collect_declarations(&parsed, &converter, &visibility_set);
    build_response(&file.file_path, declarations)
}

fn build_response(file_path: &str, declarations: Vec<Declaration>) -> WorkerFileResponse {
    let mut symbols = Vec::new();
    let mut undocumented_symbols = Vec::new();
    let mut links = Vec::new();
    let mut diagnostics = Vec::new();
    let mut seen_endpoints = HashSet::new();
    let mut duplicate_endpoints = HashSet::new();

    for declaration in declarations {
        if declaration.unsupported {
            diagnostics.push(diagnostic(
                "unsupported_declaration",
                file_path,
                "Rust declaration annotated with @doc is not supported.",
                None,
                Some(SourceLocation {
                    file_path: file_path.to_string(),
                    line: declaration.line,
                    column: declaration.column,
                }),
                declaration.name_range.clone(),
            ));
            continue;
        }

        if !declaration.visible {
            continue;
        }

        let symbol = make_symbol(file_path, &declaration);
        if declaration.doc_targets.is_empty() {
            if !undocumented_symbols
                .iter()
                .any(|existing: &CodeSymbol| existing.endpoint == symbol.endpoint)
            {
                undocumented_symbols.push(symbol);
            }
            continue;
        }

        if seen_endpoints.contains(&symbol.endpoint) {
            if !duplicate_endpoints.contains(&symbol.endpoint) {
                diagnostics.push(diagnostic(
                    "duplicate_code_symbol",
                    &symbol.endpoint,
                    &format!("Duplicate Rust code symbol endpoint: {}", symbol.endpoint),
                    None,
                    Some(SourceLocation {
                        file_path: file_path.to_string(),
                        line: declaration.line,
                        column: declaration.column,
                    }),
                    declaration.name_range.clone(),
                ));
                duplicate_endpoints.insert(symbol.endpoint.clone());
            }
            continue;
        }
        seen_endpoints.insert(symbol.endpoint.clone());
        symbols.push(symbol.clone());

        let mut seen_targets = HashSet::new();
        for doc_target in declaration.doc_targets {
            if !is_valid_link_target(&doc_target.target, file_path) {
                diagnostics.push(diagnostic(
                    "invalid_link_target",
                    &doc_target.target,
                    "Link target must be a project-root-relative file path and fragment in file#fragment form.",
                    Some(symbol.endpoint.clone()),
                    Some(SourceLocation {
                        file_path: file_path.to_string(),
                        line: doc_target.line,
                        column: doc_target.column,
                    }),
                    doc_target.range.clone(),
                ));
                continue;
            }

            if seen_targets.contains(&doc_target.target) {
                diagnostics.push(Diagnostic {
                    severity: "warning".to_string(),
                    code: "duplicate_link".to_string(),
                    target: doc_target.target.clone(),
                    language: Some("rust".to_string()),
                    source: Some(symbol.endpoint.clone()),
                    message: format!(
                        "Duplicate @doc link from {} to {}.",
                        symbol.endpoint, doc_target.target
                    ),
                    location: Some(SourceLocation {
                        file_path: file_path.to_string(),
                        line: doc_target.line,
                        column: doc_target.column,
                    }),
                    range: doc_target.range.clone(),
                });
                continue;
            }
            seen_targets.insert(doc_target.target.clone());
            links.push(DocLink {
                source: symbol.endpoint.clone(),
                target: doc_target.target,
                location: SourceLocation {
                    file_path: file_path.to_string(),
                    line: doc_target.line,
                    column: doc_target.column,
                },
                target_range: doc_target.range,
            });
        }
    }

    WorkerFileResponse {
        file_path: file_path.to_string(),
        symbols,
        undocumented_symbols,
        links,
        diagnostics,
    }
}

fn make_symbol(file_path: &str, declaration: &Declaration) -> CodeSymbol {
    CodeSymbol {
        kind: "code".to_string(),
        language: "rust".to_string(),
        file_path: file_path.to_string(),
        symbol_name: declaration.symbol_name.clone(),
        canonical_id: declaration.canonical_id.clone(),
        endpoint: format!("{file_path}#{}", declaration.canonical_id),
        location: SourceLocation {
            file_path: file_path.to_string(),
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
    message: &str,
    source: Option<String>,
    location: Option<SourceLocation>,
    range: Option<SourceRange>,
) -> Diagnostic {
    Diagnostic {
        severity: "error".to_string(),
        code: code.to_string(),
        target: target.to_string(),
        language: Some("rust".to_string()),
        source,
        message: message.to_string(),
        location,
        range,
    }
}

#[derive(Clone)]
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
    range: Option<SourceRange>,
}

fn collect_declarations(
    file: &File,
    converter: &PositionConverter,
    visibility: &HashSet<String>,
) -> Vec<Declaration> {
    let mut declarations = Vec::new();
    walk_items(&file.items, "", converter, visibility, &mut declarations);
    declarations
}

fn walk_items(
    items: &[Item],
    module_prefix: &str,
    converter: &PositionConverter,
    visibility: &HashSet<String>,
    out: &mut Vec<Declaration>,
) {
    for item in items {
        match item {
            Item::Struct(item) => {
                let name = item.ident.to_string();
                let canonical = qualify(module_prefix, &name);
                record_item(
                    out,
                    converter,
                    visibility,
                    &item.vis,
                    &item.attrs,
                    (&name, &canonical),
                    (
                        item.ident.span(),
                        item.span(),
                        type_signature_end(&item.generics, item.ident.span().end()),
                    ),
                );
                mark_unsupported_fields(out, converter, &item.fields);
            }
            Item::Enum(item) => {
                let name = item.ident.to_string();
                let canonical = qualify(module_prefix, &name);
                record_item(
                    out,
                    converter,
                    visibility,
                    &item.vis,
                    &item.attrs,
                    (&name, &canonical),
                    (
                        item.ident.span(),
                        item.span(),
                        type_signature_end(&item.generics, item.ident.span().end()),
                    ),
                );
                for variant in &item.variants {
                    mark_unsupported_attrs(out, converter, &variant.attrs, variant.span());
                    mark_unsupported_fields(out, converter, &variant.fields);
                }
            }
            Item::Fn(item) => {
                record_fn(out, converter, visibility, module_prefix, item);
            }
            Item::Mod(item) => {
                record_mod(out, converter, visibility, module_prefix, item);
            }
            Item::Impl(item) => {
                record_impl(out, converter, visibility, module_prefix, item);
            }
            Item::Trait(item) => {
                mark_unsupported_attrs(out, converter, &item.attrs, item.span());
                for trait_item in &item.items {
                    mark_unsupported_trait_item(out, converter, trait_item);
                }
            }
            Item::Union(item) => {
                mark_unsupported_attrs(out, converter, &item.attrs, item.span());
                for field in &item.fields.named {
                    mark_unsupported_field(out, converter, field);
                }
            }
            other => {
                mark_unsupported_if_annotated(out, converter, other);
            }
        }
    }
}

fn record_mod(
    out: &mut Vec<Declaration>,
    converter: &PositionConverter,
    visibility: &HashSet<String>,
    module_prefix: &str,
    item: &ItemMod,
) {
    let name = item.ident.to_string();
    let canonical = qualify(module_prefix, &name);
    record_item(
        out,
        converter,
        visibility,
        &item.vis,
        &item.attrs,
        (&name, &canonical),
        (item.ident.span(), item.span(), item.ident.span().end()),
    );
    if let Some((_, items)) = &item.content {
        walk_items(items, &canonical, converter, visibility, out);
    }
}

fn record_fn(
    out: &mut Vec<Declaration>,
    converter: &PositionConverter,
    visibility: &HashSet<String>,
    module_prefix: &str,
    item: &ItemFn,
) {
    let name = item.sig.ident.to_string();
    let canonical = qualify(module_prefix, &name);
    record_item(
        out,
        converter,
        visibility,
        &item.vis,
        &item.attrs,
        (&name, &canonical),
        (item.sig.ident.span(), item.span(), item.sig.span().end()),
    );
}

fn record_impl(
    out: &mut Vec<Declaration>,
    converter: &PositionConverter,
    visibility: &HashSet<String>,
    module_prefix: &str,
    item: &ItemImpl,
) {
    // Trait implementations are out of MVP scope.
    if item.trait_.is_some() {
        for impl_item in &item.items {
            if let ImplItem::Fn(method) = impl_item {
                push_unsupported_method(out, converter, method);
            }
        }
        return;
    }

    let Some(type_name) = type_path_name(&item.self_ty) else {
        for impl_item in &item.items {
            if let ImplItem::Fn(method) = impl_item {
                push_unsupported_method(out, converter, method);
            }
        }
        return;
    };

    let qualified_type = qualify(module_prefix, &type_name);
    for impl_item in &item.items {
        match impl_item {
            ImplItem::Fn(method) => {
                let name = method.sig.ident.to_string();
                let canonical = format!("{qualified_type}::{name}");
                record_item(
                    out,
                    converter,
                    visibility,
                    &method.vis,
                    &method.attrs,
                    (&name, &canonical),
                    (
                        method.sig.ident.span(),
                        method.span(),
                        method.sig.span().end(),
                    ),
                );
            }
            other => mark_unsupported_impl_item(out, converter, other),
        }
    }
}

fn push_unsupported_method(
    out: &mut Vec<Declaration>,
    converter: &PositionConverter,
    method: &syn::ImplItemFn,
) {
    let docs = extract_doc_targets(&method.attrs, converter);
    if docs.is_empty() {
        return;
    }
    let loc = converter.line_column(method.sig.ident.span().start());
    out.push(Declaration {
        symbol_name: method.sig.ident.to_string(),
        canonical_id: method.sig.ident.to_string(),
        line: loc.line,
        column: loc.column,
        visible: true,
        unsupported: true,
        name_range: Some(converter.span_range(method.sig.ident.span())),
        declaration_range: Some(converter.span_range(method.span())),
        signature_range: Some(converter.span_range(method.sig.span())),
        doc_targets: docs,
    });
}

fn mark_unsupported_if_annotated(
    out: &mut Vec<Declaration>,
    converter: &PositionConverter,
    item: &Item,
) {
    let Some(attrs) = item_attrs(item) else {
        return;
    };
    mark_unsupported_attrs(out, converter, attrs, item.span());
}

fn mark_unsupported_impl_item(
    out: &mut Vec<Declaration>,
    converter: &PositionConverter,
    item: &ImplItem,
) {
    let attrs = match item {
        ImplItem::Const(item) => &item.attrs,
        ImplItem::Type(item) => &item.attrs,
        ImplItem::Macro(item) => &item.attrs,
        _ => return,
    };
    mark_unsupported_attrs(out, converter, attrs, item.span());
}

fn mark_unsupported_trait_item(
    out: &mut Vec<Declaration>,
    converter: &PositionConverter,
    item: &TraitItem,
) {
    let attrs = match item {
        TraitItem::Const(item) => &item.attrs,
        TraitItem::Fn(item) => &item.attrs,
        TraitItem::Type(item) => &item.attrs,
        TraitItem::Macro(item) => &item.attrs,
        _ => return,
    };
    mark_unsupported_attrs(out, converter, attrs, item.span());
}

fn mark_unsupported_fields(
    out: &mut Vec<Declaration>,
    converter: &PositionConverter,
    fields: &Fields,
) {
    for field in fields {
        mark_unsupported_field(out, converter, field);
    }
}

fn mark_unsupported_field(
    out: &mut Vec<Declaration>,
    converter: &PositionConverter,
    field: &Field,
) {
    mark_unsupported_attrs(out, converter, &field.attrs, field.span());
}

fn mark_unsupported_attrs(
    out: &mut Vec<Declaration>,
    converter: &PositionConverter,
    attrs: &[Attribute],
    span: proc_macro2::Span,
) {
    let docs = extract_doc_targets(attrs, converter);
    if docs.is_empty() {
        return;
    }
    let loc = converter.line_column(span.start());
    out.push(Declaration {
        symbol_name: "<unsupported>".to_string(),
        canonical_id: "<unsupported>".to_string(),
        line: loc.line,
        column: loc.column,
        visible: true,
        unsupported: true,
        name_range: Some(converter.span_range(span)),
        declaration_range: Some(converter.span_range(span)),
        signature_range: None,
        doc_targets: docs,
    });
}

fn item_attrs(item: &Item) -> Option<&[Attribute]> {
    Some(match item {
        Item::Const(item) => &item.attrs,
        Item::Static(item) => &item.attrs,
        Item::Type(item) => &item.attrs,
        Item::Trait(item) => &item.attrs,
        Item::TraitAlias(item) => &item.attrs,
        Item::Union(item) => &item.attrs,
        Item::ForeignMod(item) => &item.attrs,
        Item::Macro(item) => &item.attrs,
        Item::Use(item) => &item.attrs,
        Item::ExternCrate(item) => &item.attrs,
        _ => return None,
    })
}

fn record_item(
    out: &mut Vec<Declaration>,
    converter: &PositionConverter,
    visibility: &HashSet<String>,
    vis: &Visibility,
    attrs: &[Attribute],
    names: (&str, &str),
    spans: (proc_macro2::Span, proc_macro2::Span, LineColumn),
) {
    let (symbol_name, canonical_id) = names;
    let (name_span, decl_span, signature_end) = spans;
    let loc = converter.line_column(name_span.start());
    let signature_start = attrs
        .iter()
        .find(|attr| doc_attribute_value(attr).is_some())
        .map_or_else(|| decl_span.start(), |attr| attr.span().start());
    out.push(Declaration {
        symbol_name: symbol_name.to_string(),
        canonical_id: canonical_id.to_string(),
        line: loc.line,
        column: loc.column,
        visible: is_visible(vis, visibility),
        unsupported: false,
        name_range: Some(converter.span_range(name_span)),
        declaration_range: Some(converter.span_range(decl_span)),
        signature_range: Some(converter.range(signature_start, signature_end)),
        doc_targets: extract_doc_targets(attrs, converter),
    });
}

fn type_signature_end(generics: &Generics, name_end: LineColumn) -> LineColumn {
    if let Some(where_clause) = &generics.where_clause {
        where_clause.span().end()
    } else if generics.lt_token.is_some() {
        generics.span().end()
    } else {
        name_end
    }
}

fn is_visible(vis: &Visibility, allowed: &HashSet<String>) -> bool {
    let key = match vis {
        Visibility::Public(_) => "pub",
        _ => "private",
    };
    allowed.contains(key)
}

fn qualify(prefix: &str, name: &str) -> String {
    if prefix.is_empty() {
        name.to_string()
    } else {
        format!("{prefix}::{name}")
    }
}

fn type_path_name(ty: &syn::Type) -> Option<String> {
    match ty {
        syn::Type::Path(path) => path.path.segments.last().map(|seg| seg.ident.to_string()),
        syn::Type::Paren(paren) => type_path_name(&paren.elem),
        syn::Type::Group(group) => type_path_name(&group.elem),
        _ => None,
    }
}

fn extract_doc_targets(attrs: &[Attribute], converter: &PositionConverter) -> Vec<DocTarget> {
    let mut targets = Vec::new();
    for attr in attrs {
        let Some(doc_value) = doc_attribute_value(attr) else {
            continue;
        };
        let attr_start_offset = converter.byte_offset(attr.span().start());
        let attr_end_offset = converter.byte_offset(attr.span().end());
        let attr_source = converter.slice(attr_start_offset, attr_end_offset);
        let mut source_cursor = 0;
        for doc_match in find_doc_targets(&doc_value) {
            let relative_offset = attr_source[source_cursor..]
                .find(&doc_match.target)
                .map(|offset| source_cursor + offset)
                .unwrap_or(doc_match.byte_offset);
            let target_start_offset = attr_start_offset + relative_offset;
            let target_end_offset = target_start_offset + doc_match.target.len();
            let range = Some(converter.range_from_offsets(target_start_offset, target_end_offset));
            let start = converter.position_at_offset(target_start_offset);
            source_cursor = relative_offset + doc_match.target.len();
            targets.push(DocTarget {
                target: doc_match.target,
                line: start.line,
                column: start.column,
                range,
            });
        }
    }
    targets
}

struct DocMatch {
    target: String,
    byte_offset: usize,
}

fn find_doc_targets(doc_value: &str) -> Vec<DocMatch> {
    let mut targets = Vec::new();
    let bytes = doc_value.as_bytes();
    let mut index = 0;
    while index + 4 <= bytes.len() {
        if bytes[index..].starts_with(b"@doc") {
            let after = index + 4;
            let mut cursor = after;
            while cursor < bytes.len() && bytes[cursor].is_ascii_whitespace() {
                cursor += 1;
            }
            if cursor > after && cursor < bytes.len() {
                let start = cursor;
                while cursor < bytes.len() && !bytes[cursor].is_ascii_whitespace() {
                    cursor += 1;
                }
                if cursor > start {
                    if let Ok(target) = std::str::from_utf8(&bytes[start..cursor]) {
                        targets.push(DocMatch {
                            target: target.to_string(),
                            byte_offset: start,
                        });
                    }
                }
                index = cursor;
                continue;
            }
        }
        index += 1;
    }
    targets
}

fn doc_attribute_value(attr: &Attribute) -> Option<String> {
    // syn represents `///` / `//!` as `#[doc = "..."]` / `#![doc = "..."]`.
    if !attr.path().is_ident("doc") {
        return None;
    }
    match &attr.meta {
        Meta::NameValue(meta) => match &meta.value {
            Expr::Lit(ExprLit {
                lit: Lit::Str(lit), ..
            }) => Some(lit.value()),
            _ => None,
        },
        _ => None,
    }
}

/// Returns whether `target` is a valid DocBridge link target for `source_file_path`.
pub fn is_valid_link_target(target: &str, source_file_path: &str) -> bool {
    let Some((file_path, fragment)) = target.split_once('#') else {
        return false;
    };
    if file_path.is_empty()
        || fragment.is_empty()
        || file_path.starts_with('/')
        || file_path.starts_with("./")
        || file_path.starts_with("../")
        || file_path.contains('\\')
        || file_path.contains(char::is_whitespace)
        || file_path.split('/').any(|segment| segment == "..")
        || file_path == source_file_path
        || fragment.contains(char::is_whitespace)
    {
        return false;
    }
    true
}

struct PositionConverter {
    /// Byte offset of the start of each line (0-based).
    line_starts: Vec<usize>,
    content: String,
}

impl PositionConverter {
    fn new(content: &str) -> Self {
        let mut line_starts = vec![0];
        for (index, ch) in content.char_indices() {
            if ch == '\n' {
                line_starts.push(index + ch.len_utf8());
            }
        }
        Self {
            line_starts,
            content: content.to_string(),
        }
    }

    fn line_column(&self, loc: LineColumn) -> Position {
        // With `span-locations`, proc-macro2 reports 1-based lines and 0-based
        // Unicode scalar columns. DocBridge wants 1-based UTF-16 columns.
        let line = loc.line;
        let line_index = line.saturating_sub(1);
        let line_start = self.line_starts.get(line_index).copied().unwrap_or(0);
        let line_end = self
            .line_starts
            .get(line_index + 1)
            .copied()
            .unwrap_or(self.content.len());
        let line_text = &self.content[line_start..line_end];
        let prefix: String = line_text.chars().take(loc.column).collect();
        let utf16_col = prefix.encode_utf16().count() + 1;
        Position {
            line,
            column: utf16_col,
        }
    }

    fn byte_offset(&self, loc: LineColumn) -> usize {
        let line_index = loc.line.saturating_sub(1);
        let line_start = self.line_starts.get(line_index).copied().unwrap_or(0);
        let line_end = self
            .line_starts
            .get(line_index + 1)
            .copied()
            .unwrap_or(self.content.len());
        let line_text = &self.content[line_start..line_end];
        let column_offset = line_text
            .char_indices()
            .nth(loc.column)
            .map_or(line_text.len(), |(offset, _)| offset);
        line_start + column_offset
    }

    fn position_at_offset(&self, offset: usize) -> Position {
        let clamped = offset.min(self.content.len());
        let line_index = self.line_starts.partition_point(|start| *start <= clamped) - 1;
        let line_start = self.line_starts[line_index];
        let utf16_column = self.content[line_start..clamped].encode_utf16().count() + 1;
        Position {
            line: line_index + 1,
            column: utf16_column,
        }
    }

    fn slice(&self, start: usize, end: usize) -> &str {
        &self.content[start.min(self.content.len())..end.min(self.content.len())]
    }

    fn range(&self, start: LineColumn, end: LineColumn) -> SourceRange {
        SourceRange {
            start: self.line_column(start),
            end: self.line_column(end),
        }
    }

    fn range_from_offsets(&self, start: usize, end: usize) -> SourceRange {
        SourceRange {
            start: self.position_at_offset(start),
            end: self.position_at_offset(end),
        }
    }

    fn span_range(&self, span: proc_macro2::Span) -> SourceRange {
        SourceRange {
            start: self.line_column(span.start()),
            end: self.line_column(span.end()),
        }
    }
}
