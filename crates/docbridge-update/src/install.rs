use crate::{hash, valid_hash, FileOps, NativeFileOps};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::{
    fs::{self, File, OpenOptions},
    io::{Read, Write},
    path::{Path, PathBuf},
};

#[derive(Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
struct Receipt {
    schema: u32,
    executable: PathBuf,
    sha256: String,
}
/// Transaction phase. The journal is written before any other recovery file.
#[derive(Serialize, Deserialize, Clone, Copy, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
enum Phase {
    /// Staging files; the executable has not been touched.
    Preparing,
    /// Staged and verified; executable/receipt mutation may have started.
    Staged,
    /// New executable and receipt are installed.
    Committed,
    /// Old executable and receipt were restored.
    Restored,
}
#[derive(Serialize, Deserialize, Clone)]
#[serde(deny_unknown_fields)]
struct Journal {
    schema: u32,
    executable: PathBuf,
    old_hash: String,
    new_hash: String,
    phase: Phase,
}
const JOURNAL: &str = "journal.json";
const JOURNAL_TMP: &str = "journal.tmp";
const RESTORE_BINARY: &str = "restore-binary.tmp";
const RESTORE_RECEIPT: &str = "restore-receipt.tmp";
/// Fixed-name scratch files: interruption leaves only these known names behind.
const SCRATCH: [&str; 3] = [JOURNAL_TMP, RESTORE_BINARY, RESTORE_RECEIPT];
/// Every name a transaction may create. The journal is always removed last.
const ENTRIES: [&str; 10] = [
    "old-binary",
    "old-receipt.json",
    "new-binary",
    "new-receipt.json",
    "running-binary",
    "failed-binary",
    JOURNAL_TMP,
    RESTORE_BINARY,
    RESTORE_RECEIPT,
    JOURNAL,
];

