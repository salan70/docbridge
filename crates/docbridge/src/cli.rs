use crate::{
    output::{Graph, QueryDiagnostic},
    project::Project,
    query,
};
use serde_json::json;
use std::{
    collections::BTreeSet,
    path::{Path, PathBuf},
};

pub const HELP: &str = "DocBridge\n\nCommands:\n  validate  Validate configuration and Markdown links\n  links     Retrieve direct file/section links\n  unlinked  List uncovered code and Markdown regions\n  init      Initialize project assets\n  deinit    Remove project assets safely\n  docs      Read embedded guides\n\nRead commands: --json --root <directory>\nlinks: [selectors ...] --stdin --include-content\n";

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Command {
    Validate,
    Links,
    Unlinked,
    Init,
    Deinit,
    Docs,
    Help,
}

#[derive(Debug, Clone)]
pub struct Invocation {
    pub command: Command,
    pub root: PathBuf,
    pub json: bool,
    pub include_content: bool,
    pub stdin: bool,
    pub selectors: Vec<String>,
    /// Additional command owners parse these arguments in their own public handler.
    pub extra_args: Vec<String>,
}

#[derive(Debug, Clone)]
pub struct Response {
    pub stdout: String,
    pub stderr: String,
    pub exit_code: i32,
}

impl Invocation {
    pub fn parse(args: &[String], cwd: &Path) -> Result<Self, Response> {
        Self::parse_inner(args, cwd).map_err(|mut response| {
            if args.iter().any(|arg| arg == "--json") {
                let diagnostics = vec![QueryDiagnostic::new(
                    "usage",
                    "",
                    None,
                    response.stderr.trim_end(),
                )];
                response.stdout = if args.first().is_some_and(|s| s == "validate") {
                    validation_json(&diagnostics, 0, 0, false)
                } else {
                    serialize(&Graph {
                        nodes: Vec::new(),
                        edges: Vec::new(),
                        diagnostics,
                        complete: false,
                        contents: None,
                    })
                };
            }
            response
        })
    }

    fn parse_inner(args: &[String], cwd: &Path) -> Result<Self, Response> {
        let command = match args.first().map(String::as_str) {
            None | Some("--help" | "-h") => Command::Help,
            Some("validate") => Command::Validate,
            Some("links") => Command::Links,
            Some("unlinked") => Command::Unlinked,
            Some("init") => Command::Init,
            Some("deinit") => Command::Deinit,
            Some("docs") => Command::Docs,
            Some(other) => return Err(failure(3, format!("unknown command: {other}"))),
        };
        let mut invocation = Self {
            command,
            root: cwd.to_path_buf(),
            json: false,
            include_content: false,
            stdin: false,
            selectors: Vec::new(),
            extra_args: Vec::new(),
        };
        if matches!(
            invocation.command,
            Command::Init | Command::Deinit | Command::Docs
        ) {
            invocation.extra_args = args[1..].to_vec();
            return Ok(invocation);
        }
        let usage_code = if invocation.command == Command::Validate {
            1
        } else {
            3
        };
        let mut args = args.iter().skip(1);
        let mut positional = false;
        while let Some(arg) = args.next() {
            if !positional {
                match arg.as_str() {
                    "--help" | "-h" => {
                        invocation.command = Command::Help;
                        return Ok(invocation);
                    }
                    "--json" => {
                        invocation.json = true;
                        continue;
                    }
                    "--root" => {
                        let root = args
                            .next()
                            .filter(|s| !s.starts_with('-'))
                            .ok_or_else(|| failure(usage_code, "--root requires a directory"))?;
                        invocation.root = cwd.join(root);
                        continue;
                    }
                    "--stdin" if invocation.command == Command::Links => {
                        invocation.stdin = true;
                        continue;
                    }
                    "--include-content" if invocation.command == Command::Links => {
                        invocation.include_content = true;
                        continue;
                    }
                    "--" => {
                        positional = true;
                        continue;
                    }
                    value if value.starts_with('-') => {
                        return Err(failure(usage_code, format!("unknown argument: {value}")))
                    }
                    _ => {}
                }
            }
            if invocation.command != Command::Links {
                return Err(failure(usage_code, format!("unexpected argument: {arg}")));
            }
            invocation.selectors.push(arg.clone());
        }
        Ok(invocation)
    }
}

pub fn run(args: &[String], cwd: &Path, stdin: &str) -> Response {
    match Invocation::parse(args, cwd) {
        Ok(invocation) => dispatch(invocation, stdin),
        Err(response) => response,
    }
}

