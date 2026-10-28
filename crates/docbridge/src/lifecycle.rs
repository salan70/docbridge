use sha2::{Digest, Sha256};
use std::{
    collections::{BTreeMap, BTreeSet},
    fmt,
    fs::{self, OpenOptions},
    io::Write,
    path::{Path, PathBuf},
    sync::atomic::{AtomicU64, Ordering},
};
const CONFIG: &str = "docbridge.config.json";
const RECORD: &str = ".docbridge-owned.json";
const SKILL_DIRS: [&str; 2] = [".agents/skills/docbridge", ".claude/skills/docbridge"];
const SKILL: &str = "---\nname: docbridge\ndescription: Maintain explicit documentation-to-code links.\n---\n\nUse `docbridge docs` and `docbridge docs list` for authoritative guidance.\nUse `docbridge validate`, `docbridge links`, and `docbridge unlinked` to inspect explicit links.\nRead the relevant documentation and code before editing. Validation checks structural links; assess semantic consistency yourself.\n";
#[derive(Default)]
pub struct InitOptions {
    pub dry_run: bool,
    pub yes: bool,
    pub force: bool,
    pub claude: bool,
}
pub struct Outcome {
    pub stdout: String,
    pub stderr: String,
    pub code: i32,
}
pub type InitResult = Outcome;
fn outcome(result: Result<String, String>) -> Outcome {
    match result {
        Ok(stdout) => Outcome {
            stdout,
            stderr: String::new(),
            code: 0,
        },
        Err(stderr) => Outcome {
            stdout: String::new(),
            stderr,
            code: 1,
        },
    }
}
fn hash(bytes: &[u8]) -> String {
    format!("{:x}", Sha256::digest(bytes))
}
fn relative(path: &str) -> Result<(), String> {
    crate::config::validate_path(path, false)
}
fn unsafe_metadata(meta: &fs::Metadata) -> bool {
    #[cfg(windows)]
    {
        use std::os::windows::fs::MetadataExt;
        if meta.file_attributes() & 0x400 != 0 {
            return true;
        }
    }
    meta.file_type().is_symlink()
}
fn safe(root: &Path, name: &str) -> Result<PathBuf, String> {
    let root_meta = fs::symlink_metadata(root).map_err(|e| e.to_string())?;
    if unsafe_metadata(&root_meta) || !root_meta.is_dir() {
        return Err(format!("unsafe project root: {}", root.display()));
    }
    relative(name)?;
    let mut path = root.to_path_buf();
    for part in name.split('/') {
        // Compare with the actual entry name, even on case-folding file systems.
        if path.is_dir() {
            let exact = fs::read_dir(&path)
                .map_err(|e| e.to_string())?
                .collect::<Result<Vec<_>, _>>()
                .map_err(|e| e.to_string())?
                .iter()
                .any(|entry| entry.file_name() == part);
            if !exact && fs::symlink_metadata(path.join(part)).is_ok() {
                return Err(format!(
                    "path spelling does not match directory entry: {name}"
                ));
            }
        }
        path.push(part);
        match fs::symlink_metadata(&path) {
            Ok(m) if unsafe_metadata(&m) => {
                return Err(format!("unsafe symlink/reparse path: {}", path.display()))
            }
            Ok(_) => (),
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => (),
            Err(e) => return Err(format!("{}: {e}", path.display())),
        }
    }
    Ok(path)
}
fn read(root: &Path, name: &str) -> Result<Vec<u8>, String> {
    let p = safe(root, name)?;
    let m = fs::metadata(&p).map_err(|e| format!("{}: {e}", p.display()))?;
    if !m.is_file() {
        return Err(format!("not a regular file: {}", p.display()));
    }
    fs::read(&p).map_err(|e| format!("{}: {e}", p.display()))
}
/// Whether `path` exists as a real (non-link) directory with no entries.
fn empty_plain_dir(path: &Path) -> Result<bool, String> {
    match fs::symlink_metadata(path) {
        Ok(m) if !unsafe_metadata(&m) && m.is_dir() => Ok(fs::read_dir(path)
            .map_err(|e| format!("{}: {e}", path.display()))?
            .next()
            .is_none()),
        Ok(_) => Ok(false),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(false),
        Err(e) => Err(format!("{}: {e}", path.display())),
    }
}
/// Files found by an exploratory walk, plus entries that were not inspected.
#[derive(Default)]
struct Walk {
    files: Vec<String>,
    /// `(path, reason)` for links, non-UTF-8 names, and unreadable entries.
    skipped: Vec<(String, String)>,
}
/// Explore without following links. Links and unreadable entries are recorded
/// in `skipped`; callers decide whether they matter for a managed path.
fn walk(
    root: &Path,
    directory: &str,
    out: &mut Walk,
    relevant: &dyn Fn(&str) -> bool,
) -> Result<(), String> {
    let path = if directory.is_empty() {
        root.to_path_buf()
    } else {
        let path = root.join(directory);
        match fs::symlink_metadata(&path) {
            Ok(m) if !unsafe_metadata(&m) && m.is_dir() => path,
            _ => {
                out.skipped.push((
                    directory.into(),
                    "changed during discovery; not inspected".into(),
                ));
                return Ok(());
            }
        }
    };
    let entries = fs::read_dir(&path)
        .and_then(|entries| entries.collect::<Result<Vec<_>, _>>())
        .map_err(|e| format!("{}: {e}", path.display()));
    let mut entries = match entries {
        Ok(entries) => entries,
        Err(e) if directory.is_empty() => return Err(e),
        Err(e) => {
            out.skipped
                .push((directory.into(), format!("unreadable: {e}")));
            return Ok(());
        }
    };
    entries.sort_by_key(|e| e.file_name());
    for entry in entries {
        let raw = entry.file_name();
        let name = raw.to_string_lossy();
        if name == ".git" || name.starts_with(".docbridge-recovery-") {
            continue;
        }
        let rel = if directory.is_empty() {
            name.into_owned()
        } else {
            format!("{directory}/{name}")
        };
        if !relevant(&rel) {
            continue;
        }
        if raw.to_str().is_none() {
            out.skipped
                .push((rel, "non-UTF-8 name; not inspected".into()));
            continue;
        }
        match fs::symlink_metadata(entry.path()) {
            Err(e) => out.skipped.push((rel, format!("unreadable: {e}"))),
            Ok(m) if unsafe_metadata(&m) => out
                .skipped
                .push((rel, "symlink/reparse point; not followed".into())),
            Ok(m) if m.is_dir() => walk(root, &rel, out, relevant)?,
            Ok(m) if m.is_file() => out.files.push(rel),
            Ok(_) => (),
        }
    }
    Ok(())
}
fn owned(root: &Path, dir: &str) -> Result<Option<BTreeMap<String, String>>, String> {
    let marker = format!("{dir}/{RECORD}");
    if !safe(root, &marker)?.exists() {
        return Ok(None);
    }
    let record: BTreeMap<String, String> = serde_json::from_slice(&read(root, &marker)?)
        .map_err(|e| format!("invalid ownership record {marker}: {e}"))?;
    if record.is_empty() {
        return Err(format!("empty ownership record: {marker}"));
    }
    for (name, digest) in &record {
        relative(name)?;
        if name == RECORD || digest.len() != 64 || !digest.bytes().all(|b| b.is_ascii_hexdigit()) {
            return Err(format!("invalid ownership entry: {name}"));
        }
        safe(root, &format!("{dir}/{name}"))?;
    }
    Ok(Some(record))
}
pub fn init(root: &Path, options: &InitOptions) -> Outcome {
    outcome((|| {
        let root = fs::canonicalize(root).map_err(|e| e.to_string())?;
        let mut found = Walk::default();
        walk(&root, "", &mut found, &|_| true)?;
        let mut extensions = BTreeSet::new();
        let mut paths = BTreeSet::new();
        let mut docs = Vec::new();
        for file in &found.files {
            if file.starts_with('.') || file == CONFIG {
                continue;
            }
            if file.ends_with(".md") {
                docs.push(file.clone());
            } else if let Some(ext) = Path::new(file).extension().and_then(|e| e.to_str()) {
                extensions.insert(format!(".{ext}"));
                paths.insert(
                    file.split('/')
                        .next()
                        .filter(|_| file.contains('/'))
                        .unwrap_or(".")
                        .to_string(),
                );
            }
        }
        let config = serde_json::to_vec_pretty(&serde_json::json!({"include":{"code":{"paths":paths,"extensions":extensions},"docs":docs}})).map_err(|e| e.to_string())?;
        let mut changes = Vec::new();
        let mut report = format!(
            "Root: {}\nCandidate configuration:\n{}\n",
            root.display(),
            String::from_utf8_lossy(&config)
        );
        for (path, reason) in &found.skipped {
            report.push_str(&format!("Skipped during discovery: {path} ({reason})\n"));
        }
        for recovery in pending_recovery(&root)? {
            report.push_str(&format!(
                "Unfinished recovery: {}; inspect manifest.json before applying changes.\n",
                recovery.display()
            ));
        }
        if safe(&root, CONFIG)?.exists() {
            read(&root, CONFIG)?;
            report.push_str("Preserve existing configuration (including with --force).\n");
        } else {
            changes.push(Change {
                path: CONFIG.into(),
                before: None,
                after: Some(config),
            });
        }
        let mut dirs = vec![SKILL_DIRS[0]];
        if options.claude {
            dirs.push(SKILL_DIRS[1]);
        }
        for dir in dirs {
            let record = owned(&root, dir)?;
            let dir_path = safe(&root, dir)?;
            // An empty real directory (left by deinit or a rolled-back init)
            // holds no user data and is treated as absent.
            let present = fs::symlink_metadata(&dir_path).is_ok() && !empty_plain_dir(&dir_path)?;
            if present && record.is_none() {
                return Err(format!("unmanaged skill conflict: {dir}; use docbridge docs show migration for manual retirement"));
            }
            let skill = format!("{dir}/SKILL.md");
            let existing = if safe(&root, &skill)?.exists() {
                Some(read(&root, &skill)?)
            } else {
                None
            };
            if let Some(bytes) = &existing {
                if !record.as_ref().is_some_and(|r| r.contains_key("SKILL.md")) {
                    return Err(format!("unowned skill file: {skill}"));
                }
                if !options.force {
                    report.push_str(&format!(
                        "Preserve managed skill {dir}; --force permits replacement.\n"
                    ));
                    continue;
                }
                if bytes == SKILL.as_bytes() {
                    report.push_str(&format!("Managed skill already current: {dir}\n"));
                    continue;
                }
            }
            let mut record = record.unwrap_or_default();
            record.insert("SKILL.md".into(), hash(SKILL.as_bytes()));
            changes.push(Change {
                path: skill,
                before: existing,
                after: Some(SKILL.as_bytes().to_vec()),
            });
            let marker = format!("{dir}/{RECORD}");
            let before = if safe(&root, &marker)?.exists() {
                Some(read(&root, &marker)?)
            } else {
                None
            };
            changes.push(Change {
                path: marker,
                before,
                after: Some(serde_json::to_vec_pretty(&record).map_err(|e| e.to_string())?),
            });
            report.push_str(&format!("Install managed skill: {dir}\n"));
        }
        if options.dry_run || !options.yes {
            report.push_str("Inspection only; no changes. Pass --yes to apply.\n");
            return Ok(report);
        }
        transact(&root, &changes)?;
        report.push_str("Initialization complete.\n");
        Ok(report)
    })())
}