fn adjacent(exe: &Path, suffix: &str) -> PathBuf {
    let mut name = exe.file_name().unwrap_or_default().to_os_string();
    name.push(suffix);
    exe.with_file_name(name)
}
pub fn receipt_path(exe: &Path) -> PathBuf {
    adjacent(exe, ".docbridge-receipt.json")
}
pub fn recovery_path(exe: &Path) -> PathBuf {
    adjacent(exe, ".docbridge-update")
}
/// Exclusive lock held by upgrade (apply), cleanup and recover.
pub fn lock_path(exe: &Path) -> PathBuf {
    adjacent(exe, ".docbridge-update.lock")
}
/// Created with `create_new`; removed on drop. A stale lock (left by a killed process)
/// is never broken automatically: every locked operation fails closed naming the file.
pub(crate) struct Lock(PathBuf);
impl Lock {
    pub(crate) fn acquire(exe: &Path) -> Result<Self, String> {
        let path = lock_path(exe);
        let mut options = OpenOptions::new();
        options.write(true).create_new(true);
        #[cfg(unix)]
        {
            use std::os::unix::fs::OpenOptionsExt;
            options.mode(0o600);
        }
        match options.open(&path) {
            Ok(mut file) => {
                let lock = Lock(path);
                // Diagnostic only; the lock is the file's existence.
                let _ = writeln!(file, "{}", std::process::id()).and_then(|()| file.sync_all());
                Ok(lock)
            }
            Err(e) if e.kind() == std::io::ErrorKind::AlreadyExists => Err(format!(
                "another docbridge upgrade, cleanup or recovery holds the lock {0}; \
                 if none is running (for example after a crash), remove {0} and retry",
                path.display()
            )),
            Err(e) => Err(format!("create lock {}: {e}", path.display())),
        }
    }
}
impl Drop for Lock {
    fn drop(&mut self) {
        let _ = fs::remove_file(&self.0);
    }
}
fn regular(path: &Path) -> Result<(), String> {
    let meta = fs::symlink_metadata(path).map_err(|e| format!("{}: {e}", path.display()))?;
    if !meta.file_type().is_file() {
        return Err(format!(
            "not an ordinary nonsymlink file: {}",
            path.display()
        ));
    }
    Ok(())
}
fn executable(path: &Path) -> Result<PathBuf, String> {
    regular(path)?;
    let canonical = fs::canonicalize(path).map_err(|e| e.to_string())?;
    if let Some(hint) = managed(&canonical) {
        return Err(format!(
            "managed installation: {hint}; executable was not changed"
        ));
    }
    Ok(canonical)
}
fn managed(path: &Path) -> Option<&'static str> {
    // Match components in canonical paths, including Windows case-insensitive paths.
    let text = format!(
        "/{}/",
        path.to_string_lossy()
            .replace('\\', "/")
            .trim_matches('/')
            .to_lowercase()
    );
    if ["/nix/store/", "/gnu/store/"]
        .iter()
        .any(|p| text.contains(p))
    {
        return Some("update using Nix/Guix (nix profile upgrade / guix upgrade)");
    }
    if [
        "/opt/homebrew/",
        "/cellar/",
        "/home/linuxbrew/",
        "/.linuxbrew/",
    ]
    .iter()
    .any(|p| text.contains(p))
    {
        return Some("update using Homebrew (brew upgrade docbridge)");
    }
    if [
        "/scoop/apps/",
        "/chocolatey/",
        "/winget/",
        "/program files/",
        "/program files (x86)/",
        "/windows/",
    ]
    .iter()
    .any(|p| text.contains(p))
    {
        return Some("update using the Windows package manager that installed DocBridge");
    }
    if [
        "/usr/bin/",
        "/usr/sbin/",
        "/usr/share/",
        "/usr/lib/",
        "/opt/local/",
        "/snap/",
        "/var/lib/snapd/",
        "/node_modules/",
    ]
    .iter()
    .any(|p| text.contains(p))
        || text.starts_with("/bin/")
        || text.starts_with("/sbin/")
    {
        return Some("update using the system package manager");
    }
    None
}
fn read_limited(path: &Path) -> Result<Vec<u8>, String> {
    regular(path)?;
    let mut bytes = Vec::new();
    File::open(path)
        .map_err(|e| e.to_string())?
        .take(16 * 1024 + 1)
        .read_to_end(&mut bytes)
        .map_err(|e| e.to_string())?;
    if bytes.len() > 16 * 1024 {
        return Err("receipt/journal too large".into());
    }
    Ok(bytes)
}
fn file_hash(path: &Path) -> Result<String, String> {
    regular(path)?;
    let mut file = File::open(path).map_err(|e| e.to_string())?;
    let mut digest = Sha256::new();
    let mut buf = [0; 65536];
    loop {
        let n = file.read(&mut buf).map_err(|e| e.to_string())?;
        if n == 0 {
            break;
        }
        digest.update(&buf[..n]);
    }
    Ok(hex::encode(digest.finalize()))
}
fn receipt(exe: &Path) -> Result<Receipt, String> {
    let value: Receipt = serde_json::from_slice(&read_limited(&receipt_path(exe))?)
        .map_err(|e| format!("invalid standalone receipt: {e}"))?;
    if value.schema != 1
        || value.executable != exe
        || !valid_hash(&value.sha256)
        || file_hash(exe)? != value.sha256
    {
        return Err(
            "standalone receipt path/hash mismatch; reinstall with the standalone installer".into(),
        );
    }
    Ok(value)
}
pub(crate) fn identified(path: &Path) -> Result<PathBuf, String> {
    let exe = executable(path)?;
    let state = inspect(&exe).map_err(|e| {
        format!(
            "inspect recovery data {}: {e}",
            recovery_path(&exe).display()
        )
    })?;
    if let State::Journal(dir, journal) = &state {
        if !consistent(&exe, journal) {
            return Err(inconsistent(&exe, dir, journal));
        }
    }
    receipt(&exe).map_err(|e| {
        format!(
            "unknown/unverified install provenance: {e}; inspect recovery data if present: {}",
            recovery_path(&exe).display()
        )
    })?;
    Ok(exe)
}
enum State {
    Absent,
    /// No journal; only removable scratch entries (possibly none). Written before the
    /// first journal, so the executable was never touched.
    Abandoned(PathBuf),
    Journal(PathBuf, Journal),
}
fn inspect(exe: &Path) -> Result<State, String> {
    let dir = recovery_path(exe);
    let meta = match fs::symlink_metadata(&dir) {
        Ok(meta) => meta,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(State::Absent),
        Err(e) => return Err(e.to_string()),
    };
    if !meta.file_type().is_dir() {
        return Err("recovery path is not an ordinary directory; inspect it manually".into());
    }
    match fs::symlink_metadata(dir.join(JOURNAL)) {
        Ok(_) => {
            let (dir, journal) = load_journal(exe)?;
            Ok(State::Journal(dir, journal))
        }
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => {
            for entry in fs::read_dir(&dir).map_err(|e| e.to_string())? {
                let entry = entry.map_err(|e| e.to_string())?;
                if entry.file_name() != JOURNAL_TMP {
                    return Err(format!(
                        "recovery data without a journal ({}); inspect it manually",
                        entry.path().display()
                    ));
                }
                regular(&entry.path())?;
            }
            Ok(State::Abandoned(dir))
        }
        Err(e) => Err(e.to_string()),
    }
}
/// The installed executable and receipt match a known complete state: either the old
/// installation (never touched or fully restored) or a committed new installation.
fn consistent(exe: &Path, journal: &Journal) -> bool {
    receipt(exe).is_ok_and(|r| {
        r.sha256 == journal.old_hash
            || (journal.phase == Phase::Committed && r.sha256 == journal.new_hash)
    })
}
fn inconsistent(exe: &Path, dir: &Path, journal: &Journal) -> String {
    match journal.phase {
        Phase::Preparing | Phase::Staged => format!(
            "incomplete transaction; recover {} from {} ({})",
            exe.display(),
            dir.display(),
            backup_names(dir)
        ),
        Phase::Committed | Phase::Restored => format!(
            "installed executable/receipt do not match the finished transaction in {}; \
             inspect it manually ({})",
            dir.display(),
            backup_names(dir)
        ),
    }
}
fn backup_names(dir: &Path) -> String {
    let mut names = vec!["old-binary", "old-receipt.json"];
    if dir.join("running-binary").exists() {
        names.push("running-binary");
    }
    names.join(", ")
}
fn manual_paths(exe: &Path, dir: &Path) -> String {
    let mut text = format!(
        "manual recovery: old binary {}, old receipt {}",
        dir.join("old-binary").display(),
        dir.join("old-receipt.json").display()
    );
    if dir.join("running-binary").exists() {
        text.push_str(&format!(
            ", running binary {}",
            dir.join("running-binary").display()
        ));
    }
    text.push_str(&format!(", executable {}", exe.display()));
    text
}
fn receipt_bytes(exe: &Path, digest: String) -> Result<Vec<u8>, String> {
    serde_json::to_vec(&Receipt {
        schema: 1,
        executable: exe.into(),
        sha256: digest,
    })
    .map_err(|e| e.to_string())
}
fn sync_dir(path: &Path) -> Result<(), String> {
    #[cfg(unix)]
    File::open(path)
        .and_then(|f| f.sync_all())
        .map_err(|e| format!("sync {}: {e}", path.display()))?;
    #[cfg(not(unix))]
    let _ = path;
    Ok(())
}
fn private_dir(path: &Path) -> Result<(), String> {
    let mut builder = fs::DirBuilder::new();
    #[cfg(unix)]
    {
        use std::os::unix::fs::DirBuilderExt;
        builder.mode(0o700);
    }
    builder.create(path).map_err(|e| {
        format!(
            "recovery directory {}: {e}; inspect existing recovery data before retrying",
            path.display()
        )
    })
}
fn write_new(path: &Path, bytes: &[u8], ops: &dyn FileOps) -> Result<(), String> {
    let mut options = OpenOptions::new();
    options.write(true).create_new(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options.mode(0o600);
    }
    let mut file = options
        .open(path)
        .map_err(|e| format!("{}: {e}", path.display()))?;
    ops.write_all(&mut file, bytes)
        .and_then(|()| file.sync_all())
        .map_err(|e| format!("write/sync {}: {e}", path.display()))
}
fn copy_new(from: &Path, to: &Path) -> Result<(), String> {
    regular(from)?;
    let mut source = File::open(from).map_err(|e| e.to_string())?;
    let mut options = OpenOptions::new();
    options.write(true).create_new(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options.mode(0o600);
    }
    let mut dest = options.open(to).map_err(|e| e.to_string())?;
    std::io::copy(&mut source, &mut dest)
        .and_then(|_| dest.sync_all())
        .map_err(|e| e.to_string())?;
    ordinary_permissions(from, to)
}
fn ordinary_permissions(from: &Path, to: &Path) -> Result<(), String> {
    let perms = fs::metadata(from).map_err(|e| e.to_string())?.permissions();
    #[cfg(unix)]
    let perms = {
        use std::os::unix::fs::PermissionsExt;
        fs::Permissions::from_mode(perms.mode() & 0o777)
    };
    fs::set_permissions(to, perms).map_err(|e| e.to_string())?;
    File::open(to)
        .and_then(|f| f.sync_all())
        .map_err(|e| e.to_string())
}
/// Installer-only opt-in. Refuses to overwrite an existing receipt or managed install.
pub fn write_install_receipt(path: &Path) -> Result<(), String> {
    let exe = executable(path)?;
    let parent = exe.parent().ok_or("executable has no directory")?;
    let bytes = receipt_bytes(&exe, file_hash(&exe)?)?;
    let mut staged = tempfile::NamedTempFile::new_in(parent).map_err(|e| e.to_string())?;
    staged
        .write_all(&bytes)
        .and_then(|()| staged.as_file().sync_all())
        .map_err(|e| e.to_string())?;
    staged
        .persist_noclobber(receipt_path(&exe))
        .map_err(|e| e.to_string())?;
    sync_dir(parent)
}
fn remove_if_present(path: &Path) -> Result<(), String> {
    match fs::remove_file(path) {
        Ok(()) => Ok(()),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(e) => Err(format!("remove {}: {e}", path.display())),
    }
}
/// Writes a fixed-name scratch file, replacing a leftover from an interrupted run.
fn write_scratch(path: &Path, bytes: &[u8]) -> Result<(), String> {
    remove_if_present(path)?;
    write_new(path, bytes, &NativeFileOps)
}
fn save_journal(dir: &Path, journal: &Journal) -> Result<(), String> {
    let tmp = dir.join(JOURNAL_TMP);
    write_scratch(
        &tmp,
        &serde_json::to_vec(journal).map_err(|e| e.to_string())?,
    )?;
    fs::rename(&tmp, dir.join(JOURNAL)).map_err(|e| e.to_string())?;
    sync_dir(dir)
}
/// Removes a failed preparation. Only called while the executable is untouched.
fn discard(dir: &Path) -> Result<(), String> {
    for name in ENTRIES {
        remove_if_present(&dir.join(name))?;
    }
    fs::remove_dir(dir).map_err(|e| format!("remove {}: {e}", dir.display()))?;
    sync_dir(dir.parent().ok_or("missing parent")?)
}
/// Caller holds the lock and has removed consistent leftovers with `tidy`.
pub(crate) fn replace(exe: &Path, bytes: &[u8], ops: &dyn FileOps) -> Result<(), String> {
    let old = receipt(exe)?;
    let dir = recovery_path(exe);
    private_dir(&dir)?;
    let parent = exe.parent().ok_or("executable has no directory")?;
    let mut journal = Journal {
        schema: 1,
        executable: exe.into(),
        old_hash: old.sha256,
        new_hash: hash(bytes),
        phase: Phase::Preparing,
    };
    let preparation = (|| {
        // Journal first, so any leftover is attributable and safely removable.
        save_journal(&dir, &journal)?;
        copy_new(exe, &dir.join("old-binary"))?;
        copy_new(&receipt_path(exe), &dir.join("old-receipt.json"))?;
        write_new(&dir.join("new-binary"), bytes, ops)?;
        ordinary_permissions(exe, &dir.join("new-binary"))?;
        write_new(
            &dir.join("new-receipt.json"),
            &receipt_bytes(exe, journal.new_hash.clone())?,
            ops,
        )?;
        sync_dir(parent)?;
        validate_backups(exe, &dir, &journal)?;
        if file_hash(&dir.join("new-binary"))? != journal.new_hash
            || read_limited(&dir.join("new-receipt.json"))?
                != receipt_bytes(exe, journal.new_hash.clone())?
        {
            return Err("staged binary/receipt verification failed".into());
        }
        // Recheck provenance immediately before the first executable mutation.
        if executable(exe)? != exe || receipt(exe)?.sha256 != journal.old_hash {
            return Err("installation changed during preparation".into());
        }
        journal.phase = Phase::Staged;
        save_journal(&dir, &journal)
    })();
    if let Err(error) = preparation {
        return Err(match discard(&dir) {
            Ok(()) => format!("preparation failed (old binary untouched): {error}"),
            Err(e) => format!(
                "preparation failed (old binary untouched): {error}; partial recovery data {} \
                 was not removed ({e}); the next upgrade or cleanup removes it",
                dir.display()
            ),
        });
    }
    let mutation = (|| {
        #[cfg(windows)]
        ops.rename(exe, &dir.join("running-binary"))
            .map_err(|e| e.to_string())?;
        ops.rename(&dir.join("new-binary"), exe)
            .map_err(|e| e.to_string())?;
        ops.rename(&dir.join("new-receipt.json"), &receipt_path(exe))
            .map_err(|e| e.to_string())?;
        sync_dir(parent)?;
        journal.phase = Phase::Committed;
        save_journal(&dir, &journal)?;
        Ok::<(), String>(())
    })();
    if let Err(error) = mutation {
        return match restore(exe, &dir, &journal, ops) {
            Ok(()) => Err(format!(
                "replacement failed: {error}; old binary and receipt restored; \
                 backup data {} is removed by the next upgrade or cleanup",
                dir.display()
            )),
            Err(rollback) => Err(format!(
                "replacement failed: {error}; ROLLBACK FAILED: {rollback}; {}",
                manual_paths(exe, &dir)
            )),
        };
    }
    Ok(())
}
fn load_journal(exe: &Path) -> Result<(PathBuf, Journal), String> {
    let dir = recovery_path(exe);
    let meta = fs::symlink_metadata(&dir).map_err(|e| e.to_string())?;
    if !meta.file_type().is_dir() {
        return Err("recovery directory is not an ordinary directory".into());
    }
    let journal: Journal =
        serde_json::from_slice(&read_limited(&dir.join(JOURNAL))?).map_err(|e| e.to_string())?;
    if journal.schema != 1
        || journal.executable != exe
        || !valid_hash(&journal.old_hash)
        || !valid_hash(&journal.new_hash)
    {
        return Err("recovery journal path/hash mismatch".into());
    }
    Ok((dir, journal))
}
fn validate_backups(exe: &Path, dir: &Path, journal: &Journal) -> Result<(), String> {
    if file_hash(&dir.join("old-binary"))? != journal.old_hash {
        return Err("recovery backup hash mismatch".into());
    }
    let old: Receipt = serde_json::from_slice(&read_limited(&dir.join("old-receipt.json"))?)
        .map_err(|e| e.to_string())?;
    if old.schema != 1 || old.executable != exe || old.sha256 != journal.old_hash {
        return Err("recovery receipt mismatch".into());
    }
    Ok(())
}
fn restore(exe: &Path, dir: &Path, journal: &Journal, ops: &dyn FileOps) -> Result<(), String> {
    validate_backups(exe, dir, journal)?;
    // Preserve backups even if restoration itself fails or is interrupted.
    if exe.exists() {
        let current = file_hash(exe)?;
        if current != journal.old_hash && current != journal.new_hash {
            return Err("current executable changed; refusing to overwrite it".into());
        }
    }
    let binary = dir.join(RESTORE_BINARY);
    remove_if_present(&binary)?;
    copy_new(&dir.join("old-binary"), &binary)?;
    let old_receipt = dir.join(RESTORE_RECEIPT);
    write_scratch(&old_receipt, &read_limited(&dir.join("old-receipt.json"))?)?;
    #[cfg(windows)]
    if exe.exists() {
        // A running replacement may be locked. Never delete it or overwrite a prior backup.
        let failed = dir.join("failed-binary");
        if failed.try_exists().map_err(|e| e.to_string())? {
            return Err(format!(
                "{} already exists; inspect it manually before restoring",
                failed.display()
            ));
        }
        ops.rename(exe, &failed).map_err(|e| e.to_string())?;
    }
    ops.rename(&binary, exe).map_err(|e| e.to_string())?;
    ops.rename(&old_receipt, &receipt_path(exe))
        .map_err(|e| e.to_string())?;
    sync_dir(exe.parent().ok_or("missing parent")?)?;
    // Best effort: consistency is always rechecked from the installed files.
    let mut restored = journal.clone();
    restored.phase = Phase::Restored;
    let _ = save_journal(dir, &restored);
    Ok(())
}
/// Explicit repair after an interrupted update. Requires caller confirmation and the lock.
/// If the executable is absent, pass its original absolute path from the recovery report.
pub fn recover(path: &Path, confirmed: bool) -> Result<(), String> {
    if !confirmed {
        return Err("recovery requires confirmation".into());
    }
    let exe = recovery_executable(path)?;
    let _lock = Lock::acquire(&exe)?;
    let (dir, journal) = load_journal(&exe)?;
    restore(&exe, &dir, &journal, &NativeFileOps)
}
fn recovery_executable(path: &Path) -> Result<PathBuf, String> {
    let name = path.file_name().ok_or("missing executable name")?;
    let parent = fs::canonicalize(path.parent().ok_or("missing executable parent")?)
        .map_err(|e| e.to_string())?;
    let exe = parent.join(name);
    if let Some(hint) = managed(&exe) {
        return Err(format!("managed installation: {hint}"));
    }
    if exe.exists() {
        regular(&exe)?;
    }
    Ok(exe)
}
/// Deferred cleanup for a later normal launch (never check/dry-run). Takes the lock and
/// deletes only recovery data of a committed or known-restored (or never-mutated)
/// transaction. Succeeds when there is nothing to clean.
pub fn cleanup(path: &Path) -> Result<(), String> {
    let exe = executable(path)?;
    let _lock = Lock::acquire(&exe)?;
    tidy(&exe)
}
/// Caller holds the lock.
pub(crate) fn tidy(exe: &Path) -> Result<(), String> {
    match inspect(exe).map_err(|e| {
        format!(
            "inspect recovery data {}: {e}",
            recovery_path(exe).display()
        )
    })? {
        State::Absent => Ok(()),
        State::Abandoned(dir) => discard(&dir),
        State::Journal(dir, journal) if !consistent(exe, &journal) => {
            Err(inconsistent(exe, &dir, &journal))
        }
        State::Journal(dir, journal) => remove_entries(exe, &dir, &journal),
    }
}
fn remove_entries(exe: &Path, dir: &Path, journal: &Journal) -> Result<(), String> {
    let mut entries = Vec::new();
    for entry in fs::read_dir(dir).map_err(|e| e.to_string())? {
        let entry = entry.map_err(|e| e.to_string())?;
        if !ENTRIES.iter().any(|n| entry.file_name() == *n) {
            return Err(format!(
                "unexpected recovery entry {}; manual inspection required",
                entry.path().display()
            ));
        }
        regular(&entry.path())?;
        let name = entry.file_name();
        let name = name.to_str().unwrap_or_default();
        // Preparation never touched the executable (verified by `consistent`), so its
        // possibly partial staging files carry no recovery value.
        if journal.phase != Phase::Preparing && !SCRATCH.contains(&name) {
            check_entry(exe, &entry.path(), name, journal)?;
        }
        entries.push(entry.path());
    }
    // Keep the journal until all binary backups (including Windows locked files) are removed.
    entries.sort_by_key(|p| p.file_name().is_some_and(|n| n == JOURNAL));
    for entry in entries {
        fs::remove_file(&entry)
            .map_err(|e| format!("deferred cleanup {}: {e}", entry.display()))?;
    }
    fs::remove_dir(dir).map_err(|e| e.to_string())?;
    sync_dir(exe.parent().ok_or("missing parent")?)
}
fn check_entry(exe: &Path, path: &Path, name: &str, journal: &Journal) -> Result<(), String> {
    match name {
        "old-binary" | "running-binary" if file_hash(path)? != journal.old_hash => {
            Err("cleanup backup hash mismatch".into())
        }
        "new-binary" if file_hash(path)? != journal.new_hash => {
            Err("cleanup staged binary hash mismatch".into())
        }
        "failed-binary" => {
            let digest = file_hash(path)?;
            if digest != journal.new_hash && digest != journal.old_hash {
                return Err("cleanup failed binary hash mismatch".into());
            }
            Ok(())
        }
        "old-receipt.json" | "new-receipt.json" => {
            let value: Receipt =
                serde_json::from_slice(&read_limited(path)?).map_err(|e| e.to_string())?;
            let expected = if name == "old-receipt.json" {
                &journal.old_hash
            } else {
                &journal.new_hash
            };
            if value.schema != 1 || value.executable != exe || &value.sha256 != expected {
                return Err("cleanup receipt mismatch".into());
            }
            Ok(())
        }
        _ => Ok(()),
    }
}