/// Keep lifecycle/docs wiring here; read-query implementation is independent.
pub fn dispatch_with_confirmation(
    mut invocation: Invocation,
    stdin: &str,
    mut confirm: impl FnMut(&str) -> bool,
) -> Response {
    match invocation.command {
        Command::Help => {
            return Response {
                stdout: HELP.into(),
                stderr: String::new(),
                exit_code: 0,
            }
        }
        Command::Docs => return embedded_docs(&invocation.extra_args),
        Command::Init | Command::Deinit => {
            return crate::cli_lifecycle::dispatch(invocation, &mut confirm)
        }
        _ => {}
    }
    let project = match Project::load(&invocation.root) {
        Ok(project) => project,
        Err(message) => {
            let diagnostics = vec![QueryDiagnostic::new(
                "configuration",
                "docbridge.config.json",
                None,
                message,
            )];
            let stdout = if invocation.json {
                if invocation.command == Command::Validate {
                    validation_json(&diagnostics, 0, 0, false)
                } else {
                    serialize(&Graph {
                        nodes: Vec::new(),
                        edges: Vec::new(),
                        diagnostics: diagnostics.clone(),
                        complete: false,
                        contents: None,
                    })
                }
            } else {
                String::new()
            };
            return Response {
                stdout,
                stderr: diagnostic_text(&diagnostics),
                exit_code: 1,
            };
        }
    };
    if invocation.stdin {
        invocation.selectors.extend(
            stdin
                .lines()
                .filter(|line| !line.trim().is_empty())
                .map(str::to_string),
        );
    }
    let mut seen = BTreeSet::new();
    invocation.selectors.retain(|s| seen.insert(s.clone()));
    if invocation.command == Command::Validate {
        return Response {
            stdout: if invocation.json {
                validation_json(
                    &project.diagnostics,
                    project.files.len(),
                    project.edges.len(),
                    project.complete,
                )
            } else {
                format!(
                    "{} files, {} links, {} errors\n",
                    project.files.len(),
                    project.edges.len(),
                    project.diagnostics.len()
                )
            },
            stderr: diagnostic_text(&project.diagnostics),
            exit_code: i32::from(!project.complete),
        };
    }
    // Empty stdin is an explicit empty selection, unlike a bare whole-project request.
    let graph = if invocation.command == Command::Unlinked {
        query::unlinked(&project)
    } else if invocation.stdin && invocation.selectors.is_empty() {
        Graph {
            nodes: Vec::new(),
            edges: Vec::new(),
            diagnostics: project.diagnostics.clone(),
            complete: project.complete,
            contents: invocation.include_content.then(Vec::new),
        }
    } else {
        query::links(&project, &invocation.selectors, invocation.include_content)
    };
    let exit_code = if graph.complete {
        0
    } else if invocation.command == Command::Links && !graph.nodes.is_empty() {
        2
    } else {
        1
    };
    let single = if invocation.selectors.len() == 1 {
        Some(invocation.selectors[0].as_str())
    } else {
        None
    };
    Response {
        stdout: if invocation.json {
            serialize(&graph)
        } else {
            graph.text(invocation.include_content, single)
        },
        stderr: diagnostic_text(&graph.diagnostics),
        exit_code,
    }
}

pub fn dispatch(invocation: Invocation, stdin: &str) -> Response {
    dispatch_with_confirmation(invocation, stdin, |_| false)
}

fn embedded_docs(args: &[String]) -> Response {
    let args: Vec<_> = args.iter().map(String::as_str).collect();
    let stdout = match args.as_slice() {
        [] => crate::docs::overview(),
        ["list"] => crate::docs::list(),
        ["show", name] => match crate::docs::show(name) {
            Some(content) => content.to_owned(),
            None => return failure(3, format!("unknown guide: {name}")),
        },
        ["--help" | "-h"] => "Usage: docbridge docs [list | show <name>]\n".into(),
        _ => return failure(3, "Usage: docbridge docs [list | show <name>]"),
    };
    Response {
        stdout,
        stderr: String::new(),
        exit_code: 0,
    }
}

fn validation_json(
    diagnostics: &[QueryDiagnostic],
    files: usize,
    links: usize,
    complete: bool,
) -> String {
    serialize(
        &json!({"diagnostics":diagnostics,"summary":{"files":files,"links":links,"errors":diagnostics.len(),"complete":complete}}),
    )
}

fn serialize(value: &impl serde::Serialize) -> String {
    format!(
        "{}\n",
        serde_json::to_string_pretty(value).expect("serializable output")
    )
}

fn diagnostic_text(diagnostics: &[QueryDiagnostic]) -> String {
    use std::fmt::Write;
    let mut out = String::new();
    for d in diagnostics {
        writeln!(
            out,
            "{}{}: {}: {}",
            d.path,
            d.line.map_or(String::new(), |l| format!(":{l}")),
            d.code,
            d.message
        )
        .expect("write to String");
    }
    out
}

fn failure(exit_code: i32, message: impl Into<String>) -> Response {
    Response {
        stdout: String::new(),
        stderr: format!("{}\n", message.into()),
        exit_code,
    }
}
