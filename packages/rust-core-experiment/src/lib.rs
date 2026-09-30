//! DocBridge Phase 0 experiment: the link resolver and graph ported to Rust.
//!
//! The crate exists to evaluate a Rust core (issue #172). It ports
//! `src/link/resolver.ts`, `src/link/graph.ts`, and the helpers they depend on,
//! and exposes them through `phase0-runner`, a JSON-in/JSON-out binary that the
//! parity harness diffs against the frozen TypeScript outputs.

pub mod collation;
pub mod diagnostics;
pub mod endpoint;
pub mod graph;
pub mod path_order;
pub mod resolver;
pub mod types;

use serde::{Deserialize, Serialize};

use crate::diagnostics::sort_diagnostics;
use crate::graph::{build_link_graph, counterparts_of};
use crate::resolver::{resolve_links, ResolveInput};
use crate::types::{CodeScanResult, DocBridgeDiagnostic, GraphEndpoint, MarkdownScanResult};

/// The document `phase0-runner` reads on stdin.
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Phase0Input {
    pub code_files: Vec<CodeScanResult>,
    pub doc_files: Vec<MarkdownScanResult>,
    pub scan_diagnostics: Vec<DocBridgeDiagnostic>,
    pub audit: bool,
    pub queries: Vec<String>,
}

/// The document `phase0-runner` writes on stdout.
#[derive(Debug, Serialize)]
pub struct Phase0Output {
    /// The scan diagnostics plus the relationship diagnostics, sorted.
    pub diagnostics: Vec<DocBridgeDiagnostic>,
    /// The ordered `counterpartsOf` result per query.
    pub counterparts: serde_json::Map<String, serde_json::Value>,
}

/// Run the resolver and the graph over one input document.
pub fn run(input: &Phase0Input) -> Phase0Output {
    let relationship = resolve_links(&ResolveInput {
        code_files: &input.code_files,
        doc_files: &input.doc_files,
        scan_diagnostics: &input.scan_diagnostics,
        audit: input.audit,
    });
    let mut merged: Vec<DocBridgeDiagnostic> = input.scan_diagnostics.clone();
    merged.extend(relationship);

    let graph = build_link_graph(&input.code_files, &input.doc_files);
    let mut counterparts = serde_json::Map::new();
    for query in &input.queries {
        let resolved: Vec<GraphEndpoint> = counterparts_of(&graph, query);
        let value = serde_json::to_value(resolved).expect("counterparts serialize");
        counterparts.insert(query.clone(), value);
    }

    Phase0Output {
        diagnostics: sort_diagnostics(&merged),
        counterparts,
    }
}

/// Parse one input document, run it, and serialize the output.
pub fn run_json(input: &str) -> Result<String, serde_json::Error> {
    let parsed: Phase0Input = serde_json::from_str(input)?;
    serde_json::to_string(&run(&parsed))
}
