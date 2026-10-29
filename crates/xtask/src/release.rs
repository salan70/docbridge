use crate::{read, Runner};
use std::{
    fs,
    io::Write,
    path::Path,
    time::{SystemTime, UNIX_EPOCH},
};
const MANIFESTS: [&str; 2] = ["crates/docbridge/Cargo.toml", "crates/xtask/Cargo.toml"];
fn version(text: &str) -> Result<String, String> {
    let mut package = false;
    for line in text.lines() {
        if line.starts_with('[') {
            package = line == "[package]";
        }
        if package {
            if let Some(rest) = line.strip_prefix("version = \"") {
                if let Some((v, _)) = rest.split_once('"') {
                    return Ok(v.into());
                }
            }
        }
    }
    Err("Cannot read [package] version".into())
}
fn next(current: &str, kind: &str) -> Result<String, String> {
    let mut v = semver::Version::parse(current)
        .map_err(|_| format!("{current} is not a X.Y.Z semantic version"))?;
    if !v.pre.is_empty() || !v.build.is_empty() {
        return Err(format!("{current} is not a X.Y.Z semantic version"));
    }
    match kind {
        "patch" => v.patch = v.patch.checked_add(1).ok_or("version overflow")?,
        "minor" => {
            v.minor = v.minor.checked_add(1).ok_or("version overflow")?;
            v.patch = 0;
        }
        "major" => {
            v.major = v.major.checked_add(1).ok_or("version overflow")?;
            v.minor = 0;
            v.patch = 0;
        }
        _ => return Err(format!("unknown release kind '{kind}'")),
    }
    Ok(v.to_string())
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
fn git(root: &Path, base: &str, path: &str, runner: &mut impl Runner) -> Result<String, String> {
    let reply = runner.run(
        Path::new("git"),
        &["show".into(), format!("{base}:{path}")],
        root,
    )?;
    if reply.code == 0 {
        Ok(reply.out)
    } else {
        Err(format!("git show {base}:{path}: {}", reply.err))
    }
}
pub fn label(
    root: &Path,
    base: &str,
    labels: &[String],
    runner: &mut impl Runner,
) -> Result<String, String> {
    let labels = labels
        .iter()
        .filter(|s| s.starts_with("release: "))
        .collect::<Vec<_>>();
    let chosen=match labels.len() { 0=>return Err("Add exactly one release label: release: none, release: patch, release: minor, or release: major.".into()),1=>labels[0],n=>return Err(format!("Found {n} release labels ({}); keep exactly one.",labels.iter().map(|s|s.as_str()).collect::<Vec<_>>().join(", "))) };
    let kind = chosen.strip_prefix("release: ").unwrap();
    if !["none", "patch", "minor", "major"].contains(&kind) {
        return Err(format!("Unknown release label '{chosen}'."));
    }
    let base_version = match git(root, base, "package.json", runner) {
        Ok(s) => serde_json::from_str::<serde_json::Value>(&s)
            .map_err(|e| e.to_string())?
            .get("version")
            .and_then(|v| v.as_str())
            .ok_or("Cannot read the legacy release version")?
            .to_string(),
        Err(_) => version(&git(root, base, MANIFESTS[0], runner)?)?,
    };
    let base_unreleased = git(root, base, "CHANGELOG.md", runner)
        .ok()
        .and_then(|s| section(&s, "## [Unreleased]"))
        .unwrap_or_default();
    let changelog = read(&root.join("CHANGELOG.md"))?;
    let head_unreleased = section(&changelog, "## [Unreleased]").unwrap_or_default();
    let expected = if kind == "none" {
        base_version.clone()
    } else {
        next(&base_version, kind)?
    };
    let mut problems = Vec::new();
    for path in MANIFESTS {
        let found = version(&read(&root.join(path))?)?;
        if found != expected {
            problems.push(if kind=="none" {format!("{path} version must stay {expected} for release: none (found {found}).")} else {format!("{path} version must be {expected} for release: {kind} (found {found}). Run `just release-bump {kind}`.")});
        }
    }
    if kind == "none" {
        if head_unreleased != base_unreleased {
            problems.push("CHANGELOG.md [Unreleased] must stay unchanged for release: none. Use a releasing label for user-facing changes.".into());
        }
    } else {
        if section(&changelog, &format!("## [{expected}]"))
            .unwrap_or_default()
            .is_empty()
        {
            problems.push(format!("CHANGELOG.md needs a non-empty '## [{expected}]' section. Run `just release-bump {kind}`."));
        }
        if !head_unreleased.is_empty() {
            problems.push(format!("CHANGELOG.md [Unreleased] must be empty after the roll. Run `just release-bump {kind}`."));
        }
    }
    if problems.is_empty() {
        Ok(format!(
            "release: {kind} matches the change ({base_version} -> {expected})."
        ))
    } else {
        Err(problems.join("\n"))
    }
}
// Gregorian civil date from days since Unix epoch, independent of local timezone.
fn utc_date() -> Result<String, String> {
    let days = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_err(|e| e.to_string())?
        .as_secs()
        / 86400;
    Ok(date_from_days(days as i64))
}
fn date_from_days(days: i64) -> String {
    let z = days + 719468;
    let era = z.div_euclid(146097);
    let doe = z - era * 146097;
    let yoe = (doe - doe / 1460 + doe / 36524 - doe / 146096) / 365;
    let mut y = yoe + era * 400;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = doy - (153 * mp + 2) / 5 + 1;
    let m = mp + if mp < 10 { 3 } else { -9 };
    y += i64::from(m <= 2);
    format!("{y:04}-{m:02}-{d:02}")
}
pub fn bump(root: &Path, kind: &str, runner: &mut impl Runner) -> Result<String, String> {
    let mut manifests = Vec::new();
    for path in MANIFESTS {
        let text = read(&root.join(path))?;
        let v = version(&text)?;
        manifests.push((path, text, v));
    }
    let current = &manifests[0].2;
    let new = next(current, kind)?;
    for (path, _, v) in &manifests {
        if v != current {
            return Err(format!(
                "{path} version must match {current} before a bump (found {v})"
            ));
        }
    }
    let changelog = read(&root.join("CHANGELOG.md"))?;
    let body=section(&changelog,"## [Unreleased]").ok_or("CHANGELOG.md has no '## [Unreleased]' section. Add one with entries before running `just release-bump`.")?;
    if body.is_empty() {
        return Err("'## [Unreleased]' has no entries. Document user-facing changes before running `just release-bump`.".into());
    }
    let today = utc_date()?;
    let refs=format!("[Unreleased]: https://github.com/salan70/docbridge/compare/v{new}...HEAD\n[{new}]: https://github.com/salan70/docbridge/releases/tag/v{new}\n");
    let mut out = String::new();
    let mut state = 0;
    let mut inserted = false;
    for line in changelog.lines() {
        if state == 0 && line.starts_with("## [Unreleased]") {
            out.push_str(&format!(
                "## [Unreleased]\n\n## [{new}] - {today}\n\n{body}\n\n"
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
    let mut writes = vec![(root.join("CHANGELOG.md"), out)];
    for (path, text, _) in manifests {
        let mut package = false;
        let mut done = false;
        let mut out = String::new();
        for line in text.lines() {
            if line.starts_with('[') {
                package = line == "[package]";
            }
            if package && !done && line.starts_with("version = \"") {
                out.push_str(&format!("version = \"{new}\"\n"));
                done = true;
            } else {
                out.push_str(line);
                out.push('\n');
            }
        }
        writes.push((root.join(path), out));
    }
    for (path, text) in writes {
        atomic_write(&path, &text)?;
    }
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
    Ok(format!("Bumped to {new}"))
}
#[cfg(test)]
mod tests;
