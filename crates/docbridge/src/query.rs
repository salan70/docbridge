use crate::{
    config,
    output::{ContentBlock, ContentReference, Edge, Graph, Node, QueryDiagnostic, Region},
    project::{line_at, slug, Project},
};
use std::{
    collections::{BTreeMap, BTreeSet},
    fs,
    path::Path,
};

/// Whether `relative` resolves to a directory under `root`. Links, missing
/// components, and misspelled names are not directories; see [`paths::resolve`].
fn directory(root: &Path, relative: &str) -> bool {
    crate::paths::resolve(root, relative)
        .ok()
        .and_then(|path| fs::symlink_metadata(path).ok())
        .is_some_and(|metadata| metadata.is_dir())
}

/// Resolve selectors into selected node IDs, appending one diagnostic per
/// rejected selector. `links --sections` (`sections_only`) contributes only
/// section nodes and rejects section selectors; `links` contributes every
/// node and resolves section selectors. File selectors — paths and globs —
/// share one interpretation so new selector features apply to both. Under
/// `ignore_unmanaged`, a selector naming a path outside the managed set is
/// skipped without a diagnostic; a managed path keeps its rejection.
fn resolve_selectors(
    project: &Project,
    selectors: &[String],
    sections_only: bool,
    ignore_unmanaged: bool,
    selected: &mut BTreeSet<String>,
    diagnostics: &mut Vec<QueryDiagnostic>,
) {
    let eligible = |node: &&Node| !sections_only || node.kind == "section";
    if selectors.is_empty() {
        selected.extend(
            project
                .nodes
                .values()
                .filter(&eligible)
                .map(|n| n.id.clone()),
        );
    }
    for selector in selectors.iter().collect::<BTreeSet<_>>() {
        let (path, section) = selector
            .split_once('#')
            .map_or((selector.as_str(), None), |(p, s)| (p, Some(s)));
        if sections_only && section.is_some() {
            diagnostics.push(QueryDiagnostic::new(
                "selector",
                path,
                None,
                format!("--sections accepts file selectors, not section selectors: {selector}"),
            ));
            continue;
        }
        // `dir/` spells the directory `dir` when that directory exists.
        let path = match path.strip_suffix('/') {
            Some(stripped) if directory(&project.root, stripped) => stripped,
            _ => path,
        };
        if let Err(e) = config::validate_path(path, path.contains('*')) {
            diagnostics.push(QueryDiagnostic::new("selector", path, None, e));
            continue;
        }
        if let Some(fragment) = section {
            if path.contains('*') {
                diagnostics.push(QueryDiagnostic::new(
                    "selector",
                    path,
                    None,
                    format!("section does not exist: {selector}"),
                ));
            } else if !project.nodes.contains_key(selector) {
                if !ignore_unmanaged || project.manages(path) {
                    let mut diagnostic = QueryDiagnostic::new(
                        "selector",
                        path,
                        None,
                        format!("section does not exist: {selector}"),
                    );
                    diagnostic.candidates = section_candidates(project, path, fragment);
                    diagnostics.push(diagnostic);
                }
            } else {
                selected.insert(selector.clone());
            }
        } else if path.contains('*') {
            selected.extend(
                project
                    .nodes
                    .values()
                    .filter(|n| eligible(n) && config::glob_matches(path, &n.path))
                    .map(|n| n.id.clone()),
            );
        } else if project.files.contains_key(path) {
            selected.extend(
                project
                    .nodes
                    .values()
                    .filter(|n| eligible(n) && n.path == path)
                    .map(|n| n.id.clone()),
            );
        } else if directory(&project.root, path) {
            let recursive = format!("{path}/**");
            selected.extend(
                project
                    .nodes
                    .values()
                    .filter(|n| eligible(n) && config::glob_matches(&recursive, &n.path))
                    .map(|n| n.id.clone()),
            );
        } else if !ignore_unmanaged || project.manages(path) {
            diagnostics.push(QueryDiagnostic::new(
                "selector",
                path,
                None,
                format!("file is not a discovered managed file: {path}"),
            ));
        }
    }
}

pub fn links(
    project: &Project,
    selectors: &[String],
    include_content: bool,
    ignore_unmanaged: bool,
) -> Graph {
    let mut selected = BTreeSet::new();
    let mut diagnostics = project.diagnostics.clone();
    resolve_selectors(
        project,
        selectors,
        false,
        ignore_unmanaged,
        &mut selected,
        &mut diagnostics,
    );
    let edges: Vec<_> = project
        .edges
        .iter()
        .filter(|e| selected.contains(&e.source) || selected.contains(&e.target))
        .cloned()
        .collect();
    let mut retained = selected;
    for edge in &edges {
        retained.insert(edge.source.clone());
        retained.insert(edge.target.clone());
    }
    graph(project, retained, edges, diagnostics, include_content)
}

