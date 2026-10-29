use crate::{
    cli::{Command, Invocation, Response},
    lifecycle::{self, InitOptions, Outcome},
};

const INIT_USAGE: &str =
    "Usage: docbridge init [--root <directory>] [--dry-run] [--yes] [--force] [--claude]\n";
const DEINIT_USAGE: &str = "Usage: docbridge deinit [--dry-run]\n";

pub(crate) fn dispatch(invocation: Invocation, confirm: &mut dyn FnMut(&str) -> bool) -> Response {
    if invocation.command == Command::Init {
        return initialize(invocation, confirm);
    }
    let args: Vec<_> = invocation.extra_args.iter().map(String::as_str).collect();
    let dry_run = match args.as_slice() {
        [] => false,
        ["--dry-run"] => true,
        ["--help" | "-h"] => return success(DEINIT_USAGE.into()),
        _ => return failure(DEINIT_USAGE),
    };
    let plan = match lifecycle::plan_deinit(&invocation.root) {
        Ok(plan) => plan,
        Err(error) => return result_error(error),
    };
    let rendered = plan.to_string();
    if dry_run {
        return success(rendered);
    }
    if !confirm(&rendered) {
        return Response {
            stdout: rendered,
            stderr: "Interactive confirmation is required; no changes made.\n".into(),
            exit_code: 1,
        };
    }
    response(lifecycle::apply_deinit(&plan))
}

fn initialize(mut invocation: Invocation, confirm: &mut dyn FnMut(&str) -> bool) -> Response {
    let mut options = InitOptions::default();
    let mut args = invocation.extra_args.iter();
    while let Some(arg) = args.next() {
        match arg.as_str() {
            "--dry-run" => options.dry_run = true,
            "--yes" => options.yes = true,
            "--force" => options.force = true,
            "--claude" => options.claude = true,
            "--help" | "-h" => return success(INIT_USAGE.into()),
            "--root" => {
                let Some(root) = args.next().filter(|root| !root.starts_with('-')) else {
                    return failure(INIT_USAGE);
                };
                invocation.root = invocation.root.join(root);
            }
            _ => return failure(INIT_USAGE),
        }
    }
    let inspected = lifecycle::init(&invocation.root, &options);
    if inspected.code != 0 || options.dry_run || options.yes || !confirm(&inspected.stdout) {
        return response(inspected);
    }
    options.yes = true;
    response(lifecycle::init(&invocation.root, &options))
}

fn response(outcome: Outcome) -> Response {
    Response {
        stdout: outcome.stdout,
        stderr: outcome.stderr,
        exit_code: outcome.code,
    }
}

fn success(stdout: String) -> Response {
    Response {
        stdout,
        stderr: String::new(),
        exit_code: 0,
    }
}

fn failure(usage: &str) -> Response {
    Response {
        stdout: String::new(),
        stderr: usage.into(),
        exit_code: 3,
    }
}

fn result_error(error: String) -> Response {
    Response {
        stdout: String::new(),
        stderr: format!("{error}\n"),
        exit_code: 1,
    }
}