#[derive(Debug)]
struct Change {
    path: String,
    before: Option<Vec<u8>>,
    after: Option<Vec<u8>>,
}
#[derive(Debug)]
pub struct RemovalPlan {
    pub root: PathBuf,
    pub preserved: Vec<String>,
    pub references: Vec<String>,
    changes: Vec<Change>,
    /// Directories that held only owned skill files; removed after success if still empty.
    directories: Vec<String>,
    /// Advisory entries that were not inspected (links, unreadable files).
    skipped: Vec<String>,
    /// Reasons the cleanup cannot be complete; apply then exits nonzero.
    incomplete: Vec<String>,
}
impl fmt::Display for RemovalPlan {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        writeln!(f, "Removal root: {}", self.root.display())?;
        for c in &self.changes {
            writeln!(
                f,
                "{} {}",
                if c.after.is_some() {
                    "Rewrite annotations:"
                } else {
                    "Remove:"
                },
                c.path
            )?;
        }
        for d in &self.directories {
            writeln!(f, "Remove directory if empty: {d}")?;
        }
        for p in &self.preserved {
            writeln!(f, "Preserve/manual review: {p}")?;
        }
        for r in &self.references {
            writeln!(f, "Manual reference cleanup: {r}")?;
        }
        for s in &self.skipped {
            writeln!(f, "Not inspected (advisory scan): {s}")?;
        }
        for i in &self.incomplete {
            writeln!(f, "Incomplete; manual review required: {i}")?;
        }
        if !self.incomplete.is_empty() {
            writeln!(
                f,
                "Cleanup will be reported as incomplete (nonzero exit) after applying this plan."
            )?;
        }
        write!(
            f,
            "Confirm this exact plan before applying.\n{}",
            uninstall_guidance()
        )
    }
}
pub fn uninstall_guidance() -> &'static str {
    "The CLI is not removed. Check installation provenance first: Homebrew: brew uninstall docbridge; Cargo: cargo uninstall docbridge; npm: npm uninstall -g docbridge (only for an npm installation). Nix profile: inspect nix profile list, then nix profile remove <verified-entry>; declarative Nix/Home Manager: remove the declared package and rebuild the owning configuration. Standalone: remove only the verified installed executable manually. Unknown provenance: consult docbridge docs before choosing a method.\n"
}
fn under(path: &str, dir: &str) -> bool {
    path.strip_prefix(dir)
        .is_some_and(|rest| rest.starts_with('/'))
}
pub fn plan_deinit(root: &Path) -> Result<RemovalPlan, String> {
    let root = fs::canonicalize(root).map_err(|e| e.to_string())?;
    let mut plan = RemovalPlan {
        root,
        preserved: Vec::new(),
        references: Vec::new(),
        changes: Vec::new(),
        directories: Vec::new(),
        skipped: Vec::new(),
        incomplete: Vec::new(),
    };
    let config_path = safe(&plan.root, CONFIG)?;
    let config = if fs::symlink_metadata(&config_path).is_ok() {
        match read(&plan.root, CONFIG) {
            Ok(bytes) => {
                plan.changes.push(Change {
                    path: CONFIG.into(),
                    before: Some(bytes),
                    after: None,
                });
                match crate::config::Config::load(&plan.root) {
                    Ok(config) => Some(config),
                    Err(e) => {
                        plan.incomplete.push(format!("{CONFIG} could not be loaded ({e}); documentation annotation scan skipped; remove @code annotations manually"));
                        None
                    }
                }
            }
            Err(e) => {
                plan.preserved.push(format!("{CONFIG} (unreadable: {e})"));
                plan.incomplete.push(format!(
                    "{CONFIG} is unreadable; documentation annotation scan skipped"
                ));
                None
            }
        }
    } else {
        None
    };
    for recovery in pending_recovery(&plan.root)? {
        plan.preserved.push(format!(
            "{} (unfinished recovery; inspect manifest.json before retrying)",
            recovery.display()
        ));
    }
    let in_docs = |p: &str| {
        config.as_ref().is_some_and(|c| {
            c.include
                .docs
                .iter()
                .any(|s| crate::config::may_contain(s, p))
        })
    };
    let mut found = Walk::default();
    walk(&plan.root, "", &mut found, &|p| {
        SKILL_DIRS.iter().any(|s| crate::config::may_contain(s, p))
            || reference_patterns()
                .iter()
                .any(|s| crate::config::may_contain(s, p))
            || in_docs(p)
    })?;
    for (path, reason) in found.skipped {
        if SKILL_DIRS.iter().any(|s| *s == path || under(s, &path)) {
            // Never treat an unsafe skill directory or ancestor as cleanable.
            return Err(format!("unsafe managed path: {path} ({reason})"));
        }
        if SKILL_DIRS.iter().any(|s| under(&path, s)) {
            plan.preserved.push(format!("{path} ({reason})"));
        } else if in_docs(&path) {
            plan.incomplete.push(format!(
                "{path} ({reason}) is in documentation scope; annotations not inspected"
            ));
        } else {
            plan.skipped.push(format!("{path} ({reason})"));
        }
    }
    for dir in SKILL_DIRS {
        if let Some(record) = owned(&plan.root, dir)? {
            let mut removed_parents = BTreeSet::new();
            for (file, digest) in record {
                let path = format!("{dir}/{file}");
                if !safe(&plan.root, &path)?.exists() {
                    continue;
                }
                let bytes = read(&plan.root, &path)?;
                if hash(&bytes) == digest {
                    let mut parent = Path::new(&path).parent();
                    while let Some(p) = parent.and_then(|p| p.to_str()) {
                        if !under(p, dir) {
                            break;
                        }
                        removed_parents.insert(p.to_string());
                        parent = Path::new(p).parent();
                    }
                    plan.changes.push(Change {
                        path,
                        before: Some(bytes),
                        after: None,
                    });
                } else {
                    plan.preserved.push(format!("{path} (modified)"));
                }
            }
            // Keep the ownership record while modified owned files remain.
            let keep_record = plan
                .preserved
                .iter()
                .any(|p| p.ends_with(" (modified)") && under(p, dir));
            if !keep_record {
                let marker = format!("{dir}/{RECORD}");
                plan.changes.push(Change {
                    before: Some(read(&plan.root, &marker)?),
                    path: marker,
                    after: None,
                });
            }
            for file in found.files.iter().filter(|f| under(f, dir)) {
                if !plan.changes.iter().any(|c| &c.path == file)
                    && !plan.preserved.iter().any(|p| p.starts_with(file))
                {
                    plan.preserved.push(file.clone());
                }
            }
            if !keep_record {
                removed_parents.insert(dir.to_string());
                // Deepest first; only directories with no preserved content.
                let mut dirs: Vec<_> = removed_parents
                    .into_iter()
                    .filter(|d| !plan.preserved.iter().any(|p| under(p, d)))
                    .collect();
                dirs.sort_by_key(|d| std::cmp::Reverse(d.matches('/').count()));
                plan.directories.extend(dirs);
            }
        } else {
            for file in found.files.iter().filter(|f| under(f, dir)) {
                plan.preserved.push(file.clone());
            }
        }
    }
    for file in found.files {
        if SKILL_DIRS.iter().any(|s| under(&file, s)) || file == CONFIG {
            continue;
        }
        let selected = file.ends_with(".md")
            && config.as_ref().is_some_and(|c| {
                c.include
                    .docs
                    .iter()
                    .any(|p| crate::config::in_scope(p, &file))
            });
        let ref_candidate = reference_patterns()
            .iter()
            .any(|p| crate::config::in_scope(p, &file));
        if !selected && !ref_candidate {
            continue;
        }
        let bytes = match read(&plan.root, &file) {
            Ok(bytes) => bytes,
            Err(e) if selected => {
                plan.incomplete.push(format!(
                    "{file} (unreadable: {e}); annotations not inspected"
                ));
                continue;
            }
            Err(e) => {
                plan.skipped.push(format!("{file} (unreadable: {e})"));
                continue;
            }
        };
        if ref_candidate
            && bytes
                .to_ascii_lowercase()
                .windows(9)
                .any(|w| w == b"docbridge")
        {
            plan.references.push(file.clone());
        }
        if !selected {
            continue;
        }
        let text = match std::str::from_utf8(&bytes) {
            Ok(text) if !text.contains('\0') => text,
            _ => {
                plan.incomplete.push(format!(
                    "{file} (non-UTF-8 or binary); annotations not inspected"
                ));
                continue;
            }
        };
        let parsed = crate::markdown::parse(text);
        let protected = raw_html_code_lines(text);
        let mut lines = BTreeSet::new();
        for annotation in parsed
            .sections
            .iter()
            .flat_map(|s| &s.annotations)
            .chain(parsed.diagnostics.iter().map(|d| &d.annotation))
        {
            if protected.contains(&annotation.line) {
                plan.preserved.push(format!(
                    "{file}:{} (inside raw HTML code example)",
                    annotation.line
                ));
            } else if relative(&annotation.target).is_ok() {
                lines.insert(annotation.line);
            } else {
                plan.preserved
                    .push(format!("{file}:{} (malformed annotation)", annotation.line));
            }
        }
        let after: String = text
            .split_inclusive('\n')
            .enumerate()
            .filter(|(i, _)| !lines.contains(&(i + 1)))
            .map(|(_, line)| line)
            .collect();
        if after.as_bytes() != bytes {
            plan.changes.push(Change {
                path: file,
                before: Some(bytes),
                after: Some(after.into_bytes()),
            });
        }
    }
    Ok(plan)
}
fn find(haystack: &[u8], needle: &[u8]) -> Option<usize> {
    haystack.windows(needle.len()).position(|w| w == needle)
}
/// 1-based lines inside raw HTML `<pre>` or `<code>` elements (case-insensitive,
/// attributes allowed), outside fenced and indented code. Comments and inline code
/// spans do not open or close elements.
fn raw_html_code_lines(text: &str) -> BTreeSet<usize> {
    let mut protected = BTreeSet::new();
    let mut fence: Option<(u8, usize)> = None;
    let mut comment = false;
    let mut depth = 0usize;
    for (index, raw) in text.split_inclusive('\n').enumerate() {
        let line = raw.trim_end_matches(['\n', '\r']);
        let trimmed = line.trim_start_matches(' ');
        let indentation = line.len() - trimmed.len();
        let marker = trimmed.bytes().next().unwrap_or(0);
        let run = trimmed.bytes().take_while(|&b| b == marker).count();
        if let Some((open, length)) = fence {
            if indentation <= 3
                && marker == open
                && run >= length
                && trimmed[run..].trim_matches([' ', '\t']).is_empty()
            {
                fence = None;
            }
            continue;
        }
        if depth == 0 && !comment {
            if indentation <= 3
                && (marker == b'`' || marker == b'~')
                && run >= 3
                && !(marker == b'`' && trimmed[run..].contains('`'))
            {
                fence = Some((marker, run));
                continue;
            }
            if indentation >= 4 {
                continue;
            }
        }
        let inside = depth > 0;
        let lower = line.to_ascii_lowercase();
        let bytes = lower.as_bytes();
        let mut i = 0;
        while i < bytes.len() {
            if comment {
                match find(&bytes[i..], b"-->") {
                    Some(end) => {
                        i += end + 3;
                        comment = false;
                    }
                    None => break,
                }
                continue;
            }
            if bytes[i..].starts_with(b"<!--") {
                comment = true;
                i += 4;
                continue;
            }
            if bytes[i] == b'`' && depth == 0 {
                let ticks = bytes[i..].iter().take_while(|&&b| b == b'`').count();
                let closing = vec![b'`'; ticks];
                i += ticks + find(&bytes[i + ticks..], &closing).map_or(0, |e| e + ticks);
                continue;
            }
            if bytes[i] == b'<' {
                let closing = bytes.get(i + 1) == Some(&b'/');
                let start = i + 1 + usize::from(closing);
                for tag in [&b"pre"[..], b"code"] {
                    if bytes[start..].starts_with(tag)
                        && matches!(
                            bytes.get(start + tag.len()),
                            None | Some(b'>' | b' ' | b'\t' | b'/')
                        )
                    {
                        if closing {
                            depth = depth.saturating_sub(1);
                        } else {
                            depth += 1;
                        }
                    }
                }
            }
            i += 1;
        }
        if inside || depth > 0 {
            protected.insert(index + 1);
        }
    }
    protected
}
/// Remove `dir` only if it is still a real, empty directory.
fn remove_empty_dir(root: &Path, dir: &str) -> Result<bool, String> {
    let path = safe(root, dir)?;
    if !empty_plain_dir(&path)? {
        return Ok(false);
    }
    fs::remove_dir(&path)
        .map(|_| true)
        .map_err(|e| format!("{}: {e}", path.display()))
}
pub fn apply_deinit(plan: &RemovalPlan) -> Outcome {
    if let Err(e) = transact(&plan.root, &plan.changes) {
        return outcome(Err(e));
    }
    let mut notes = String::new();
    for dir in &plan.directories {
        match remove_empty_dir(&plan.root, dir) {
            Ok(true) => notes.push_str(&format!("Removed empty directory: {dir}\n")),
            Ok(false) => notes.push_str(&format!("Kept non-empty directory: {dir}\n")),
            Err(e) => notes.push_str(&format!("Kept directory {dir}: {e}\n")),
        }
    }
    if plan.incomplete.is_empty() {
        return outcome(Ok(format!("Removal complete.\n{notes}{plan}")));
    }
    Outcome {
        stdout: format!("Applied the confirmed changes.\n{notes}{plan}"),
        stderr: format!(
            "Removal incomplete; manual review required:\n- {}\n",
            plan.incomplete.join("\n- ")
        ),
        code: 1,
    }
}
fn reference_patterns() -> &'static [&'static str] {
    &[
        ".github",
        ".gitlab-ci.yml",
        ".circleci",
        ".buildkite",
        "azure-pipelines.yml",
        "Jenkinsfile",
        ".githooks",
        ".husky",
        "hooks",
        "scripts",
        "tool",
        "tools",
        "bin",
        "justfile",
        "Justfile",
        "Makefile",
        "package.json",
        "Taskfile.yml",
        ".vscode/tasks.json",
        "lefthook.yml",
        "lefthook.yaml",
        ".pre-commit-config.yaml",
        "flake.nix",
        "AGENTS.md",
        "CLAUDE.md",
        ".claude/settings.json",
    ]
}
static SERIAL: AtomicU64 = AtomicU64::new(0);
fn unique() -> String {
    format!(
        "{}-{}-{}",
        std::process::id(),
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap_or_default()
            .as_nanos(),
        SERIAL.fetch_add(1, Ordering::Relaxed)
    )
}
/// Create a new file. With `permissions`, it is created private (0600 on Unix)
/// and then set to those permissions; otherwise the platform default (umask) applies.
fn write_new(
    path: &Path,
    bytes: &[u8],
    permissions: Option<&fs::Permissions>,
) -> Result<(), String> {
    let mut options = OpenOptions::new();
    options.write(true).create_new(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        if permissions.is_some() {
            options.mode(0o600);
        }
    }
    let mut file = options
        .open(path)
        .map_err(|e| format!("{}: {e}", path.display()))?;
    file.write_all(bytes)
        .and_then(|_| match permissions {
            Some(p) => file.set_permissions(p.clone()),
            None => Ok(()),
        })
        .and_then(|_| file.sync_all())
        .map_err(|e| format!("{}: {e}", path.display()))
}
#[cfg(unix)]
fn private() -> Option<fs::Permissions> {
    use std::os::unix::fs::PermissionsExt;
    Some(fs::Permissions::from_mode(0o600))
}
#[cfg(not(unix))]
fn private() -> Option<fs::Permissions> {
    // Windows: the recovery directory inherits ACLs from the project root.
    None
}
type Operation<'a> =
    dyn FnMut(&Path, &str, &Option<Vec<u8>>, Option<&fs::Permissions>) -> Result<(), String> + 'a;
