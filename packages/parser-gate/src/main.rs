//! DocBridge parser gate candidate CLI (issue #200).
//!
//! `scan` speaks the schemaVersion 1 worker protocol on stdin and stdout.
//! `parse <language>` reads file paths from stdin and reports whether each one
//! parses without syntax errors, with the parse time.
//! `cancel <language> <path>` starts a tree-sitter parse, requests its
//! cancellation after 50 ms, and reports how long the parse took to stop.

mod dart;
mod models;
mod parsers;
mod position;
mod swift;
mod syntax;

use std::fs;
use std::io::{self, BufRead, Read, Write};
use std::process::exit;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::thread;
use std::time::{Duration, Instant};

use models::{WorkerFile, WorkerFileResponse, WorkerRequest, WorkerResponse};
use parsers::Language;
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
        ["parse", language] => run_parse(language, None),
        ["parse", language, "--stack-mb", megabytes] => {
            let Some(megabytes) = megabytes.parse::<usize>().ok().filter(|&n| n > 0) else {
                usage_error(&format!("invalid --stack-mb: {megabytes}"));
            };
            run_parse(language, Some(megabytes));
        }
        ["cancel", language, path] => run_cancel(language, path),
        _ => usage_error(
            "usage: parser-gate scan | parser-gate parse <language> [--stack-mb N] \
             | parser-gate cancel <swift|dart> <path>",
        ),
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

fn run_parse(language: &str, stack_mb: Option<usize>) {
    let Some(language) = Language::from_name(language) else {
        usage_error(&format!("unsupported language: {language}"));
    };
    let Some(megabytes) = stack_mb else {
        parse_paths(language);
        return;
    };
    let worker = thread::Builder::new()
        .stack_size(megabytes * 1024 * 1024)
        .spawn(move || parse_paths(language));
    match worker {
        Ok(handle) => {
            if handle.join().is_err() {
                exit(1);
            }
        }
        Err(error) => usage_error(&format!("failed to start the parse thread: {error}")),
    }
}

fn parse_paths(language: Language) {
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
            Ok(Ok(content)) => parse_record(language, &path, &content),
            _ => json!({ "path": path, "unreadable": true }),
        };
        if let Err(error) = writeln!(out, "{record}") {
            usage_error(&format!("failed to write stdout: {error}"));
        }
    }
}

fn parse_record(language: Language, path: &str, content: &str) -> serde_json::Value {
    let started = Instant::now();
    let error = parsers::first_error(language, path, content);
    let micros = started.elapsed().as_micros() as u64;
    let location = error
        .as_ref()
        .map(|position| json!({ "line": position.line, "column": position.column }));
    json!({
        "path": path,
        "accepted": error.is_none(),
        "error": location,
        "micros": micros,
    })
}

fn run_cancel(language: &str, path: &str) {
    let Some(grammar) = Language::from_name(language)
        .filter(|language| matches!(language, Language::Swift | Language::Dart))
        .and_then(Language::tree_sitter)
    else {
        usage_error(&format!("cancel supports swift and dart, not {language}"));
    };
    let content = match fs::read(path).map(String::from_utf8) {
        Ok(Ok(content)) => content,
        _ => usage_error(&format!("cannot read {path} as UTF-8")),
    };
    let cancel = Arc::new(AtomicBool::new(false));
    let flag = Arc::clone(&cancel);
    let worker = thread::spawn(move || {
        let tree = parsers::parse_cancellable(&grammar, &content, &flag);
        (tree.is_none(), Instant::now())
    });
    thread::sleep(Duration::from_millis(50));
    let requested = Instant::now();
    cancel.store(true, Ordering::Relaxed);
    let (cancelled, finished) = worker.join().expect("the parse thread does not panic");
    let report = if finished < requested {
        json!({ "cancelled": false, "latencyMicros": 0 })
    } else {
        let latency = finished.duration_since(requested).as_micros() as u64;
        json!({ "cancelled": cancelled, "latencyMicros": latency })
    };
    println!("{report}");
}
