use crate::read;
use std::{fs, path::Path};

fn physical_dir(path: &Path) -> bool {
    fs::symlink_metadata(path).is_ok_and(|m| m.is_dir() && !m.file_type().is_symlink())
}
fn nonempty(path: &Path) -> bool {
    fs::metadata(path).is_ok_and(|m| m.is_file() && m.len() > 0)
}
fn exact_alias(path: &Path) -> bool {
    #[cfg(windows)]
    {
        let s = path.as_os_str().to_string_lossy();
        let parts: Vec<_> = s.split(['/', '\\']).collect();
        parts == ["..", ".agents", "skills"]
    }
    #[cfg(not(windows))]
    {
        path.as_os_str() == std::ffi::OsStr::new("../.agents/skills")
    }
}
pub fn agent(root: &Path) -> Result<String, String> {
    let skills = root.join(".agents/skills");
    let mut errors = Vec::new();
    if !physical_dir(&skills) {
        errors.push(".agents/skills must be a physical canonical directory.".into());
    }
    for name in ["docbridge", "git-workflow"] {
        if !physical_dir(&skills.join(name)) || !nonempty(&skills.join(name).join("SKILL.md")) {
            errors.push(format!(
                ".agents/skills/{name} must be a canonical directory containing SKILL.md."
            ));
        }
    }
    if let Ok(entries) = fs::read_dir(&skills) {
        for entry in entries {
            let entry = entry.map_err(|e| e.to_string())?;
            if !["docbridge", "git-workflow"]
                .iter()
                .any(|n| entry.file_name() == *n)
            {
                errors.push(format!(
                    "Unexpected canonical skill: {}",
                    entry.file_name().to_string_lossy()
                ));
            }
        }
    }
    if !nonempty(&skills.join("docbridge/.docbridge-owned.json")) {
        errors.push("The managed DocBridge skill requires its ownership metadata.".into());
    }
    if fs::read_link(root.join(".claude/skills"))
        .ok()
        .as_deref()
        .is_none_or(|p| !exact_alias(p))
    {
        errors.push(".claude/skills must be the exact symlink ../.agents/skills (enable Git symlink checkout; do not copy).".into());
    }
    if fs::symlink_metadata(root.join("CLAUDE.md")).is_ok() {
        errors.push("CLAUDE.md must be removed; AGENTS.md owns shared agent rules.".into());
    }
    let agents = read(&root.join("AGENTS.md"))?;
    let workflow = read(&skills.join("git-workflow/SKILL.md"))?;
    for anchor in ["verification", "git-and-pull-requests", "documentation"] {
        if !agents.contains(&format!("docs/contributing/README.md#{anchor}")) {
            errors.push(format!(
                "AGENTS.md must reference docs/contributing/README.md#{anchor}."
            ));
        }
    }
    if !nonempty(&root.join("docs/contributing/README.md")) {
        errors.push(
            "docs/contributing/README.md must provide the canonical contributor workflow.".into(),
        );
    }
    if !workflow.contains("docs/contributing/README.md#") {
        errors.push("git-workflow must reference the canonical contributor workflow.".into());
    }
    for text in [&agents, &workflow] {
        if [
            "concise-writing",
            "grill-me",
            "pr-review",
            "review-response",
        ]
        .iter()
        .any(|s| text.contains(s))
            || [
                "commits",
                "pull-requests",
                "testing",
                "writing",
                "documentation",
                "self-audit",
            ]
            .iter()
            .any(|s| text.contains(&format!("docs/contributing/{s}.md")))
        {
            errors.push("Agent rules reference retired contributor assets.".into());
        }
    }
    if errors.is_empty() {
        Ok("Canonical agent assets are consistent.".into())
    } else {
        Err(errors.join("\n"))
    }
}
fn publishes(s: &str) -> bool {
    fn after_space(s: &str) -> Option<&str> {
        if !s.starts_with(|c: char| c.is_ascii_whitespace()) {
            return None;
        }
        Some(s.trim_start_matches(|c: char| c.is_ascii_whitespace()))
    }
    s.lines().any(|s| {
        s.match_indices("npm")
            .any(|(i, _)| after_space(&s[i + 3..]).is_some_and(|r| r.starts_with("publish")))
            || s.match_indices("gh").any(|(i, _)| {
                after_space(&s[i + 2..])
                    .and_then(|r| r.strip_prefix("release"))
                    .and_then(after_space)
                    .is_some_and(|r| {
                        ["create", "upload", "edit"]
                            .iter()
                            .any(|p| r.starts_with(p))
                    })
            })
            || s.contains("action-gh-release")
            || s.match_indices("/releases").any(|(i, _)| {
                s[i + 9..].chars().next().map_or(true, |c| {
                    !(c == '/' || c.is_ascii_lowercase() || c == '_' || c == '-')
                })
            })
    })
}
pub fn publisher(dir: &Path) -> Result<String, String> {
    if !dir.is_dir() {
        return Err(format!("::error::{} is not a directory", dir.display()));
    }
    let mut blocked = Vec::new();
    for entry in fs::read_dir(dir).map_err(|e| e.to_string())? {
        let path = entry.map_err(|e| e.to_string())?.path();
        if path.file_name().is_some_and(|n| n == "release-vnext.yml")
            || !path.extension().is_some_and(|e| e == "yml" || e == "yaml")
        {
            continue;
        }
        if publishes(&read(&path)?) {
            blocked.push(format!("::error::{} still publishes releases or packages; retire it before a vNext release (see docs/contributing/releasing.md#cutover-order)",path.file_name().unwrap().to_string_lossy()));
        }
    }
    blocked.sort();
    if blocked.is_empty() {
        Ok("No other workflow publishes releases or packages.".into())
    } else {
        Err(blocked.join("\n"))
    }
}
#[cfg(test)]
mod tests;