/// The section IDs of the selected files, without traversing any link edges.
pub fn sections(
    project: &Project,
    selectors: &[String],
    include_content: bool,
    ignore_unmanaged: bool,
) -> Graph {
    let mut selected = BTreeSet::new();
    let mut diagnostics = project.diagnostics.clone();
    resolve_selectors(
        project,
        selectors,
        true,
        ignore_unmanaged,
        &mut selected,
        &mut diagnostics,
    );
    graph(project, selected, Vec::new(), diagnostics, include_content)
}

fn graph(
    project: &Project,
    selected: BTreeSet<String>,
    edges: Vec<Edge>,
    mut diagnostics: Vec<QueryDiagnostic>,
    include_content: bool,
) -> Graph {
    let mut nodes: Vec<_> = selected
        .iter()
        .filter_map(|id| project.nodes.get(id).cloned())
        .collect();
    nodes.sort_by(|a, b| (&a.path, a.line, &a.id).cmp(&(&b.path, b.line, &b.id)));
    diagnostics.sort_by(|a, b| {
        (&a.path, a.line, &a.code, &a.message).cmp(&(&b.path, b.line, &b.code, &b.message))
    });
    diagnostics.dedup();
    let complete = project.complete && diagnostics.is_empty();
    let contents = include_content.then(|| content_blocks(project, &mut nodes));
    Graph {
        nodes,
        edges,
        diagnostics,
        complete,
        contents,
    }
}

/// The longest candidate list a failed section selector reports.
const MAX_CANDIDATES: usize = 10;

/// Section IDs of `path` that best match `fragment`: every ID whose section
/// path ends with the fragment at a segment boundary, then the closest by edit
/// distance to the fragment, in deterministic order. Fragment segments are
/// slugged like heading titles, so `#Camera Rig` matches `…/camera-rig`.
fn section_candidates(project: &Project, path: &str, fragment: &str) -> Vec<String> {
    let prefix = format!("{path}#");
    let normalized = fragment
        .split('/')
        .map(|segment| {
            if segment.is_empty() {
                String::new()
            } else {
                slug(segment)
            }
        })
        .collect::<Vec<_>>()
        .join("/");
    let suffix = format!("/{normalized}");
    let mut candidates = Vec::new();
    let mut rest = Vec::new();
    for id in project.nodes.keys() {
        let Some(relative) = id.strip_prefix(&prefix) else {
            continue;
        };
        if relative.ends_with(&suffix) {
            candidates.push(id.clone());
        } else {
            rest.push(relative);
        }
    }
    if fragment.is_empty() {
        // Nothing to match: list the shortest full section IDs first.
        rest.sort_by_cached_key(|relative| (relative.chars().count(), *relative));
    } else {
        rest.sort_by_cached_key(|relative| {
            (
                edit_distance(&normalized, relative).min(edit_distance(
                    &normalized,
                    relative.rsplit('/').next().unwrap_or(relative),
                )),
                *relative,
            )
        });
    }
    candidates.extend(
        rest.into_iter()
            .map(|relative| format!("{prefix}{relative}")),
    );
    candidates.truncate(MAX_CANDIDATES);
    candidates
}

fn edit_distance(a: &str, b: &str) -> usize {
    let b: Vec<char> = b.chars().collect();
    let mut previous: Vec<usize> = (0..=b.len()).collect();
    let mut current = vec![0; b.len() + 1];
    for (i, ca) in a.chars().enumerate() {
        current[0] = i + 1;
        for (j, cb) in b.iter().enumerate() {
            current[j + 1] = (previous[j] + usize::from(ca != *cb))
                .min(previous[j + 1] + 1)
                .min(current[j] + 1);
        }
        std::mem::swap(&mut previous, &mut current);
    }
    previous[b.len()]
}

fn content_blocks(project: &Project, nodes: &mut [Node]) -> Vec<ContentBlock> {
    let mut ranges: BTreeMap<String, Vec<(usize, usize)>> = BTreeMap::new();
    for node in nodes.iter() {
        ranges
            .entry(node.path.clone())
            .or_default()
            .push((node.start, node.end));
    }
    let mut blocks = Vec::new();
    for (path, mut ranges) in ranges {
        ranges.sort_unstable();
        let mut merged: Vec<(usize, usize)> = Vec::new();
        for (start, end) in ranges {
            if let Some(last) = merged
                .last_mut()
                .filter(|last| start < last.1 || (start == last.0 && end == last.1))
            {
                last.1 = last.1.max(end);
            } else {
                merged.push((start, end));
            }
        }
        let source = &project.files[&path].text;
        for (start, end) in merged {
            let start_line = line_at(source, start);
            let end_line = if end > start {
                line_at(source, end - 1)
            } else {
                start_line
            };
            let id = format!("{path}:{start_line}-{end_line}");
            for node in nodes
                .iter_mut()
                .filter(|n| n.path == path && n.start >= start && n.end <= end)
            {
                node.content = Some(ContentReference {
                    block: id.clone(),
                    start_line: node.line,
                    end_line: node.end_line,
                });
            }
            blocks.push(ContentBlock {
                id,
                path: path.clone(),
                start_line,
                end_line,
                text: source[start..end].to_string(),
            });
        }
    }
    blocks
}

