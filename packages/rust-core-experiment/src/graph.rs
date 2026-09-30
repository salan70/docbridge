//! Port of `buildLinkGraph` and `counterpartsOf` from `src/link/graph.ts`.
//!
//! Navigation honors resolvable one-way links: an annotation contributes a
//! counterpart edge whenever its target resolves to a known endpoint,
//! regardless of whether the reverse backlink exists. Backlink completeness is
//! reported by diagnostics, not by this graph.

use std::collections::{HashMap, HashSet};

use crate::endpoint::{compare_endpoint_order, EndpointOrderKey};
use crate::types::{
    CodeScanResult, CodeSymbolEndpoint, DocAnchorEndpoint, GraphEndpoint, MarkdownScanResult,
};

/// The resolved link graph: every scanned endpoint plus the symmetric
/// counterpart relation that navigation traverses.
pub struct LinkGraph<'a> {
    /// Code symbols keyed by `file#name` endpoint (first occurrence wins).
    code_by_endpoint: HashMap<&'a str, &'a CodeSymbolEndpoint>,
    /// Doc anchors keyed by `file#anchor` endpoint (first occurrence wins).
    doc_by_endpoint: HashMap<&'a str, &'a DocAnchorEndpoint>,
    /// Undirected counterpart relation; the graph is bipartite.
    counterparts: HashMap<&'a str, HashSet<&'a str>>,
}

/// Build the link graph from scanner outputs.
pub fn build_link_graph<'a>(
    code_files: &'a [CodeScanResult],
    doc_files: &'a [MarkdownScanResult],
) -> LinkGraph<'a> {
    let mut code_by_endpoint = HashMap::new();
    for symbol in code_files.iter().flat_map(|file| file.symbols.iter()) {
        code_by_endpoint
            .entry(symbol.endpoint.as_str())
            .or_insert(symbol);
    }

    let mut doc_by_endpoint = HashMap::new();
    for anchor in doc_files.iter().flat_map(|file| file.anchors.iter()) {
        doc_by_endpoint
            .entry(anchor.endpoint.as_str())
            .or_insert(anchor);
    }

    let mut counterparts: HashMap<&'a str, HashSet<&'a str>> = HashMap::new();
    let mut add_edge = |a: &'a str, b: &'a str| {
        counterparts.entry(a).or_default().insert(b);
        counterparts.entry(b).or_default().insert(a);
    };

    // Code `@doc` links (code -> doc): include when the doc anchor resolves.
    for link in code_files.iter().flat_map(|file| file.links.iter()) {
        if code_by_endpoint.contains_key(link.source.as_str())
            && doc_by_endpoint.contains_key(link.target.as_str())
        {
            add_edge(&link.source, &link.target);
        }
    }

    // Markdown `@code` links (doc -> code): include when the code symbol resolves.
    for link in doc_files.iter().flat_map(|file| file.links.iter()) {
        if doc_by_endpoint.contains_key(link.source.as_str())
            && code_by_endpoint.contains_key(link.target.as_str())
        {
            add_edge(&link.source, &link.target);
        }
    }

    LinkGraph {
        code_by_endpoint,
        doc_by_endpoint,
        counterparts,
    }
}

/// Resolve the counterpart endpoints linked to `endpoint`, ordered by file
/// path then position so one-to-many pickers are stable.
pub fn counterparts_of(graph: &LinkGraph<'_>, endpoint: &str) -> Vec<GraphEndpoint> {
    let Some(targets) = graph.counterparts.get(endpoint) else {
        return Vec::new();
    };

    let mut resolved: Vec<GraphEndpoint> = targets
        .iter()
        .filter_map(|target| {
            if let Some(code) = graph.code_by_endpoint.get(target) {
                return Some(GraphEndpoint::Code((*code).clone()));
            }
            graph
                .doc_by_endpoint
                .get(target)
                .map(|doc| GraphEndpoint::Doc((*doc).clone()))
        })
        .collect();

    resolved.sort_by(|left, right| compare_endpoint_order(&order_key(left), &order_key(right)));
    resolved
}

