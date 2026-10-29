use crate::{read, Runner};
use std::{
    fs,
    path::{Path, PathBuf},
    time::{SystemTime, UNIX_EPOCH},
};

struct Scratch(PathBuf);
fn executable(path: &Path) -> bool {
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        fs::metadata(path).is_ok_and(|m| m.is_file() && m.permissions().mode() & 0o111 != 0)
    }
    #[cfg(windows)]
    {
        path.is_file()
    }
}
impl Drop for Scratch {
    fn drop(&mut self) {
        let _ = fs::remove_dir_all(&self.0);
    }
}
pub fn check(bin: &Path, runner: &mut impl Runner) -> Result<String, String> {
    let mut exe = bin.as_os_str().to_os_string();
    exe.push(".exe");
    let exe = PathBuf::from(exe);
    let bin = if !executable(bin) && executable(&exe) {
        exe
    } else {
        bin.into()
    };
    let scratch = (0..100)
        .find_map(|n| {
            let p = std::env::temp_dir().join(format!(
                "docbridge-smoke-{}-{}-{n}",
                std::process::id(),
                SystemTime::now()
                    .duration_since(UNIX_EPOCH)
                    .unwrap_or_default()
                    .as_nanos()
            ));
            fs::create_dir(&p).ok().map(|_| Scratch(p))
        })
        .ok_or("Cannot create smoke temporary directory")?;
    let project = scratch.0.join("project");
    fs::create_dir_all(project.join("src")).map_err(|e| e.to_string())?;
    fs::create_dir_all(project.join("docs")).map_err(|e| e.to_string())?;
    for (p,s) in [("docbridge.config.json",r#"{"include":{"code":{"paths":["src"],"extensions":[".rs"]},"docs":["docs"]}}"#),("src/main.rs","fn main() {}\n"),("src/extra.rs","pub fn unused() {}\n"),("docs/design.md","# Design\n\n<!-- @code src/main.rs -->\n## Entry point\n\nThe program starts here.\n\n## Notes\n\nNot linked yet.\n")] { fs::write(project.join(p),s).map_err(|e| e.to_string())?; }
    let root = project.to_string_lossy().into_owned();
    let mut run = |args: &[&str], code| {
        let args = args.iter().map(|s| s.to_string()).collect::<Vec<_>>();
        let reply = runner.run(&bin, &args, &scratch.0)?;
        if reply.code != code {
            Err(format!(
                "expected exit {code}, got {}: {args:?}\n{}{}",
                reply.code, reply.out, reply.err
            ))
        } else {
            Ok(reply)
        }
    };
    run(&["--help"], 0)?;
    if !run(&["docs", "list"], 0)?.out.contains("getting-started") {
        return Err("docs list omitted getting-started".into());
    }
    run(&["docs", "show", "no-such-guide"], 3)?;
    run(&["validate", "--root", &root], 0)?;
    let reply = run(&["links", "--root", &root, "--json"], 0)?;
    let value: serde_json::Value = serde_json::from_str(&reply.out).map_err(|e| e.to_string())?;
    if value.get("edges").is_none() {
        return Err("links JSON omitted edges".into());
    }
    if !run(
        &[
            "links",
            "--root",
            &root,
            "--include-content",
            "docs/design.md",
        ],
        0,
    )?
    .out
    .contains("The program starts here.")
    {
        return Err("links omitted content".into());
    }
    if !run(&["unlinked", "--root", &root], 0)?
        .out
        .contains("src/extra.rs")
    {
        return Err("unlinked omitted src/extra.rs".into());
    }
    let doc = project.join("docs/design.md");
    fs::write(
        &doc,
        format!("{}<!-- @code src/missing.rs -->\n## Broken\n", read(&doc)?),
    )
    .map_err(|e| e.to_string())?;
    run(&["validate", "--root", &root], 1)?;
    let reply = run(&["upgrade", "--check"], 1)?;
    if !reply.err.contains("install provenance") && !reply.err.contains("managed installation") {
        return Err("upgrade omitted installation refusal".into());
    }
    Ok(format!("vNext smoke checks passed: {}", bin.display()))
}
#[cfg(test)]
mod tests;
