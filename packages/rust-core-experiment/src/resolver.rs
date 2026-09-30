//! Port of `resolveLinks` from `src/link/resolver.ts`.
//!
//! Resolves scanner outputs into relationship diagnostics under the pair-based
//! model of `docs/specs/link-resolution.md`, plus the audit rules of
//! `docs/specs/diagnostics.md`. The upstream scan diagnostics are not
//! re-emitted; the caller merges and sorts the two sets. Emission order is the
//! TypeScript order, because the final stable sort keeps it for equal keys.

use std::collections::HashSet;

use crate::diagnostics::{collect_errored_files, pluralize};
use crate::endpoint::file_path_of;
use crate::types::{
    CodeScanResult, DiagnosticCode, DiagnosticSeverity, DocAnchorEndpoint, DocBridgeDiagnostic,
    DocHeadingOutline, LinkAnnotation, MarkdownScanResult,
};

pub struct ResolveInput<'a> {
    /// One per scanned code file, including files that hit a parse error.
    pub code_files: &'a [CodeScanResult],
    /// One per scanned `.md` file.
    pub doc_files: &'a [MarkdownScanResult],
    /// Diagnostics collected upstream; only used to suppress derived diagnostics.
    pub scan_diagnostics: &'a [DocBridgeDiagnostic],
    pub audit: bool,
}

/// Resolve scanner outputs into relationship diagnostics (unsorted).
pub fn resolve_links(input: &ResolveInput) -> Vec<DocBridgeDiagnostic> {
    let mut diagnostics = Vec::new();

    let errored_files = collect_errored_files(input.scan_diagnostics);
    let doc_file_paths: HashSet<&str> = input
        .doc_files
        .iter()
        .map(|f| f.file_path.as_str())
        .collect();
    let code_file_paths: HashSet<&str> = input
        .code_files
        .iter()
        .map(|f| f.file_path.as_str())
        .collect();

    // Anchors present per doc file, keyed by their full `file#anchor` endpoint.
    let doc_anchor_endpoints: HashSet<&str> = input
        .doc_files
        .iter()
        .flat_map(|file| file.anchors.iter().map(|anchor| anchor.endpoint.as_str()))
        .collect();

    // All directed links, used to find matching backlinks. A pair is valid only
    // when both directions exist between the same endpoints.
    let doc_to_code_pairs: HashSet<String> = input
        .doc_files
        .iter()
        .filter(|file| !errored_files.contains(&file.file_path))
        .flat_map(|file| {
            file.links
                .iter()
                .map(|link| pair_key(&link.source, &link.target))
        })
        .collect();
    let code_to_doc_pairs: HashSet<String> = input
        .code_files
        .iter()
        .filter(|file| !errored_files.contains(&file.file_path))
        .flat_map(|file| {
            file.links
                .iter()
                .map(|link| pair_key(&link.source, &link.target))
        })
        .collect();

    // Resolve each code `@doc` link (code -> doc).
    for file in input.code_files {
        if errored_files.contains(&file.file_path) {
            // Links originating from an errored file are derived from it; suppress.
            continue;
        }
        for link in &file.links {
            let doc_endpoint = link.target.as_str();
            let doc_file_path = file_path_of(doc_endpoint);

            // Suppress when the targeted doc file is errored (read/parse failure).
            if errored_files.contains(doc_file_path) {
                continue;
            }

            if !doc_file_paths.contains(doc_file_path) {
                diagnostics.push(relationship_diagnostic(
                    DiagnosticCode::DocFileNotFound,
                    link,
                    format!(
                        "Doc file {doc_file_path} referenced by {} is not in the managed docs set.",
                        link.source
                    ),
                ));
                continue;
            }

            if !doc_anchor_endpoints.contains(doc_endpoint) {
                diagnostics.push(relationship_diagnostic(
                    DiagnosticCode::DocAnchorNotFound,
                    link,
                    format!(
                        "Doc anchor {doc_endpoint} referenced by {} does not exist.",
                        link.source
                    ),
                ));
                continue;
            }

            // Anchor exists; require a matching @code backlink to this exact endpoint.
            if !doc_to_code_pairs.contains(&pair_key(doc_endpoint, &link.source)) {
                diagnostics.push(relationship_diagnostic(
                    DiagnosticCode::DocBacklinkNotFound,
                    link,
                    format!(
                        "Doc anchor {doc_endpoint} has no matching @code backlink to {}.",
                        link.source
                    ),
                ));
            }
        }
    }

    // Resolve each Markdown `@code` link (doc -> code).
    for file in input.doc_files {
        if errored_files.contains(&file.file_path) {
            // Links originating from an errored doc file are derived from it.
            continue;
        }
        for link in &file.links {
            let code_endpoint = link.target.as_str();
            let code_file_path = file_path_of(code_endpoint);

            // Suppress when the targeted code file is errored (read/parse failure).
            if errored_files.contains(code_file_path) {
                continue;
            }

            if !code_file_paths.contains(code_file_path) {
                diagnostics.push(relationship_diagnostic(
                    DiagnosticCode::CodeFileNotFound,
                    link,
                    format!(
                        "Code file {code_file_path} referenced by {} is not in the managed code set.",
                        link.source
                    ),
                ));
                continue;
            }

            // File exists; require a matching @doc pair back to this doc endpoint.
            if !code_to_doc_pairs.contains(&pair_key(code_endpoint, &link.source)) {
                diagnostics.push(relationship_diagnostic(
                    DiagnosticCode::CodeBacklinkNotFound,
                    link,
                    format!(
                        "Code endpoint {code_endpoint} has no matching @doc pair back to {}.",
                        link.source
                    ),
                ));
            }
        }
    }

    if input.audit {
        diagnostics.extend(audit_undocumented_symbols(input, &errored_files));
        diagnostics.extend(audit_unlinked_doc_sections(input, &errored_files));
    }

    diagnostics
}

