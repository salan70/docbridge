//! DocBridge parser gate candidate CLI (issue #200).
//!
//! `scan` speaks the schemaVersion 1 worker protocol on stdin and stdout.
//! `parse <language>` reads file paths from stdin and reports whether each one
//! parses without syntax errors, with the parse time.

mod dart;
mod models;
mod position;
mod swift;
mod syntax;

use std::fs;
use std::io::{self, BufRead, Read, Write};
use std::process::exit;
use std::time::Instant;

use models::{WorkerFile, WorkerFileResponse, WorkerRequest, WorkerResponse};
use position::PositionConverter;
use serde_json::json;

type ScanFile = fn(&WorkerFile, Option<&[String]>) -> WorkerFileResponse;

fn scanner_for(language: &str) -> Option<ScanFile> {
    match language {
        "swift" => Some(swift::scan_file),
        "dart" => Some(dart::scan_file),
        _ => None,
    }
}

fn usage_error(message: &str) -> ! {
    eprintln!("parser-gate: {message}");
    exit(2);
}

fn main() {
    let args: Vec<String> = std::env::args().skip(1).collect();
    match args
        .iter()
        .map(String::as_str)
        .collect::<Vec<_>>()
        .as_slice()
    {
        ["scan"] => run_scan(),
        ["parse", language] => run_parse(language),
        _ => usage_error("usage: parser-gate scan | parser-gate parse <swift|dart>"),
    }
}

fn run_scan() {
    let mut input = String::new();
    if let Err(error) = io::stdin().read_to_string(&mut input) {
        usage_error(&format!("failed to read stdin: {error}"));
    }
    let request: WorkerRequest = match serde_json::from_str(&input) {
        Ok(request) => request,
        Err(error) => usage_error(&format!("invalid request: {error}")),
    };
    let Some(scan_file) = scanner_for(&request.language) else {
        usage_error(&format!("unsupported language: {}", request.language));
    };

    let visibility = request.options.visibility.as_deref();
    let files = request
        .files
        .iter()
        .map(|file| scan_file(file, visibility))
        .collect();
    let response = WorkerResponse {
        schema_version: request.schema_version,
        request_id: request.request_id,
        language: request.language,
        files,
    };
    let output = serde_json::to_string(&response).expect("response serializes");
    if let Err(error) = writeln!(io::stdout(), "{output}") {
        usage_error(&format!("failed to write stdout: {error}"));
    }
}

fn run_parse(language: &str) {
    let language = match language {
        "swift" => tree_sitter_swift::LANGUAGE.into(),
        "dart" => tree_sitter_dart::LANGUAGE.into(),
        other => usage_error(&format!("unsupported language: {other}")),
    };
    let stdout = io::stdout();
    let mut out = stdout.lock();
    for line in io::stdin().lock().lines() {
        let path = match line {
            Ok(path) => path,
            Err(error) => usage_error(&format!("failed to read stdin: {error}")),
        };
        if path.is_empty() {
            continue;
        }
        let record = match fs::read(&path).map(String::from_utf8) {
            Ok(Ok(content)) => parse_record(&language, &path, &content),
            _ => json!({ "path": path, "unreadable": true }),
        };
        if let Err(error) = writeln!(out, "{record}") {
            usage_error(&format!("failed to write stdout: {error}"));
        }
    }
}

fn parse_record(language: &tree_sitter::Language, path: &str, content: &str) -> serde_json::Value {
    let started = Instant::now();
    let tree = syntax::parse(language, content);
    let micros = started.elapsed().as_micros() as u64;
    let error = tree.as_ref().and_then(syntax::first_error);
    let location = error.map(|node| {
        let position = PositionConverter::new(content).position(node.start_byte());
        json!({ "line": position.line, "column": position.column })
    });
    json!({
        "path": path,
        "accepted": tree.is_some() && error.is_none(),
        "error": location,
        "micros": micros,
    })
}
