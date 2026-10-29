use std::{path::Path, process::Command};
mod gates;
mod release;
mod smoke;

struct Reply {
    code: i32,
    out: String,
    err: String,
}
trait Runner {
    fn run(&mut self, program: &Path, args: &[String], cwd: &Path) -> Result<Reply, String>;
}
struct System;
impl Runner for System {
    fn run(&mut self, program: &Path, args: &[String], cwd: &Path) -> Result<Reply, String> {
        let o = Command::new(program)
            .args(args)
            .current_dir(cwd)
            .output()
            .map_err(|e| format!("{}: {e}", program.display()))?;
        Ok(Reply {
            code: o.status.code().unwrap_or(-1),
            out: String::from_utf8_lossy(&o.stdout).into(),
            err: String::from_utf8_lossy(&o.stderr).into(),
        })
    }
}
fn execute(
    args: &[String],
    root: &Path,
    runner: &mut impl Runner,
) -> Result<String, (i32, String)> {
    let usage = || {
        (2, "usage: xtask agent-gate [ROOT] | publisher-gate DIR | smoke PATH | release-label BASE_REF LABEL... | release-bump <patch|minor|major>".into())
    };
    let result = match args.first().map(String::as_str) {
        Some("agent-gate") if args.len() <= 2 => gates::agent(
            &args
                .get(1)
                .map(|s| root.join(s))
                .unwrap_or_else(|| root.into()),
        ),
        Some("publisher-gate") if args.len() == 2 => gates::publisher(&root.join(&args[1])),
        Some("smoke") if args.len() == 2 => smoke::check(&root.join(&args[1]), runner),
        Some("release-label") if args.len() >= 2 => {
            release::label(root, &args[1], &args[2..], runner)
        }
        Some("release-bump")
            if args.len() == 2 && ["patch", "minor", "major"].contains(&args[1].as_str()) =>
        {
            release::bump(root, &args[1], runner)
        }
        _ => return Err(usage()),
    };
    result.map_err(|e| (1, e))
}
fn main() {
    let args = std::env::args().skip(1).collect::<Vec<_>>();
    let result = std::env::current_dir()
        .map_err(|e| (1, e.to_string()))
        .and_then(|root| execute(&args, &root, &mut System));
    match result {
        Ok(s) => println!("{s}"),
        Err((code, message)) => {
            eprintln!("{message}");
            std::process::exit(code);
        }
    }
}
fn read(path: &Path) -> Result<String, String> {
    std::fs::read_to_string(path).map_err(|e| format!("{}: {e}", path.display()))
}

#[cfg(all(test, unix))]
mod tests {
    use super::*;
    #[test]
    fn signaled_child_is_not_an_expected_exit_one() {
        let reply = System
            .run(
                Path::new("/bin/sh"),
                &["-c".into(), "kill -TERM $$".into()],
                Path::new("/"),
            )
            .unwrap();
        assert_eq!(reply.code, -1);
    }
}