/// Audit rule: emit `undocumented_symbol` for supported exported code
/// endpoints that have no `@doc` annotation, skipping type members.
fn audit_undocumented_symbols(
    input: &ResolveInput,
    errored_files: &HashSet<String>,
) -> Vec<DocBridgeDiagnostic> {
    let mut diagnostics = Vec::new();
    for file in input.code_files {
        if errored_files.contains(&file.file_path) {
            continue;
        }
        for symbol in &file.undocumented_symbols {
            // A member is linkable without being required to document itself.
            if symbol.is_member == Some(true) {
                continue;
            }
            diagnostics.push(DocBridgeDiagnostic {
                severity: DiagnosticSeverity::Warning,
                code: DiagnosticCode::UndocumentedSymbol,
                language: Some(symbol.language),
                target: symbol.endpoint.clone(),
                source: None,
                message: format!(
                    "Exported symbol {} has no @doc annotation.",
                    symbol.endpoint
                ),
                location: Some(symbol.location.clone()),
                range: None,
            });
        }
    }
    diagnostics
}

/// A heading and the headings nested under it, reconstructed from heading levels.
struct HeadingNode<'a> {
    heading: &'a DocHeadingOutline,
    children: Vec<HeadingNode<'a>>,
}

/// Audit rule: emit `unlinked_doc_section` for documentation sections that
/// have no `@code` annotation anywhere in their subtree, rolled up to the
/// topmost heading of each fully unannotated subtree.
fn audit_unlinked_doc_sections(
    input: &ResolveInput,
    errored_files: &HashSet<String>,
) -> Vec<DocBridgeDiagnostic> {
    let mut diagnostics = Vec::new();
    for file in input.doc_files {
        if errored_files.contains(&file.file_path) {
            continue;
        }
        report_unlinked_sections(&build_heading_tree(&file.headings), &mut diagnostics);
    }
    diagnostics
}

/// Rebuild the document's heading tree from the outline in document order: a
/// heading's subtree runs until the next heading whose level is less than or
/// equal to its own. Empty headings create no anchor yet still close the
/// preceding section, which is why the outline is used rather than the anchors.
fn build_heading_tree(headings: &[DocHeadingOutline]) -> Vec<HeadingNode<'_>> {
    // Each open ancestor is addressed by its path of child indexes from the
    // roots, so nodes can be pushed into the tree without shared ownership.
    let mut roots: Vec<HeadingNode<'_>> = Vec::new();
    let mut open_levels: Vec<u64> = Vec::new();
    let mut open_path: Vec<usize> = Vec::new();

    for heading in headings {
        while open_levels
            .last()
            .is_some_and(|level| *level >= heading.level)
        {
            open_levels.pop();
            open_path.pop();
        }

        let node = HeadingNode {
            heading,
            children: Vec::new(),
        };
        let siblings = match open_path.split_first() {
            None => &mut roots,
            Some((first, rest)) => {
                let mut parent = &mut roots[*first];
                for index in rest {
                    parent = &mut parent.children[*index];
                }
                &mut parent.children
            }
        };
        siblings.push(node);
        open_path.push(siblings.len() - 1);
        open_levels.push(heading.level);
    }

    roots
}

