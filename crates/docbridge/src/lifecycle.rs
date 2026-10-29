use crate::paths;
use sha2::{Digest, Sha256};
use std::{
    collections::{BTreeMap, BTreeSet},
    fmt,
    fs::{self, OpenOptions},
    io::{ErrorKind, Write},
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
/// The content of the regular file at `name`, or `None` if it does not exist.
fn current(root: &Path, name: &str) -> Result<Option<Vec<u8>>, String> {
    match fs::symlink_metadata(paths::resolve(root, name)?) {
        Err(e) if e.kind() == ErrorKind::NotFound => Ok(None),
        _ => paths::read(root, name).map(Some),
    }
}
const TEMP_PREFIX: &str = ".docbridge-tmp-";
/// Whether `name` has the exact shape of a [`replace`] temporary file,
/// `.docbridge-tmp-<process>-<time>-<serial>` in decimal. Such a file is a
/// leftover of an interrupted write and holds no user data.
fn is_temp(name: &str) -> bool {
    name.strip_prefix(TEMP_PREFIX).is_some_and(|rest| {
        let parts: Vec<_> = rest.split('-').collect();
        parts.len() == 3
            && parts
                .iter()
                .all(|p| !p.is_empty() && p.bytes().all(|b| b.is_ascii_digit()))
    })
}
fn is_regular(metadata: &fs::Metadata) -> bool {
    !paths::is_link(metadata) && metadata.is_file()
}
/// Whether `path` is a real directory holding nothing but leftover temporary
/// files, such as one left by deinit or by an interrupted init.
fn holds_no_user_data(path: &Path) -> Result<bool, String> {
    let error = |e: std::io::Error| format!("{}: {e}", path.display());
    match fs::symlink_metadata(path) {
        Ok(m) if !paths::is_link(&m) && m.is_dir() => {}
        Ok(_) => return Ok(false),
        Err(e) if e.kind() == ErrorKind::NotFound => return Ok(false),
        Err(e) => return Err(error(e)),
    }
    for entry in fs::read_dir(path).map_err(error)? {
        let entry = entry.map_err(error)?;
        let leftover = entry.file_name().to_str().is_some_and(is_temp)
            && fs::symlink_metadata(entry.path()).is_ok_and(|m| is_regular(&m));
        if !leftover {
            return Ok(false);
        }
    }
    Ok(true)
}
/// Removals of the leftover temporary files under `dir` among the walked `files`.
/// A file the ownership `record` lists is never a leftover; its hash decides.
fn leftovers(
    root: &Path,
    files: &[String],
    dir: &str,
    record: Option<&BTreeMap<String, String>>,
) -> Result<Vec<Change>, String> {
    let recorded = |f: &str| {
        f.strip_prefix(dir)
            .and_then(|rest| rest.strip_prefix('/'))
            .is_some_and(|name| record.is_some_and(|r| r.contains_key(name)))
    };
    files
        .iter()
        .filter(|f| under(f, dir) && f.rsplit('/').next().is_some_and(is_temp) && !recorded(f))
        .map(|f| {
            Ok(Change {
                path: f.clone(),
                before: Some(paths::read(root, f)?),
                after: None,
            })
        })
        .collect()
}
fn owned(root: &Path, dir: &str) -> Result<Option<BTreeMap<String, String>>, String> {
    let marker = format!("{dir}/{RECORD}");
    let Some(bytes) = current(root, &marker)? else {
        return Ok(None);
    };
    let record: BTreeMap<String, String> = serde_json::from_slice(&bytes)
        .map_err(|e| format!("invalid ownership record {marker}: {e}"))?;
    if record.is_empty() {
        return Err(format!("empty ownership record: {marker}"));
    }
    for (name, digest) in &record {
        relative(name)?;
        if name == RECORD || digest.len() != 64 || !digest.bytes().all(|b| b.is_ascii_hexdigit()) {
            return Err(format!("invalid ownership entry: {name}"));
        }
        paths::resolve(root, &format!("{dir}/{name}"))?;
    }
    Ok(Some(record))
}
pub fn init(root: &Path, options: &InitOptions) -> Outcome {
    outcome((|| {
        let root = fs::canonicalize(root).map_err(|e| e.to_string())?;
        let found = paths::walk(&root, &|_| true)?;
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
        for skipped in &found.skipped {
            report.push_str(&format!(
                "Skipped during discovery: {} ({})\n",
                skipped.path, skipped.reason
            ));
        }
        if current(&root, CONFIG)?.is_some() {
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
            let stale = leftovers(&root, &found.files, dir, record.as_ref())?;
            let dir_path = paths::resolve(&root, dir)?;
            // A directory that holds no user data is treated as absent.
            let present =
                fs::symlink_metadata(&dir_path).is_ok() && !holds_no_user_data(&dir_path)?;
            if present && record.is_none() {
                return Err(format!("unmanaged skill conflict: {dir}; use docbridge docs show migration for manual retirement"));
            }
            let skill = format!("{dir}/SKILL.md");
            let existing = current(&root, &skill)?;
            if existing.is_some() && !record.as_ref().is_some_and(|r| r.contains_key("SKILL.md")) {
                return Err(format!("unowned skill file: {skill}"));
            }
            if existing.is_some() && !options.force {
                report.push_str(&format!(
                    "Preserve managed skill {dir}; --force permits replacement.\n"
                ));
            } else {
                let digest = hash(SKILL.as_bytes());
                let mut record = record.unwrap_or_default();
                let changed = changes.len();
                // The record goes first, so a rerun after a failed skill write
                // still recognizes the directory as owned and finishes the install.
                if record.get("SKILL.md") != Some(&digest) {
                    record.insert("SKILL.md".into(), digest);
                    let marker = format!("{dir}/{RECORD}");
                    changes.push(Change {
                        before: current(&root, &marker)?,
                        path: marker,
                        after: Some(serde_json::to_vec_pretty(&record).map_err(|e| e.to_string())?),
                    });
                }
                if existing.as_deref() != Some(SKILL.as_bytes()) {
                    changes.push(Change {
                        path: skill,
                        before: existing,
                        after: Some(SKILL.as_bytes().to_vec()),
                    });
                }
                if changes.len() == changed {
                    report.push_str(&format!("Managed skill already current: {dir}\n"));
                } else {
                    report.push_str(&format!("Install managed skill: {dir}\n"));
                }
            }
            for leftover in stale {
                report.push_str(&format!(
                    "Remove leftover temporary file: {}\n",
                    leftover.path
                ));
                changes.push(leftover);
            }
        }
        if options.dry_run || !options.yes {
            report.push_str("Inspection only; no changes. Pass --yes to apply.\n");
            return Ok(report);
        }
        let steps: Vec<_> = changes.into_iter().map(Step::File).collect();
        apply(&root, &steps)?;
        report.push_str("Initialization complete.\n");
        Ok(report)
    })())
}

/// Write (`after` is `Some`) or remove one file whose content is still `before`.
#[derive(Debug)]
struct Change {
    path: String,
    before: Option<Vec<u8>>,
    after: Option<Vec<u8>>,
}
#[derive(Debug)]
enum Step {
    File(Change),
    /// Remove a directory if it is empty when the step runs.
    Directory(String),
}
impl Step {
    fn path(&self) -> &str {
        match self {
            Step::File(change) => &change.path,
            Step::Directory(dir) => dir,
        }
    }
}
#[derive(Debug)]
pub struct RemovalPlan {
    pub root: PathBuf,
    pub preserved: Vec<String>,
    pub references: Vec<String>,
    /// Applied in order; see [`plan_deinit`].
    steps: Vec<Step>,
    /// Advisory entries that were not inspected (links, unreadable files).
    skipped: Vec<String>,
    /// Reasons the cleanup cannot be complete; apply then exits nonzero.
    incomplete: Vec<String>,
}
impl fmt::Display for RemovalPlan {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        writeln!(f, "Removal root: {}", self.root.display())?;
        for step in &self.steps {
            match step {
                Step::File(Change {
                    path,
                    after: Some(_),
                    ..
                }) => writeln!(f, "Rewrite annotations: {path}")?,
                Step::File(Change { path, .. }) => writeln!(f, "Remove: {path}")?,
                Step::Directory(dir) => writeln!(f, "Remove directory if empty: {dir}")?,
            }
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
    "The CLI is not removed. Remove it the way it was installed: downloaded executable: delete the file; Nix: inspect nix profile list, then nix profile remove <verified-entry>; cargo install: cargo uninstall docbridge.\n"
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
        steps: Vec::new(),
        skipped: Vec::new(),
        incomplete: Vec::new(),
    };
    let mut config_removal = None;
    let config_path = paths::resolve(&plan.root, CONFIG)?;
    let config = if fs::symlink_metadata(&config_path).is_ok() {
        match paths::read(&plan.root, CONFIG) {
            Ok(bytes) => {
                config_removal = Some(Step::File(Change {
                    path: CONFIG.into(),
                    before: Some(bytes),
                    after: None,
                }));
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
    let in_docs = |p: &str| {
        config.as_ref().is_some_and(|c| {
            c.include
                .docs
                .iter()
                .any(|s| crate::config::may_contain(s, p))
        })
    };
    let found = paths::walk(&plan.root, &|p| {
        SKILL_DIRS.iter().any(|s| crate::config::may_contain(s, p))
            || reference_patterns()
                .iter()
                .any(|s| crate::config::may_contain(s, p))
            || in_docs(p)
    })?;
    for paths::Skipped { path, reason, .. } in found.skipped {
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
    let mut skill_steps = Vec::new();
    for dir in SKILL_DIRS {
        let record = owned(&plan.root, dir)?;
        let mut removals = Vec::new();
        let mut modified = false;
        // Owned subdirectories come from the record rather than from the files
        // still present, so a rerun still finds them after their files are gone.
        let mut directories = BTreeSet::new();
        for (file, digest) in record.iter().flatten() {
            let path = format!("{dir}/{file}");
            directories.extend(
                Path::new(&path)
                    .ancestors()
                    .skip(1)
                    .filter_map(Path::to_str)
                    .take_while(|p| under(p, dir))
                    .map(String::from),
            );
            let Some(bytes) = current(&plan.root, &path)? else {
                continue;
            };
            if hash(&bytes) == *digest {
                removals.push(Change {
                    path,
                    before: Some(bytes),
                    after: None,
                });
            } else {
                plan.preserved.push(format!("{path} (modified)"));
                modified = true;
            }
        }
        removals.extend(leftovers(&plan.root, &found.files, dir, record.as_ref())?);
        // Keep the ownership record while modified owned files remain.
        let remove_record = record.is_some() && !modified;
        let marker = format!("{dir}/{RECORD}");
        for file in found.files.iter().filter(|f| under(f, dir)) {
            let planned =
                removals.iter().any(|c| &c.path == file) || (remove_record && *file == marker);
            if !planned && !plan.preserved.iter().any(|p| p.starts_with(file.as_str())) {
                plan.preserved.push(file.clone());
            }
        }
        skill_steps.extend(removals.into_iter().map(Step::File));
        let unpreserved = |d: &str| !plan.preserved.iter().any(|p| under(p, d));
        if remove_record {
            // The record goes only after the files and directories it covers,
            // so a rerun after a partial failure still knows what to remove.
            // Deepest first; only directories with no preserved content.
            let mut directories: Vec<_> =
                directories.into_iter().filter(|d| unpreserved(d)).collect();
            directories.sort_by_key(|d| std::cmp::Reverse(d.matches('/').count()));
            for directory in directories {
                if fs::symlink_metadata(paths::resolve(&plan.root, &directory)?).is_ok() {
                    skill_steps.push(Step::Directory(directory));
                }
            }
            skill_steps.push(Step::File(Change {
                before: Some(paths::read(&plan.root, &marker)?),
                path: marker,
                after: None,
            }));
        }
        // Without a record, as after a failed run removed it, only a directory
        // that holds no user data is removed.
        let removable = if record.is_some() {
            remove_record && unpreserved(dir)
        } else {
            holds_no_user_data(&paths::resolve(&plan.root, dir)?)?
        };
        if removable {
            skill_steps.push(Step::Directory(dir.into()));
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
        let bytes = match paths::read(&plan.root, &file) {
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
        for example in crate::markdown::html_block_annotations(text) {
            let location = format!("{file}:{}", example.line);
            if example.terminated {
                plan.preserved
                    .push(format!("{location} (inside HTML block example)"));
            } else {
                plan.preserved.push(format!(
                    "{location} (inside an unterminated HTML block, review manually)"
                ));
                plan.incomplete.push(format!(
                    "{location} is inside an unterminated HTML block; annotation-looking line not removed"
                ));
            }
        }
        let mut lines = BTreeSet::new();
        for annotation in parsed
            .sections
            .iter()
            .flat_map(|s| &s.annotations)
            .chain(parsed.diagnostics.iter().map(|d| &d.annotation))
        {
            if relative(&annotation.target).is_ok() {
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
            plan.steps.push(Step::File(Change {
                path: file,
                before: Some(bytes),
                after: Some(after.into_bytes()),
            }));
        }
    }
    // Rewrites first and the configuration last; each ownership record already
    // follows what it covers. A rerun after a partial failure then still finds
    // the documentation scope and ownership it needs to finish.
    plan.steps.extend(skill_steps);
    plan.steps.extend(config_removal);
    Ok(plan)
}
/// Remove `dir` if it is still a real, empty directory, and describe the result.
fn remove_empty_dir(root: &Path, dir: &str) -> Result<String, String> {
    let path = paths::resolve(root, dir)?;
    let error = |e: std::io::Error| format!("{}: {e}", path.display());
    match fs::symlink_metadata(&path) {
        Err(e) if e.kind() == ErrorKind::NotFound => return Ok(String::new()),
        Err(e) => return Err(error(e)),
        Ok(_) => {}
    }
    if fs::read_dir(&path).map_err(error)?.next().is_some() {
        return Ok(format!("Kept non-empty directory: {dir}\n"));
    }
    fs::remove_dir(&path).map_err(error)?;
    Ok(format!("Removed empty directory: {dir}\n"))
}
pub fn apply_deinit(plan: &RemovalPlan) -> Outcome {
    let notes = match apply(&plan.root, &plan.steps) {
        Ok(notes) => notes,
        Err(e) => return outcome(Err(e)),
    };
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
/// A fresh name that [`is_temp`] recognizes.
fn temp_name() -> String {
    format!("{TEMP_PREFIX}{}", unique())
}
/// Write or remove one target atomically. New content goes to a temporary
/// file in the target's directory and is renamed over the target, so the
/// target holds either its old or its new content. A rewrite keeps the
/// target's permissions; a new file gets the platform defaults.
fn replace(root: &Path, name: &str, bytes: Option<&[u8]>) -> Result<(), String> {
    let path = paths::resolve(root, name)?;
    let error = |e: std::io::Error| format!("{}: {e}", path.display());
    let Some(bytes) = bytes else {
        return fs::remove_file(&path).map_err(error);
    };
    let parent = path.parent().ok_or("missing parent")?;
    fs::create_dir_all(parent).map_err(error)?;
    paths::resolve(root, name)?;
    let permissions = fs::symlink_metadata(&path)
        .ok()
        .filter(|m| m.is_file())
        .map(|m| m.permissions());
    let temp = parent.join(temp_name());
    let mut options = OpenOptions::new();
    options.write(true).create_new(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        if permissions.is_some() {
            // Private until the target's permissions are applied.
            options.mode(0o600);
        }
    }
    let result = options
        .open(&temp)
        .and_then(|mut file| {
            file.write_all(bytes)?;
            if let Some(permissions) = permissions {
                file.set_permissions(permissions)?;
            }
            file.sync_all()
        })
        .and_then(|_| fs::rename(&temp, &path));
    if result.is_err() {
        let _ = fs::remove_file(&temp);
    }
    result.map_err(error)
}
/// Apply `steps` in order, one atomic step per file, and return notes on the
/// directories. Nothing is written if any file differs from the plan or any
/// path became unsafe. A failure stops at that step and names the paths that
/// changed and those that did not; because plans are computed from the files
/// on disk, rerunning the command finishes the rest.
fn apply(root: &Path, steps: &[Step]) -> Result<String, String> {
    for step in steps {
        match step {
            Step::File(change) if current(root, &change.path)? != change.before => {
                return Err(format!(
                    "plan is stale; no changes applied: {}",
                    change.path
                ));
            }
            Step::File(_) => {}
            Step::Directory(dir) => {
                paths::resolve(root, dir)?;
            }
        }
    }
    let mut notes = String::new();
    for (index, step) in steps.iter().enumerate() {
        let result = match step {
            Step::File(change) => replace(root, &change.path, change.after.as_deref()),
            Step::Directory(dir) => remove_empty_dir(root, dir).map(|note| notes.push_str(&note)),
        };
        if let Err(e) = result {
            let list = |steps: &[Step]| {
                if steps.is_empty() {
                    return "none".to_string();
                }
                let paths: Vec<_> = steps.iter().map(Step::path).collect();
                paths.join(", ")
            };
            return Err(format!(
                "Failed to change {}: {e}\nChanged: {}\nNot changed: {}\nRun the same command again to finish; completed changes are not repeated.\n",
                step.path(),
                list(&steps[..index]),
                list(&steps[index..])
            ));
        }
    }
    Ok(notes)
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn uninstall_guidance_names_only_supported_channels() {
        let guidance = uninstall_guidance();
        for expected in ["delete", "nix profile remove", "cargo uninstall docbridge"] {
            assert!(guidance.contains(expected), "{expected}: {guidance}");
        }
        for removed in ["brew", "Homebrew", "npm"] {
            assert!(!guidance.contains(removed), "{removed}: {guidance}");
        }
    }
    #[test]
    fn invalid_parent_fails_preflight_without_changes() {
        let temp = tempfile::tempdir().unwrap();
        let root = temp.path();
        fs::write(root.join("first"), b"original").unwrap();
        // A file used as a parent directory is rejected during preflight.
        fs::write(root.join("blocker"), b"block").unwrap();
        let steps = vec![
            Step::File(Change {
                path: "first".into(),
                before: Some(b"original".to_vec()),
                after: Some(b"changed".to_vec()),
            }),
            Step::File(Change {
                path: "blocker/child".into(),
                before: None,
                after: Some(b"new".to_vec()),
            }),
        ];
        let error = apply(root, &steps).unwrap_err();
        assert!(error.contains("not a directory"), "{error}");
        assert_eq!(fs::read(root.join("first")).unwrap(), b"original");
    }
    #[test]
    fn only_exact_temporary_file_names_are_recognized() {
        assert!(is_temp(&temp_name()));
        for name in [
            ".docbridge-tmp-",
            ".docbridge-tmp-1-2",
            ".docbridge-tmp-1-2-3-4",
            ".docbridge-tmp-1--3",
            ".docbridge-tmp-a-2-3",
            ".docbridge-tmp-1-2-3.md",
            "docbridge-tmp-1-2-3",
        ] {
            assert!(!is_temp(name), "{name}");
        }
    }
}
