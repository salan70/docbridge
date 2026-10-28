use std::io::IsTerminal;

use docbridge_update::{Options, Outcome};

use crate::cli::{Invocation, Response};

const UPGRADE_USAGE: &str = "Usage: docbridge upgrade [--check] [--dry-run] [--yes]\n";

pub(crate) fn dispatch(invocation: Invocation, confirm: &mut dyn FnMut(&str) -> bool) -> Response {
    let executable = match std::env::current_exe() {
        Ok(path) => path,
        Err(e) => return failure(1, format!("upgrade: current executable: {e}\n")),
    };
    let mut options = Options::new(executable, env!("CARGO_PKG_VERSION"));
    for arg in &invocation.extra_args {
        match arg.as_str() {
            "--check" => options.check = true,
            "--dry-run" => options.dry_run = true,
            "--yes" => options.yes = true,
            "--help" | "-h" => {
                return Response {
                    stdout: UPGRADE_USAGE.into(),
                    stderr: String::new(),
                    exit_code: 0,
                }
            }
            other => return failure(3, format!("unknown argument: {other}\n{UPGRADE_USAGE}")),
        }
    }
    // Without a terminal the library reports ConfirmationRequired (exit 1) and writes nothing.
    let interactive = std::io::stdin().is_terminal() && std::io::stderr().is_terminal();
    if options.check || options.dry_run || options.yes || !interactive {
        return response(docbridge_update::run(&options));
    }
    // Bind the confirmation to the verified plan so apply installs exactly these bytes.
    let plan = match docbridge_update::plan(&options) {
        Ok(plan) => plan,
        Err(outcome) => return response(outcome),
    };
    let prompt = format!(
        "Upgrade {} from {} to {} ({}, sha256 {})",
        plan.executable().display(),
        plan.current_version(),
        plan.version(),
        plan.target(),
        plan.sha256()
    );
    if confirm(&prompt) {
        options.confirmed = true;
        response(docbridge_update::apply(plan, &options))
    } else {
        response(docbridge_update::decline(&plan))
    }
}

fn response(outcome: Outcome) -> Response {
    Response {
        stdout: outcome.stdout,
        stderr: outcome.stderr,
        exit_code: outcome.code,
    }
}

fn failure(exit_code: i32, stderr: String) -> Response {
    Response {
        stdout: String::new(),
        stderr,
        exit_code,
    }
}
