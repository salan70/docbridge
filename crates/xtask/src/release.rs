use crate::{read, Runner};
use std::{fs, io::Write, path::Path};
// `X.Y.Z` with decimal parts and no leading zeros, as Release vNext accepts.
fn valid_version(v: &str) -> bool {
    let parts = v.split('.').collect::<Vec<_>>();
    parts.len() == 3
        && parts.iter().all(|p| {
            !p.is_empty()
                && p.bytes().all(|b| b.is_ascii_digit())
                && (p.len() == 1 || !p.starts_with('0'))
        })
}
// Valid versions have no leading zeros, so a longer part is the larger number.
fn version_key(v: &str) -> Vec<(usize, &str)> {
    v.split('.').map(|p| (p.len(), p)).collect()
}
// The recipe passes `date -u +%F`, so this checks the shape, not the calendar.
fn valid_date(date: &str) -> bool {
    let b = date.as_bytes();
    let number = |i: usize| u32::from(b[i] - b'0') * 10 + u32::from(b[i + 1] - b'0');
    b.len() == 10
        && b.iter().enumerate().all(|(i, c)| {
            if i == 4 || i == 7 {
                *c == b'-'
            } else {
                c.is_ascii_digit()
            }
        })
        && (1..=12).contains(&number(5))
        && (1..=31).contains(&number(8))
}
fn reference(line: &str) -> bool {
    line.strip_prefix('[')
        .and_then(|s| s.split_once("]:"))
        .is_some_and(|(label, rest)| {
            !label.is_empty() && !label.contains(']') && rest.starts_with([' ', '\t'])
        })
}
fn atomic_write(path: &Path, text: &str) -> Result<(), String> {
    let mut temp = tempfile::NamedTempFile::new_in(path.parent().unwrap())
        .map_err(|e| format!("{}: {e}", path.display()))?;
    let permissions = fs::metadata(path)
        .map_err(|e| format!("{}: {e}", path.display()))?
        .permissions();
    temp.write_all(text.as_bytes())
        .and_then(|_| temp.as_file().set_permissions(permissions))
        .map_err(|e| format!("{}: {e}", path.display()))?;
    temp.persist(path)
        .map_err(|e| format!("{}: {}", path.display(), e.error))?;
    Ok(())
}
fn section(text: &str, heading: &str) -> Option<String> {
    let mut lines = text.lines().skip_while(|s| !s.starts_with(heading));
    lines.next()?;
    let body = lines
        .take_while(|s| !s.starts_with("## [") && !reference(s))
        .collect::<Vec<_>>();
    let first = body
        .iter()
        .position(|s| !s.trim_matches([' ', '\t']).is_empty())
        .unwrap_or(body.len());
    let last = body
        .iter()
        .rposition(|s| !s.trim_matches([' ', '\t']).is_empty())
        .map_or(first, |i| i + 1);
    Some(body[first..last].join("\n"))
}
// Sets `version` in the root `[workspace.package]` table, which every crate inherits.
fn set_workspace_version(text: &str, new: &str) -> Result<String, String> {
    let mut table = false;
    let mut done = false;
    let mut out = String::new();
    for line in text.lines() {
        if line.starts_with('[') {
            table = line == "[workspace.package]";
        }
        if table && !done && line.starts_with("version = \"") {
            let old = line
                .strip_prefix("version = \"")
                .and_then(|s| s.strip_suffix('"'))
                .filter(|s| valid_version(s))
                .ok_or(format!(
                    "Cargo.toml has an unreadable workspace version: {line}"
                ))?;
            if version_key(new) <= version_key(old) {
                return Err(format!(
                    "{new} is not greater than the workspace version {old}"
                ));
            }
            out.push_str(&format!("version = \"{new}\"\n"));
            done = true;
        } else {
            out.push_str(line);
            out.push('\n');
        }
    }
    if done {
        Ok(out)
    } else {
        Err("Cargo.toml has no [workspace.package] version".into())
    }
}
fn roll_changelog(changelog: &str, new: &str, date: &str) -> Result<String, String> {
    let (heading, link) = (format!("## [{new}]"), format!("[{new}]:"));
    if changelog
        .lines()
        .any(|s| s.starts_with(&heading) || s.starts_with(&link))
    {
        return Err(format!("CHANGELOG.md already has a {new} release."));
    }
    let body = section(changelog, "## [Unreleased]")
        .ok_or("CHANGELOG.md has no '## [Unreleased]' section. Add one with entries before running `just release`.")?;
    if body.is_empty() {
        return Err("'## [Unreleased]' has no entries. Document user-facing changes before running `just release`.".into());
    }
    let refs=format!("[Unreleased]: https://github.com/salan70/docbridge/compare/v{new}...HEAD\n[{new}]: https://github.com/salan70/docbridge/releases/tag/v{new}\n");
    let mut out = String::new();
    let mut state = 0;
    let mut inserted = false;
    for line in changelog.lines() {
        if state == 0 && line.starts_with("## [Unreleased]") {
            out.push_str(&format!(
                "## [Unreleased]\n\n## [{new}] - {date}\n\n{body}\n\n"
            ));
            state = 1;
            continue;
        }
        if state == 1 {
            if line.starts_with("## [") || reference(line) {
                state = 2;
            } else {
                continue;
            }
        }
        if line.starts_with("[Unreleased]:") && reference(line) {
            continue;
        }
        if !inserted && reference(line) {
            out.push_str(&refs);
            inserted = true;
        }
        out.push_str(line);
        out.push('\n');
    }
    if !inserted {
        if !out.ends_with("\n\n") {
            out.push('\n');
        }
        out.push_str(&refs);
    }
    Ok(out)
}
pub fn prepare(
    root: &Path,
    new: &str,
    date: &str,
    runner: &mut impl Runner,
) -> Result<String, String> {
    if !valid_version(new) {
        return Err(format!("{new} is not a X.Y.Z version"));
    }
    if !valid_date(date) {
        return Err(format!("{date} is not a YYYY-MM-DD date"));
    }
    let manifest = set_workspace_version(&read(&root.join("Cargo.toml"))?, new)?;
    let changelog = roll_changelog(&read(&root.join("CHANGELOG.md"))?, new, date)?;
    atomic_write(&root.join("CHANGELOG.md"), &changelog)?;
    atomic_write(&root.join("Cargo.toml"), &manifest)?;
    let reply = runner.run(
        Path::new("cargo"),
        &["update".into(), "--workspace".into(), "--offline".into()],
        root,
    )?;
    if reply.code != 0 {
        return Err(format!(
            "cargo update --workspace --offline failed: {}{}",
            reply.out, reply.err
        ));
    }
    Ok(format!("Prepared release {new}"))
}
#[cfg(test)]
mod tests;