/// Atomically write or remove one target. Rewrites keep `permissions` (or the
/// existing file's permissions); new files use platform defaults.
fn replace(
    root: &Path,
    name: &str,
    bytes: &Option<Vec<u8>>,
    permissions: Option<&fs::Permissions>,
) -> Result<(), String> {
    let path = safe(root, name)?;
    if let Some(bytes) = bytes {
        let parent = path.parent().ok_or("missing parent")?;
        fs::create_dir_all(parent).map_err(|e| e.to_string())?;
        safe(root, name)?;
        let keep = match permissions {
            Some(p) => Some(p.clone()),
            None => fs::symlink_metadata(&path)
                .ok()
                .filter(|m| m.is_file())
                .map(|m| m.permissions()),
        };
        let temp = parent.join(format!(".docbridge-tmp-{}", unique()));
        let result = write_new(&temp, bytes, keep.as_ref())
            .and_then(|_| fs::rename(&temp, &path).map_err(|e| format!("{}: {e}", path.display())));
        if result.is_err() {
            let _ = fs::remove_file(temp);
        }
        result
    } else {
        fs::remove_file(&path).map_err(|e| format!("{}: {e}", path.display()))
    }
}
fn transact(root: &Path, changes: &[Change]) -> Result<(), String> {
    transact_using(root, changes, &mut replace)
}
fn write_manifest(
    recovery: &Path,
    changes: &[Change],
    permissions: &[Option<fs::Permissions>],
    created: &[PathBuf],
    states: &[&str],
) -> Result<(), String> {
    let entries: Vec<_> = changes
        .iter()
        .enumerate()
        .map(|(i, c)| {
            #[cfg(unix)]
            let mode = permissions[i].as_ref().map(|p| {
                use std::os::unix::fs::PermissionsExt;
                format!("{:o}", p.mode() & 0o7777)
            });
            #[cfg(not(unix))]
            let mode = permissions[i].as_ref().map(|p| p.readonly().to_string());
            serde_json::json!({
                "path": c.path,
                "backup": c.before.as_ref().map(|_| i.to_string()),
                "before_sha256": c.before.as_ref().map(|b| hash(b)),
                "after_sha256": c.after.as_ref().map(|b| hash(b)),
                "original_permissions": mode,
                "state": states[i],
            })
        })
        .collect();
    let manifest = serde_json::json!({
        "states": "untouched: not attempted; in_progress: compare with before/after hashes; applied; failed: operation errored; restored; restore_failed: restore from backup manually",
        "changes": entries,
        "created_directories": created,
    });
    let temp = recovery.join(format!(".manifest-{}", unique()));
    write_new(
        &temp,
        &serde_json::to_vec_pretty(&manifest).map_err(|e| e.to_string())?,
        private().as_ref(),
    )?;
    fs::rename(&temp, recovery.join("manifest.json")).map_err(|e| {
        let _ = fs::remove_file(&temp);
        format!("{}: {e}", recovery.display())
    })
}
fn transact_using(
    root: &Path,
    changes: &[Change],
    operation: &mut Operation<'_>,
) -> Result<(), String> {
    let pending = pending_recovery(root)?;
    if !pending.is_empty() {
        return Err(format!("unfinished recovery directories; inspect originals and manifest before retrying: {pending:?}"));
    }
    let mut permissions = Vec::new();
    let mut created: Vec<PathBuf> = Vec::new();
    for c in changes {
        let path = safe(root, &c.path)?;
        let meta = match fs::symlink_metadata(&path) {
            Ok(m) => Some(m),
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => None,
            Err(e) => return Err(format!("{}: {e}", path.display())),
        };
        let current = if meta.is_some() {
            Some(read(root, &c.path)?)
        } else {
            None
        };
        if current != c.before {
            return Err(format!("plan is stale; no changes applied: {}", c.path));
        }
        permissions.push(meta.map(|m| m.permissions()));
        let mut parent = path.parent().ok_or("target has no parent")?;
        while !parent.exists() {
            if c.after.is_some() && !created.iter().any(|d| d == parent) {
                created.push(parent.to_path_buf());
            }
            parent = parent.parent().ok_or("missing project parent")?;
        }
        if fs::metadata(parent)
            .map_err(|e| e.to_string())?
            .permissions()
            .readonly()
        {
            return Err(format!(
                "target parent is read-only; no changes applied: {}",
                parent.display()
            ));
        }
    }
    if changes.is_empty() {
        return Ok(());
    }
    // Deepest first, so rollback removes children before parents.
    created.sort_by_key(|d| std::cmp::Reverse(d.components().count()));
    let recovery = root.join(format!(".docbridge-recovery-{}", unique()));
    let mut builder = fs::DirBuilder::new();
    #[cfg(unix)]
    {
        use std::os::unix::fs::DirBuilderExt;
        builder.mode(0o700);
    }
    builder
        .create(&recovery)
        .map_err(|e| format!("{}: {e}", recovery.display()))?;
    let mut states = vec!["untouched"; changes.len()];
    let backup = (|| {
        for (i, c) in changes.iter().enumerate() {
            if let Some(bytes) = &c.before {
                write_new(&recovery.join(i.to_string()), bytes, private().as_ref())?;
            }
        }
        write_manifest(&recovery, changes, &permissions, &created, &states)
    })();
    if let Err(e) = backup {
        return Err(format!(
            "backup failed; no targets changed: {e}; recovery: {}",
            recovery.display()
        ));
    }
    for (index, c) in changes.iter().enumerate() {
        states[index] = "in_progress";
        let step = match write_manifest(&recovery, changes, &permissions, &created, &states) {
            Err(e) => Err(("untouched", format!("manifest update failed: {e}"))),
            Ok(()) => operation(root, &c.path, &c.after, permissions[index].as_ref())
                .map_err(|e| ("failed", e)),
        };
        if let Err((state, error)) = step {
            states[index] = state;
            let mut failures = Vec::new();
            for old in (0..index).rev() {
                let c = &changes[old];
                match operation(root, &c.path, &c.before, permissions[old].as_ref()) {
                    Ok(()) => states[old] = "restored",
                    Err(e) => {
                        states[old] = "restore_failed";
                        failures.push(e);
                    }
                }
            }
            if failures.is_empty() {
                for dir in &created {
                    if empty_plain_dir(dir).unwrap_or(false) {
                        let _ = fs::remove_dir(dir);
                    }
                }
            }
            if let Err(e) = write_manifest(&recovery, changes, &permissions, &created, &states) {
                failures.push(format!("manifest update failed: {e}"));
            }
            return Err(format!("operation failed at {}: {error}; attempted changes: {:?}; untouched: {:?}; rollback failures: {:?}; recovery retained: {}", c.path, changes[..index].iter().map(|c| &c.path).collect::<Vec<_>>(), changes[index + 1..].iter().map(|c| &c.path).collect::<Vec<_>>(), failures, recovery.display()));
        }
        states[index] = "applied";
    }
    fs::remove_dir_all(&recovery).map_err(|e| {
        format!(
            "targets updated but recovery cleanup failed: {}: {e}",
            recovery.display()
        )
    })?;
    Ok(())
}
fn pending_recovery(root: &Path) -> Result<Vec<PathBuf>, String> {
    let mut paths = Vec::new();
    for entry in fs::read_dir(root).map_err(|e| e.to_string())? {
        let entry = entry.map_err(|e| e.to_string())?;
        if entry
            .file_name()
            .to_string_lossy()
            .starts_with(".docbridge-recovery-")
        {
            paths.push(entry.path());
        }
    }
    paths.sort();
    Ok(paths)
}