pub fn unlinked(project: &Project) -> Graph {
    let linked: BTreeSet<_> = project.edges.iter().map(|e| e.source.as_str()).collect();
    let linked_code: BTreeSet<_> = project.edges.iter().map(|e| e.target.as_str()).collect();
    let mut nodes = Vec::new();
    for node in project.nodes.values().filter(|n| n.kind == "code") {
        if !linked_code.contains(node.id.as_str()) {
            nodes.push(node.clone());
        }
    }
    for (path, file) in &project.files {
        let Some(document) = &file.document else {
            continue;
        };
        let mut sections: Vec<_> = project
            .nodes
            .values()
            .filter(|n| n.path == *path && n.kind == "section")
            .collect();
        sections.sort_by_key(|n| n.line);
        let mut regions: BTreeMap<String, Node> = BTreeMap::new();
        for section in &sections {
            if linked.contains(section.id.as_str())
                || section.parents.iter().any(|p| linked.contains(p.as_str()))
            {
                continue;
            }
            let mut node = (*section).clone();
            let mut cursor = node.start;
            // A valid link covers the entire descendant subtree, not its ancestors.
            for covered in sections.iter().filter(|s| {
                linked.contains(s.id.as_str()) && s.start >= node.start && s.end <= node.end
            }) {
                // Annotation lines attached to a linked child belong to that child.
                let cut = document
                    .sections
                    .iter()
                    .find(|s| s.line == covered.line)
                    .and_then(|s| s.annotations.iter().map(|a| a.line).min())
                    .map_or(covered.start, |line| {
                        line_start(&file.text, line).min(covered.start)
                    });
                if cut > cursor {
                    node.regions.push(Region {
                        start_line: line_at(&file.text, cursor),
                        end_line: line_at(&file.text, cut - 1),
                    });
                }
                cursor = cursor.max(covered.end);
            }
            if cursor < node.end {
                node.regions.push(Region {
                    start_line: line_at(&file.text, cursor),
                    end_line: line_at(&file.text, node.end - 1),
                });
            }
            regions.insert(section.id.clone(), node);
        }
        // Build bottom-up so each unlinked topmost section carries its hierarchy.
        for section in sections.iter().rev() {
            if let Some(node) = regions.remove(&section.id) {
                if let Some(parent) = section.parents.last().and_then(|p| regions.get_mut(p)) {
                    parent.children.insert(0, node);
                } else {
                    nodes.push(node);
                }
            }
        }
        let end = document
            .sections
            .first()
            .map_or(file.text.len(), |s| s.source.start);
        if meaningful(&file.text[..end]) {
            nodes.push(Node {
                id: format!("{path}#@preamble"),
                kind: "preamble".into(),
                path: path.clone(),
                title: Some("Document preamble".into()),
                level: None,
                parents: Vec::new(),
                line: 1,
                end_line: if end > 0 {
                    line_at(&file.text, end - 1)
                } else {
                    1
                },
                content: None,
                children: Vec::new(),
                regions: vec![Region {
                    start_line: 1,
                    end_line: if end > 0 {
                        line_at(&file.text, end - 1)
                    } else {
                        1
                    },
                }],
                start: 0,
                end,
            });
        }
    }
    nodes.sort_by(|a, b| (&a.path, a.line, &a.id).cmp(&(&b.path, b.line, &b.id)));
    Graph {
        nodes,
        edges: Vec::new(),
        diagnostics: project.diagnostics.clone(),
        complete: project.complete,
        contents: None,
    }
}

fn line_start(text: &str, line: usize) -> usize {
    if line <= 1 {
        return 0;
    }
    text.match_indices('\n')
        .nth(line - 2)
        .map_or(text.len(), |(i, _)| i + 1)
}

fn meaningful(text: &str) -> bool {
    let mut comment = false;
    for line in text.lines() {
        if !comment
            && (line.starts_with("    ") || line.starts_with('\t'))
            && !line.trim().is_empty()
        {
            return true;
        }
        let mut rest = line;
        loop {
            if comment {
                if let Some(end) = rest.find("-->") {
                    rest = &rest[end + 3..];
                    comment = false;
                } else {
                    break;
                }
            } else if let Some(start) = rest.find("<!--") {
                if !rest[..start].trim().is_empty() {
                    return true;
                }
                rest = &rest[start + 4..];
                comment = true;
            } else {
                if !rest.trim().is_empty() {
                    return true;
                }
                break;
            }
        }
    }
    false
}