fn order_key(endpoint: &GraphEndpoint) -> EndpointOrderKey<'_> {
    let location = endpoint.location();
    EndpointOrderKey {
        file_path: &location.file_path,
        line: location.line,
        column: location.column,
        endpoint: endpoint.endpoint(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::types::{CodeKind, CodeLanguage, DocKind, LinkAnnotation, SourceLocation};

    fn location(file_path: &str, line: u64) -> SourceLocation {
        SourceLocation {
            file_path: file_path.to_string(),
            line,
            column: 1,
        }
    }

    fn symbol(file_path: &str, name: &str, line: u64) -> CodeSymbolEndpoint {
        CodeSymbolEndpoint {
            kind: CodeKind::Code,
            language: CodeLanguage::Typescript,
            file_path: file_path.to_string(),
            symbol_name: name.to_string(),
            canonical_id: name.to_string(),
            endpoint: format!("{file_path}#{name}"),
            location: location(file_path, line),
            is_member: None,
            name_range: None,
            declaration_range: None,
            signature_range: None,
        }
    }

    fn anchor(file_path: &str, name: &str, line: u64) -> DocAnchorEndpoint {
        DocAnchorEndpoint {
            kind: DocKind::Doc,
            file_path: file_path.to_string(),
            anchor: name.to_string(),
            endpoint: format!("{file_path}#{name}"),
            heading_text: name.to_string(),
            location: location(file_path, line),
            heading_text_range: None,
        }
    }

    fn link(source: &str, target: &str) -> LinkAnnotation {
        LinkAnnotation {
            source: source.to_string(),
            target: target.to_string(),
            location: location("x", 1),
            target_range: None,
        }
    }

    fn code_file(
        file_path: &str,
        symbols: Vec<CodeSymbolEndpoint>,
        links: Vec<LinkAnnotation>,
    ) -> CodeScanResult {
        CodeScanResult {
            language: CodeLanguage::Typescript,
            file_path: file_path.to_string(),
            symbols,
            undocumented_symbols: Vec::new(),
            links,
            diagnostics: Vec::new(),
        }
    }

    fn doc_file(
        file_path: &str,
        anchors: Vec<DocAnchorEndpoint>,
        links: Vec<LinkAnnotation>,
    ) -> MarkdownScanResult {
        MarkdownScanResult {
            file_path: file_path.to_string(),
            anchors,
            headings: Vec::new(),
            links,
            diagnostics: Vec::new(),
        }
    }

    fn endpoints(graph: &LinkGraph<'_>, endpoint: &str) -> Vec<String> {
        counterparts_of(graph, endpoint)
            .iter()
            .map(|e| e.endpoint().to_string())
            .collect()
    }

    /// One table row: name, code files, doc files, query, expected endpoints.
    type Case = (
        &'static str,
        Vec<CodeScanResult>,
        Vec<MarkdownScanResult>,
        &'static str,
        Vec<&'static str>,
    );

    #[test]
    fn navigates_resolvable_links_in_both_directions() {
        let cases: Vec<Case> = vec![
            (
                "a one-way @doc link with no @code backlink",
                vec![code_file(
                    "src/a.ts",
                    vec![symbol("src/a.ts", "login", 4)],
                    vec![link("src/a.ts#login", "docs/a.md#spec")],
                )],
                vec![doc_file(
                    "docs/a.md",
                    vec![anchor("docs/a.md", "spec", 1)],
                    vec![],
                )],
                "docs/a.md#spec",
                vec!["src/a.ts#login"],
            ),
            (
                "a one-way @code link with no @doc pair",
                vec![code_file(
                    "src/a.ts",
                    vec![symbol("src/a.ts", "login", 4)],
                    vec![],
                )],
                vec![doc_file(
                    "docs/a.md",
                    vec![anchor("docs/a.md", "spec", 1)],
                    vec![link("docs/a.md#spec", "src/a.ts#login")],
                )],
                "src/a.ts#login",
                vec!["docs/a.md#spec"],
            ),
            (
                "a link to a missing anchor is not navigable",
                vec![code_file(
                    "src/a.ts",
                    vec![symbol("src/a.ts", "login", 4)],
                    vec![link("src/a.ts#login", "docs/a.md#missing")],
                )],
                vec![doc_file(
                    "docs/a.md",
                    vec![anchor("docs/a.md", "spec", 1)],
                    vec![],
                )],
                "src/a.ts#login",
                vec![],
            ),
            (
                "a link to a symbol that is not scanned is not navigable",
                vec![code_file("src/a.ts", vec![], vec![])],
                vec![doc_file(
                    "docs/a.md",
                    vec![anchor("docs/a.md", "spec", 1)],
                    vec![link("docs/a.md#spec", "src/a.ts#login")],
                )],
                "docs/a.md#spec",
                vec![],
            ),
            (
                "an unknown endpoint has no counterparts",
                vec![],
                vec![],
                "docs/none.md#x",
                vec![],
            ),
            (
                "counterparts are ordered by file then position and never repeated",
                vec![
                    code_file(
                        "src/b.ts",
                        vec![symbol("src/b.ts", "z", 1)],
                        vec![
                            link("src/b.ts#z", "docs/a.md#spec"),
                            link("src/b.ts#z", "docs/a.md#spec"),
                        ],
                    ),
                    code_file(
                        "src/a.ts",
                        vec![symbol("src/a.ts", "y", 9), symbol("src/a.ts", "x", 2)],
                        vec![
                            link("src/a.ts#y", "docs/a.md#spec"),
                            link("src/a.ts#x", "docs/a.md#spec"),
                        ],
                    ),
                ],
                vec![doc_file(
                    "docs/a.md",
                    vec![anchor("docs/a.md", "spec", 1)],
                    vec![link("docs/a.md#spec", "src/b.ts#z")],
                )],
                "docs/a.md#spec",
                vec!["src/a.ts#x", "src/a.ts#y", "src/b.ts#z"],
            ),
        ];
        for (name, code_files, doc_files, query, expected) in cases {
            let graph = build_link_graph(&code_files, &doc_files);
            assert_eq!(endpoints(&graph, query), expected, "{name}");
        }
    }

    #[test]
    fn keeps_the_first_occurrence_of_a_repeated_endpoint() {
        let code_files = vec![code_file(
            "src/a.ts",
            vec![symbol("src/a.ts", "dup", 2), symbol("src/a.ts", "dup", 8)],
            vec![link("src/a.ts#dup", "docs/a.md#spec")],
        )];
        let doc_files = vec![doc_file(
            "docs/a.md",
            vec![anchor("docs/a.md", "spec", 1)],
            vec![],
        )];
        let graph = build_link_graph(&code_files, &doc_files);
        let resolved = counterparts_of(&graph, "docs/a.md#spec");
        assert_eq!(resolved.len(), 1);
        assert_eq!(resolved[0].location().line, 2);
    }
}