#[cfg(test)]
mod tests {
    use super::*;
    fn temp_root(label: &str) -> PathBuf {
        let root = std::env::temp_dir().join(format!("docbridge-{label}-{}", unique()));
        fs::create_dir(&root).unwrap();
        root
    }
    fn recovery_dir(root: &Path) -> PathBuf {
        fs::read_dir(root)
            .unwrap()
            .map(|e| e.unwrap().path())
            .find(|p| {
                p.file_name()
                    .unwrap()
                    .to_string_lossy()
                    .starts_with(".docbridge-recovery-")
            })
            .unwrap()
    }
    fn states(recovery: &Path) -> Vec<String> {
        let manifest: serde_json::Value =
            serde_json::from_slice(&fs::read(recovery.join("manifest.json")).unwrap()).unwrap();
        manifest["changes"]
            .as_array()
            .unwrap()
            .iter()
            .map(|c| c["state"].as_str().unwrap().to_string())
            .collect()
    }
    #[test]
    fn invalid_parent_fails_preflight_without_changes() {
        let root = temp_root("recovery-test");
        fs::write(root.join("first"), b"original").unwrap();
        // A file used as a parent directory is rejected during preflight.
        fs::write(root.join("blocker"), b"block").unwrap();
        let changes = vec![
            Change {
                path: "first".into(),
                before: Some(b"original".to_vec()),
                after: Some(b"changed".to_vec()),
            },
            Change {
                path: "blocker/child".into(),
                before: None,
                after: Some(b"new".to_vec()),
            },
        ];
        // Abort with ENOTDIR and leave the first target unchanged.
        let error = transact(&root, &changes).unwrap_err();
        assert!(error.contains("Not a directory") || error.contains("not a directory"));
        assert_eq!(fs::read(root.join("first")).unwrap(), b"original");
        fs::remove_dir_all(root).unwrap();
    }
    #[test]
    fn injected_failure_rolls_back_and_retains_originals_even_if_restore_fails() {
        for fail_restore in [false, true] {
            let root = temp_root("rollback-test");
            fs::write(root.join("first"), b"original").unwrap();
            fs::write(root.join("second"), b"second").unwrap();
            fs::write(root.join("third"), b"third").unwrap();
            let changes = ["first", "second", "third"]
                .map(|name| Change {
                    path: name.into(),
                    before: Some(fs::read(root.join(name)).unwrap()),
                    after: None,
                })
                .into_iter()
                .collect::<Vec<_>>();
            let mut calls = 0;
            let error = transact_using(&root, &changes, &mut |r, p, b, m| {
                calls += 1;
                if calls == 2 || (fail_restore && calls == 3) {
                    Err("injected failure".into())
                } else {
                    replace(r, p, b, m)
                }
            })
            .unwrap_err();
            assert!(error.contains("recovery retained:"));
            assert!(error.contains("second"));
            assert_eq!(fs::read(root.join("second")).unwrap(), b"second");
            assert_eq!(fs::read(root.join("third")).unwrap(), b"third");
            if !fail_restore {
                assert_eq!(fs::read(root.join("first")).unwrap(), b"original");
            }
            let recovery = recovery_dir(&root);
            assert_eq!(fs::read(recovery.join("0")).unwrap(), b"original");
            let expected = if fail_restore {
                ["restore_failed", "failed", "untouched"]
            } else {
                ["restored", "failed", "untouched"]
            };
            assert_eq!(states(&recovery), expected);
            #[cfg(unix)]
            {
                use std::os::unix::fs::PermissionsExt;
                let mode = |p: &Path| fs::metadata(p).unwrap().permissions().mode() & 0o777;
                assert_eq!(mode(&recovery), 0o700);
                assert_eq!(mode(&recovery.join("0")), 0o600);
                assert_eq!(mode(&recovery.join("manifest.json")), 0o600);
            }
            fs::remove_dir_all(root).unwrap();
        }
    }
    #[cfg(unix)]
    #[test]
    fn rollback_restores_original_permissions() {
        use std::os::unix::fs::PermissionsExt;
        let root = temp_root("permission-test");
        for name in ["removed", "rewritten"] {
            fs::write(root.join(name), name).unwrap();
            fs::set_permissions(root.join(name), fs::Permissions::from_mode(0o755)).unwrap();
        }
        let changes = vec![
            Change {
                path: "removed".into(),
                before: Some(b"removed".to_vec()),
                after: None,
            },
            Change {
                path: "rewritten".into(),
                before: Some(b"rewritten".to_vec()),
                after: Some(b"new".to_vec()),
            },
            Change {
                path: "failing".into(),
                before: None,
                after: Some(b"x".to_vec()),
            },
        ];
        let mut calls = 0;
        transact_using(&root, &changes, &mut |r, p, b, m| {
            calls += 1;
            if calls == 3 {
                Err("injected failure".into())
            } else {
                replace(r, p, b, m)
            }
        })
        .unwrap_err();
        for name in ["removed", "rewritten"] {
            assert_eq!(fs::read(root.join(name)).unwrap(), name.as_bytes());
            assert_eq!(
                fs::metadata(root.join(name)).unwrap().permissions().mode() & 0o777,
                0o755
            );
        }
        fs::remove_dir_all(root).unwrap();
    }
    #[test]
    fn rollback_removes_only_directories_it_created() {
        let root = temp_root("created-dir-test");
        fs::create_dir(root.join("existing")).unwrap();
        let changes = vec![
            Change {
                path: "existing/new/deeper/file".into(),
                before: None,
                after: Some(b"x".to_vec()),
            },
            Change {
                path: "fails".into(),
                before: None,
                after: Some(b"y".to_vec()),
            },
        ];
        let mut calls = 0;
        transact_using(&root, &changes, &mut |r, p, b, m| {
            calls += 1;
            if calls == 2 {
                Err("injected failure".into())
            } else {
                replace(r, p, b, m)
            }
        })
        .unwrap_err();
        assert!(root.join("existing").is_dir());
        assert!(!root.join("existing/new").exists());
        let manifest = fs::read_to_string(recovery_dir(&root).join("manifest.json")).unwrap();
        assert!(manifest.contains("existing/new/deeper"));
        fs::remove_dir_all(root).unwrap();
    }
    #[test]
    fn raw_html_code_detection_handles_case_attributes_comments_and_inline_code() {
        let text = "`<pre>`\n<!-- <code> -->\na\n<Code data-x=\"1\">\nb\n</CODE>\n<preview>\nc\n```\n<pre>\n```\nd\n";
        let lines: Vec<_> = raw_html_code_lines(text).into_iter().collect();
        assert_eq!(lines, vec![4, 5, 6]);
    }
}
