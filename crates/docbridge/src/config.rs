use serde::Deserialize;
use std::{fs, path::Path};

#[derive(Debug, Clone, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Config {
    pub include: Include,
    #[serde(default)]
    pub exclude: Exclude,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Include {
    pub code: Code,
    pub docs: Vec<String>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Code {
    pub paths: Vec<String>,
    pub extensions: Vec<String>,
}

#[derive(Debug, Clone, Default, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Exclude {
    #[serde(default)]
    pub code: Vec<String>,
}

impl Config {
    pub fn load(root: &Path) -> Result<Self, String> {
        let path = root.join("docbridge.config.json");
        let metadata =
            fs::symlink_metadata(&path).map_err(|e| format!("{}: {e}", path.display()))?;
        if crate::project::is_symlink(&metadata) || !metadata.is_file() {
            return Err("configuration must be a regular file, not a symlink".into());
        }
        let text = fs::read_to_string(&path).map_err(|e| format!("{}: {e}", path.display()))?;
        let config: Self =
            serde_json::from_str(&text).map_err(|e| format!("invalid configuration: {e}"))?;
        for path in config
            .include
            .code
            .paths
            .iter()
            .chain(&config.include.docs)
            .chain(&config.exclude.code)
        {
            validate_path(path, true)?;
        }
        for ext in &config.include.code.extensions {
            if !ext.starts_with('.')
                || ext.len() < 2
                || ext
                    .chars()
                    .any(|c| matches!(c, '/' | '\\' | '*' | '?' | '[' | ']' | '#' | '\0' | ':'))
            {
                return Err(format!("invalid extension: {ext}"));
            }
        }
        Ok(config)
    }
}

/// Discovery accepts directory roots and the deliberately small `*` / `**` grammar.
pub fn validate_path(path: &str, discovery: bool) -> Result<(), String> {
    let invalid = || Err(format!("invalid managed path: {path:?}"));
    if path.is_empty()
        || path.starts_with('/')
        || path
            .chars()
            .any(|c| matches!(c, '\\' | '#' | '\0' | '\n' | '\r'))
        || (cfg!(windows) && path.contains(':'))
        || has_drive_prefix(path)
    {
        return invalid();
    }
    if discovery && path == "." {
        return Ok(());
    }
    for segment in path.split('/') {
        if segment.is_empty() || segment == "." || segment == ".." || segment == ".git" {
            return invalid();
        }
        if !discovery && segment.contains('*') {
            return invalid();
        }
        if discovery
            && (segment.contains(['?', '[', ']', '{', '}'])
                || (segment.contains("**") && segment != "**"))
        {
            return invalid();
        }
    }
    Ok(())
}

/// Windows drive prefixes (`C:/x`, `C:foo`) are rejected on every platform.
fn has_drive_prefix(path: &str) -> bool {
    let b = path.as_bytes();
    b.len() >= 2 && b[0].is_ascii_alphabetic() && b[1] == b':'
}

pub fn glob_matches(pattern: &str, path: &str) -> bool {
    fn segment(pattern: &str, value: &str) -> bool {
        let p = pattern.as_bytes();
        let v = value.as_bytes();
        let (mut i, mut j, mut star, mut retry) = (0, 0, None, 0);
        while j < v.len() {
            if i < p.len() && p[i] != b'*' && p[i] == v[j] {
                i += 1;
                j += 1;
            } else if i < p.len() && p[i] == b'*' {
                star = Some(i);
                i += 1;
                retry = j;
            } else if let Some(s) = star {
                retry += 1;
                j = retry;
                i = s + 1;
            } else {
                return false;
            }
        }
        while i < p.len() && p[i] == b'*' {
            i += 1;
        }
        i == p.len()
    }
    let patterns: Vec<_> = pattern.split('/').collect();
    let parts: Vec<_> = path.split('/').collect();
    // Dynamic programming avoids exponential backtracking on recursive globs.
    let mut matched = vec![vec![false; parts.len() + 1]; patterns.len() + 1];
    matched[0][0] = true;
    for i in 0..patterns.len() {
        for j in 0..=parts.len() {
            if patterns[i] == "**" {
                matched[i + 1][j] = matched[i][j] || (j > 0 && matched[i + 1][j - 1]);
            } else if j > 0 {
                matched[i + 1][j] = matched[i][j - 1] && segment(patterns[i], parts[j - 1]);
            }
        }
    }
    matched[patterns.len()][parts.len()]
}

pub(crate) fn in_scope(pattern: &str, path: &str) -> bool {
    pattern == "."
        || glob_matches(pattern, path)
        || path
            .match_indices('/')
            .any(|(i, _)| glob_matches(pattern, &path[..i]))
}

pub(crate) fn may_contain(pattern: &str, directory: &str) -> bool {
    if in_scope(pattern, directory) {
        return true;
    }
    pattern
        .match_indices('/')
        .any(|(end, _)| glob_matches(&pattern[..end], directory))
}