/// Walk the tree, reporting the topmost reportable node of every fully
/// unannotated subtree. An empty heading cannot be reported, so reporting
/// descends through it to its children.
fn report_unlinked_sections(nodes: &[HeadingNode<'_>], diagnostics: &mut Vec<DocBridgeDiagnostic>) {
    for node in nodes {
        match &node.heading.anchor {
            Some(anchor) if !subtree_has_annotation(node) => {
                diagnostics.push(unlinked_doc_section_diagnostic(node, anchor));
            }
            _ => report_unlinked_sections(&node.children, diagnostics),
        }
    }
}

fn subtree_has_annotation(node: &HeadingNode<'_>) -> bool {
    node.heading.has_code_annotation || node.children.iter().any(subtree_has_annotation)
}

fn count_descendants(node: &HeadingNode<'_>) -> usize {
    node.children
        .iter()
        .map(|child| 1 + count_descendants(child))
        .sum()
}

fn unlinked_doc_section_diagnostic(
    node: &HeadingNode<'_>,
    anchor: &DocAnchorEndpoint,
) -> DocBridgeDiagnostic {
    let suppressed = count_descendants(node);
    let suffix = if suppressed == 0 {
        String::new()
    } else {
        format!(
            " ({suppressed} descendant {} suppressed)",
            pluralize("heading", suppressed)
        )
    };
    DocBridgeDiagnostic {
        severity: DiagnosticSeverity::Warning,
        code: DiagnosticCode::UnlinkedDocSection,
        target: anchor.endpoint.clone(),
        language: None,
        source: None,
        message: format!(
            "Doc section {} has no @code annotation{suffix}.",
            anchor.endpoint
        ),
        location: Some(anchor.location.clone()),
        range: anchor.heading_text_range.clone(),
    }
}

fn pair_key(source: &str, target: &str) -> String {
    format!("{source}->{target}")
}

fn relationship_diagnostic(
    code: DiagnosticCode,
    link: &LinkAnnotation,
    message: String,
) -> DocBridgeDiagnostic {
    DocBridgeDiagnostic {
        severity: DiagnosticSeverity::Error,
        code,
        source: Some(link.source.clone()),
        target: link.target.clone(),
        language: None,
        message,
        location: Some(link.location.clone()),
        range: link.target_range.clone(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::types::{DocKind, SourceLocation};

    fn outline(level: u64, anchor: Option<&str>, annotated: bool, line: u64) -> DocHeadingOutline {
        DocHeadingOutline {
            level,
            has_code_annotation: annotated,
            anchor: anchor.map(|name| DocAnchorEndpoint {
                kind: DocKind::Doc,
                file_path: "docs/a.md".to_string(),
                anchor: name.to_string(),
                endpoint: format!("docs/a.md#{name}"),
                heading_text: name.to_string(),
                location: SourceLocation {
                    file_path: "docs/a.md".to_string(),
                    line,
                    column: 1,
                },
                heading_text_range: None,
            }),
        }
    }

    fn reported(headings: &[DocHeadingOutline]) -> Vec<String> {
        let mut diagnostics = Vec::new();
        report_unlinked_sections(&build_heading_tree(headings), &mut diagnostics);
        diagnostics.into_iter().map(|d| d.message).collect()
    }

    #[test]
    fn rolls_unlinked_sections_up_to_the_topmost_unannotated_heading() {
        let cases: Vec<(&str, Vec<DocHeadingOutline>, Vec<&str>)> = vec![
            (
                "one root with two unannotated descendants",
                vec![outline(1, Some("a"), false, 1), outline(3, Some("b"), false, 3), outline(2, Some("c"), false, 5)],
                vec!["Doc section docs/a.md#a has no @code annotation (2 descendant headings suppressed)."],
            ),
            (
                "an annotated descendant bridges the whole subtree",
                vec![outline(1, Some("a"), false, 1), outline(2, Some("b"), true, 3), outline(3, Some("c"), false, 5)],
                vec!["Doc section docs/a.md#c has no @code annotation."],
            ),
            (
                "an empty heading closes the section before it",
                vec![outline(3, Some("parent"), false, 1), outline(2, None, false, 3), outline(4, Some("child"), false, 5)],
                vec![
                    "Doc section docs/a.md#parent has no @code annotation.",
                    "Doc section docs/a.md#child has no @code annotation.",
                ],
            ),
            (
                "reporting descends through an empty heading to its children",
                vec![outline(1, Some("a"), true, 1), outline(2, None, false, 3), outline(3, Some("b"), false, 5), outline(3, Some("c"), false, 7)],
                vec![
                    "Doc section docs/a.md#b has no @code annotation.",
                    "Doc section docs/a.md#c has no @code annotation.",
                ],
            ),
            (
                "a document starting at ## roots there",
                vec![outline(2, Some("a"), false, 1), outline(1, Some("b"), false, 3), outline(2, Some("c"), false, 5)],
                vec![
                    "Doc section docs/a.md#a has no @code annotation.",
                    "Doc section docs/a.md#b has no @code annotation (1 descendant heading suppressed).",
                ],
            ),
            ("no headings", vec![], vec![]),
        ];
        for (name, headings, expected) in cases {
            assert_eq!(reported(&headings), expected, "{name}");
        }
    }
}
