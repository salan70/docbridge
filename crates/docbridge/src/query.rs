use crate::{
    config,
    output::{ContentBlock, ContentReference, Graph, Node, QueryDiagnostic, Region},
    project::{line_at, Project},
};
use std::collections::{BTreeMap, BTreeSet};

pub fn links(project: &Project, selectors: &[String], include_content: bool) -> Graph {
    let mut selected = BTreeSet::new();
    let mut diagnostics = project.diagnostics.clone();
    if selectors.is_empty() {
        selected.extend(project.nodes.keys().cloned());
    }
    for selector in selectors.iter().collect::<BTreeSet<_>>() {
        let (path, section) = selector
            .split_once('#')
            .map_or((selector.as_str(), None), |(p, s)| (p, Some(s)));
        if let Err(e) = config::validate_path(path, path.contains('*')) {
            diagnostics.push(QueryDiagnostic::new("selector", path, None, e));
            continue;
        }
        if section.is_some() {
            if path.contains('*') || section == Some("") || !project.nodes.contains_key(selector) {
                diagnostics.push(QueryDiagnostic::new(
                    "selector",
                    path,
                    None,
                    format!("section does not exist: {selector}"),
                ));
            } else {
                selected.insert(selector.clone());
            }
        } else if path.contains('*') {
            selected.extend(
                project
                    .nodes
                    .values()
                    .filter(|n| config::glob_matches(path, &n.path))
                    .map(|n| n.id.clone()),
            );
        } else if project.files.contains_key(path) {
            selected.extend(
                project
                    .nodes
                    .values()
                    .filter(|n| n.path == path)
                    .map(|n| n.id.clone()),
            );
        } else {
            diagnostics.push(QueryDiagnostic::new(
                "selector",
                path,
                None,
                format!("file is not a discovered managed file: {path}"),
            ));
        }
    }
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
    let mut nodes: Vec<_> = retained
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
