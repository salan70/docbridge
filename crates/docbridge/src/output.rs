use serde::Serialize;

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
pub struct QueryDiagnostic {
    pub code: String,
    pub path: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub line: Option<usize>,
    pub message: String,
    /// Pasteable section IDs offered when a section selector matches nothing.
    #[serde(skip_serializing_if = "Vec::is_empty")]
    pub candidates: Vec<String>,
}

impl QueryDiagnostic {
    pub fn new(code: &str, path: &str, line: Option<usize>, message: impl Into<String>) -> Self {
        Self {
            code: code.into(),
            path: path.into(),
            line,
            message: message.into(),
            candidates: Vec::new(),
        }
    }
}

#[derive(Debug, Clone, Serialize)]
pub struct Node {
    pub id: String,
    pub kind: String,
    pub path: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub title: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub level: Option<u8>,
    pub parents: Vec<String>,
    pub line: usize,
    pub end_line: usize,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub content: Option<ContentReference>,
    #[serde(skip_serializing_if = "Vec::is_empty")]
    pub children: Vec<Node>,
    /// Non-overlapping uncovered ranges; present on unlinked Markdown regions.
    #[serde(skip_serializing_if = "Vec::is_empty")]
    pub regions: Vec<Region>,
    /// Whether a selector named this node; text output only, never JSON.
    #[serde(skip)]
    pub selected: bool,
    #[serde(skip)]
    pub start: usize,
    #[serde(skip)]
    pub end: usize,
}

#[derive(Debug, Clone, Serialize)]
pub struct Region {
    pub start_line: usize,
    pub end_line: usize,
}

#[derive(Debug, Clone, Serialize)]
pub struct ContentReference {
    pub block: String,
    pub start_line: usize,
    pub end_line: usize,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq, PartialOrd, Ord)]
pub struct Edge {
    pub source: String,
    pub target: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct ContentBlock {
    pub id: String,
    pub path: String,
    pub start_line: usize,
    pub end_line: usize,
    pub text: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct Graph {
    pub nodes: Vec<Node>,
    pub edges: Vec<Edge>,
    pub diagnostics: Vec<QueryDiagnostic>,
    pub complete: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub contents: Option<Vec<ContentBlock>>,
}

impl Graph {
    pub fn text(&self, content: bool) -> String {
        fn label(node: &Node) -> String {
            let heading = match (node.level, node.title.as_deref()) {
                (Some(level), Some(title)) => format!(" {} {title}", "#".repeat(level as usize)),
                _ => String::new(),
            };
            format!("{}{}", node.id, heading)
        }
        fn nested(node: &Node, indent: usize, out: &mut String) {
            out.push_str(&format!("{}{}\n", "  ".repeat(indent), label(node)));
            for child in &node.children {
                nested(child, indent + 1, out);
            }
        }
        let mut out = String::new();
        if content {
            out.push_str("Links\n");
        }
        // Selected nodes first, then non-code nodes, then code nodes.
        let mut nodes: Vec<_> = self.nodes.iter().collect();
        nodes.sort_by_key(|n| {
            (
                if n.selected {
                    0
                } else if n.kind != "code" {
                    1
                } else {
                    2
                },
                &n.path,
                n.line,
                &n.id,
            )
        });
        for node in nodes {
            nested(node, node.parents.len(), &mut out);
            let mut incoming = false;
            for edge in &self.edges {
                if edge.source == node.id {
                    out.push_str(&format!("  -> {}\n", edge.target));
                } else if edge.target == node.id && node.selected && node.kind == "code" {
                    incoming = true;
                    out.push_str(&format!("  <- {}\n", edge.source));
                }
            }
            if node.selected && node.kind == "code" && !incoming {
                out.push_str("  (no incoming links)\n");
            }
        }
        if let Some(blocks) = &self.contents {
            out.push_str("\nContents\n");
            for block in blocks {
                out.push_str(&format!(
                    "{}:{}-{}\n",
                    block.path, block.start_line, block.end_line
                ));
                out.push_str(&block.text);
                if !block.text.ends_with('\n') {
                    out.push('\n');
                }
                let mut refs: Vec<_> = self
                    .nodes
                    .iter()
                    .filter(|n| n.content.as_ref().is_some_and(|r| r.block == block.id))
                    .collect();
                refs.sort_by_key(|n| (n.start, std::cmp::Reverse(n.end)));
                for node in refs.iter().skip(1) {
                    out.push_str(&format!(
                        "{}: content already present above (lines {}-{})\n",
                        node.id, node.line, node.end_line
                    ));
                }
            }
        }
        out
    }
}
