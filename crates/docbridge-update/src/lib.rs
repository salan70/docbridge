//! Signed standalone executable updates. No project settings or skills are touched.
mod install;
mod network;
use ed25519_dalek::{Signature, VerifyingKey};
pub use install::{
    cleanup, lock_path, receipt_path, recover, recovery_path, write_install_receipt,
};
pub use network::OfficialClient;
pub use semver::Version;
use serde::Deserialize;
use sha2::{Digest, Sha256};
use std::{
    collections::BTreeMap,
    path::{Path, PathBuf},
};

/// Populate only from compiled, maintainer-approved keys, never user input.
pub type TrustedKeys = BTreeMap<String, [u8; 32]>;
/// Checked-in production public keys (`keys/trusted-keys.txt`), compiled in.
const TRUSTED_KEYS_FILE: &str = include_str!("../keys/trusted-keys.txt");
/// The maintainer-approved production keys compiled into this build. Empty until
/// keys are added to `keys/trusted-keys.txt`; a malformed file also yields no keys,
/// so verification fails closed.
pub fn compiled_trusted_keys() -> TrustedKeys {
    parse_trusted_keys(TRUSTED_KEYS_FILE).unwrap_or_default()
}
/// Parses the compiled key file: blank lines and `#` comments are ignored, every
/// other line is `<key-id> <64 lowercase hex Ed25519 public key>`. Key IDs and
/// keys must be unique. Only used for the compiled-in file.
fn parse_trusted_keys(text: &str) -> Result<TrustedKeys, String> {
    let mut keys = TrustedKeys::new();
    for (number, line) in text.lines().enumerate() {
        let line = line.trim();
        if line.is_empty() || line.starts_with('#') {
            continue;
        }
        let fields: Vec<&str> = line.split_whitespace().collect();
        let [id, public] = fields[..] else {
            return Err(format!(
                "line {}: expected `<key-id> <public-key>`",
                number + 1
            ));
        };
        let valid_id = id.len() <= 64
            && id
                .bytes()
                .all(|b| b.is_ascii_alphanumeric() || b"._-".contains(&b));
        let mut key = [0u8; 32];
        if !valid_id
            || !valid_hash(public)
            || hex::decode_to_slice(public, &mut key).is_err()
            || VerifyingKey::from_bytes(&key).is_err()
        {
            return Err(format!("line {}: invalid key id or public key", number + 1));
        }
        if keys.values().any(|k| k == &key) || keys.insert(id.into(), key).is_some() {
            return Err(format!("line {}: duplicate key id or key", number + 1));
        }
    }
    Ok(keys)
}
pub const TARGETS: [&str; 5] = [
    "aarch64-apple-darwin",
    "x86_64-apple-darwin",
    "aarch64-unknown-linux-musl",
    "x86_64-unknown-linux-musl",
    "x86_64-pc-windows-msvc",
];
pub fn native_target() -> &'static str {
    match (std::env::consts::OS, std::env::consts::ARCH) {
        ("macos", "aarch64") => TARGETS[0],
        ("macos", "x86_64") => TARGETS[1],
        ("linux", "aarch64") => TARGETS[2],
        ("linux", "x86_64") => TARGETS[3],
        ("windows", "x86_64") => TARGETS[4],
        _ => "unsupported",
    }
}
pub struct Options {
    pub executable: PathBuf,
    pub current_version: String,
    pub target: String,
    pub check: bool,
    pub dry_run: bool,
    pub yes: bool,
    /// Set only after affirmative interactive confirmation of this update.
    pub confirmed: bool,
}
impl Options {
    pub fn new(executable: PathBuf, current_version: impl Into<String>) -> Self {
        Self {
            executable,
            current_version: current_version.into(),
            target: native_target().into(),
            check: false,
            dry_run: false,
            yes: false,
            confirmed: false,
        }
    }
}
#[derive(Debug, PartialEq, Eq)]
pub enum Status {
    /// Replaced; code 0.
    Updated,
    /// Verified newer release reported by check/dry-run; code 0.
    Available,
    /// Already at the latest stable release; code 0.
    Current,
    /// Interactive "no" via `decline`; code 0.
    Declined,
    /// Replacement requested without `yes` or `confirmed` (non-interactive without
    /// --yes); code 1, nothing written.
    ConfirmationRequired,
    /// Verification, provenance, network, lock, preparation or recovery failure; code 1.
    Error,
}
#[derive(Debug)]
pub struct Outcome {
    pub stdout: String,
    pub stderr: String,
    pub code: i32,
    pub status: Status,
}
#[derive(Clone)]
pub struct Release {
    pub tag: String,
    pub prerelease: bool,
    pub draft: bool,
    pub assets: BTreeMap<String, String>,
}
/// Trusted application seam: production callers should use OfficialClient.
pub trait ReleaseClient {
    fn latest(&self) -> Result<Release, String>;
    fn fetch(&self, release: &Release, filename: &str) -> Result<Vec<u8>, String>;
}
/// Rename seam for deterministic replacement and rollback failure fixtures.
pub trait FileOps {
    fn rename(&self, from: &Path, to: &Path) -> std::io::Result<()>;
    fn write_all(&self, file: &mut std::fs::File, bytes: &[u8]) -> std::io::Result<()> {
        use std::io::Write;
        file.write_all(bytes)
    }
}
pub struct NativeFileOps;
impl FileOps for NativeFileOps {
    fn rename(&self, from: &Path, to: &Path) -> std::io::Result<()> {
        std::fs::rename(from, to)
    }
}
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct Manifest {
    schema: u32,
    version: String,
    key_id: String,
    assets: Vec<Asset>,
}
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct Asset {
    target: String,
    filename: String,
    sha256: String,
}
#[derive(Deserialize)]
struct KeyHint {
    key_id: String,
}

/// A verified upgrade proposal. Only `plan`/`plan_with` can construct it, so `apply`
/// installs exactly the bytes whose signature and SHA256 were verified when the user
/// was asked to confirm. Nothing is downloaded again.
pub struct Plan {
    executable: PathBuf,
    target: String,
    current: Version,
    version: Version,
    sha256: String,
    bytes: Vec<u8>,
    /// Receipt-verified SHA256 of the installed executable when the plan was made.
    installed_sha256: String,
}
impl Plan {
    /// Signed stable release version that `apply` installs.
    pub fn version(&self) -> &Version {
        &self.version
    }
    pub fn current_version(&self) -> &Version {
        &self.current
    }
    pub fn target(&self) -> &str {
        &self.target
    }
    /// Signed lowercase SHA256 of the replacement executable.
    pub fn sha256(&self) -> &str {
        &self.sha256
    }
    /// Canonical executable path that `apply` replaces.
    pub fn executable(&self) -> &Path {
        &self.executable
    }
    pub fn size(&self) -> usize {
        self.bytes.len()
    }
    /// Receipt-verified SHA256 of the installed executable the plan replaces. `apply`
    /// refuses to run if the installation no longer has this hash.
    pub fn installed_sha256(&self) -> &str {
        &self.installed_sha256
    }
}
impl std::fmt::Debug for Plan {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("Plan")
            .field("executable", &self.executable)
            .field("target", &self.target)
            .field("current", &self.current)
            .field("version", &self.version)
            .field("sha256", &self.sha256)
            .field("size", &self.bytes.len())
            .field("installed_sha256", &self.installed_sha256)
            .finish()
    }
}

fn success(status: Status, message: String) -> Outcome {
    Outcome {
        stdout: format!("{message}\n"),
        stderr: String::new(),
        code: 0,
        status,
    }
}
fn failure(status: Status, message: String) -> Outcome {
    Outcome {
        stdout: String::new(),
        stderr: format!("upgrade: {message}\n"),
        code: 1,
        status,
    }
}

/// Convenience wrapper: `plan` then `apply` with the official client and compiled keys.
/// Interactive callers should use `plan`, ask, then `apply` or `decline` instead.
pub fn run(options: &Options) -> Outcome {
    run_with(
        options,
        &OfficialClient::default(),
        &compiled_trusted_keys(),
        &NativeFileOps,
    )
}
pub fn run_with(
    options: &Options,
    client: &dyn ReleaseClient,
    keys: &TrustedKeys,
    fs: &dyn FileOps,
) -> Outcome {
    match plan_with(options, client, keys) {
        Ok(plan) => apply_with(plan, options, fs),
        Err(outcome) => outcome,
    }
}
/// Read-only: verifies provenance, the signed manifest and the downloaded executable.
/// `Err` carries a finished outcome: `Status::Current` (code 0) or `Status::Error` (code 1).
pub fn plan(options: &Options) -> Result<Plan, Outcome> {
    plan_with(
        options,
        &OfficialClient::default(),
        &compiled_trusted_keys(),
    )
}
pub fn plan_with(
    options: &Options,
    client: &dyn ReleaseClient,
    keys: &TrustedKeys,
) -> Result<Plan, Outcome> {
    match verify(options, client, keys) {
        Ok(Verified::Plan(plan)) => Ok(plan),
        Ok(Verified::Current(version)) => Err(success(
            Status::Current,
            format!("Already at latest stable {version}"),
        )),
        Err(message) => Err(failure(Status::Error, message)),
    }
}
/// Installs a verified plan. `check`/`dry_run` report availability without writes.
/// Without `yes` or `confirmed` nothing is written and `Status::ConfirmationRequired`
/// (code 1) is returned. Otherwise, under the upgrade lock, consistent leftover
/// recovery data from earlier transactions is cleaned up before replacement.
pub fn apply(plan: Plan, options: &Options) -> Outcome {
    apply_with(plan, options, &NativeFileOps)
}
pub fn apply_with(plan: Plan, options: &Options, fs: &dyn FileOps) -> Outcome {
    if options.check || options.dry_run {
        return success(
            Status::Available,
            format!(
                "Verified stable {} available for {} (no changes)",
                plan.version, plan.target
            ),
        );
    }
    if !options.yes && !options.confirmed {
        return failure(
            Status::ConfirmationRequired,
            format!(
                "upgrade to {} requires --yes or interactive confirmation; no changes",
                plan.version
            ),
        );
    }
    match install_plan(&plan, options, fs) {
        Ok(()) => success(
            Status::Updated,
            format!(
                "Updated to {}; backup kept until the next upgrade or cleanup: {}",
                plan.version,
                recovery_path(&plan.executable).display()
            ),
        ),
        Err(message) => failure(Status::Error, message),
    }
}
/// Outcome for an interactive "no": `Status::Declined`, code 0, no writes.
pub fn decline(plan: &Plan) -> Outcome {
    success(
        Status::Declined,
        format!("Upgrade to {} declined; no changes", plan.version),
    )
}
fn install_plan(plan: &Plan, options: &Options, fs: &dyn FileOps) -> Result<(), String> {
    let exe = std::fs::canonicalize(&options.executable).map_err(|e| e.to_string())?;
    if exe != plan.executable || options.target != plan.target {
        return Err("plan does not match this executable/target".into());
    }
    if hash(&plan.bytes) != plan.sha256 {
        return Err("planned executable bytes changed".into());
    }
    let _lock = install::Lock::acquire(&plan.executable)?;
    let exe = install::identified(&plan.executable)?;
    // Bind the plan to the installation it was made for: a stale plan must never
    // downgrade or overwrite an installation changed by a later upgrade or recovery.
    // Checked before any write, including cleanup of earlier recovery data.
    if install::installed_hash(&exe)? != plan.installed_sha256 {
        return Err("installation changed since the plan; re-run upgrade (no changes)".into());
    }
    install::tidy(&exe)?;
    install::replace(&exe, &plan.bytes, fs)
}
fn version(value: &str) -> Result<Version, String> {
    Version::parse(value.strip_prefix('v').unwrap_or(value))
        .map_err(|e| format!("invalid version: {e}"))
}
enum Verified {
    Plan(Plan),
    Current(Version),
}
fn verify(o: &Options, client: &dyn ReleaseClient, keys: &TrustedKeys) -> Result<Verified, String> {
    if !TARGETS.contains(&o.target.as_str()) {
        return Err("unsupported target".into());
    }
    let exe = install::identified(&o.executable)?;
    let installed_sha256 = install::installed_hash(&exe)?;
    let current = version(&o.current_version)?;
    let release = client.latest()?;
    let selected = version(&release.tag)?;
    if release.prerelease || release.draft || !selected.pre.is_empty() {
        return Err("release is not stable".into());
    }
    if selected.cmp_precedence(&current).is_lt() {
        return Err("release replay/downgrade rejected".into());
    }
    if selected.cmp_precedence(&current).is_eq() {
        return Ok(Verified::Current(selected));
    }
    let raw = client.fetch(&release, "docbridge-manifest.json")?;
    if raw.len() > 1024 * 1024 {
        return Err("manifest too large".into());
    }
    // Untrusted routing hint: selects a compiled key, never a URL or filesystem path.
    let hint: KeyHint =
        serde_json::from_slice(&raw).map_err(|e| format!("invalid manifest key hint: {e}"))?;
    let key = keys
        .get(&hint.key_id)
        .ok_or("unknown signing key (production trust configuration may be pending)")?;
    let key = VerifyingKey::from_bytes(key).map_err(|e| format!("invalid trusted key: {e}"))?;
    let detached = client.fetch(&release, "docbridge-manifest.sig")?;
    let signature =
        Signature::from_slice(&detached).map_err(|e| format!("invalid signature: {e}"))?;
    key.verify_strict(&raw, &signature)
        .map_err(|e| format!("signature verification failed: {e}"))?;
    let manifest: Manifest =
        serde_json::from_slice(&raw).map_err(|e| format!("invalid signed manifest: {e}"))?;
    if manifest.schema != 1 || manifest.key_id != hint.key_id {
        return Err("unsupported manifest schema/key".into());
    }
    let signed = version(&manifest.version)?;
    if signed != selected
        || manifest.version != selected.to_string()
        || !signed.cmp_precedence(&current).is_gt()
    {
        return Err("signed version/tag mismatch or replay".into());
    }
    let mut targets = std::collections::BTreeSet::new();
    for asset in &manifest.assets {
        if !TARGETS.contains(&asset.target.as_str())
            || !targets.insert(&asset.target)
            || asset.filename != filename(&asset.target)
            || !valid_hash(&asset.sha256)
        {
            return Err("invalid signed target/filename/checksum".into());
        }
    }
    let asset = manifest
        .assets
        .iter()
        .find(|a| a.target == o.target)
        .ok_or("signed target missing")?;
    let bytes = client.fetch(&release, &asset.filename)?;
    if bytes.is_empty() || bytes.len() > 256 * 1024 * 1024 || hash(&bytes) != asset.sha256 {
        return Err("asset checksum mismatch or invalid size".into());
    }
    Ok(Verified::Plan(Plan {
        executable: exe,
        target: o.target.clone(),
        current,
        version: selected,
        sha256: asset.sha256.clone(),
        bytes,
        installed_sha256,
    }))
}
pub fn filename(target: &str) -> String {
    format!(
        "docbridge-{target}{}",
        if target.ends_with("windows-msvc") {
            ".exe"
        } else {
            ""
        }
    )
}
pub(crate) fn hash(bytes: &[u8]) -> String {
    hex::encode(Sha256::digest(bytes))
}
pub(crate) fn valid_hash(value: &str) -> bool {
    value.len() == 64
        && value
            .bytes()
            .all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b))
}

#[cfg(test)]
mod trusted_key_file_tests {
    use super::*;
    const KEY: &str = "197f6b23e16c8532c6abc838facd5ea789be0c76b2920334039bfa8b3d368d61";

    #[test]
    fn compiled_key_file_is_well_formed() {
        let keys = parse_trusted_keys(TRUSTED_KEYS_FILE).expect("keys/trusted-keys.txt");
        assert_eq!(compiled_trusted_keys(), keys);
        // Primary and backup are added together, never just one.
        assert!(
            keys.is_empty() || keys.len() >= 2,
            "add a primary and a backup key"
        );
    }
    #[test]
    fn key_file_parsing_is_strict() {
        let keys = parse_trusted_keys(&format!("# c\n\nprimary-1 {KEY}\n")).unwrap();
        assert_eq!(keys.len(), 1);
        for bad in [
            format!("primary-1 {KEY} extra"),
            format!("primary-1 {}", KEY.to_uppercase()),
            format!("bad/id {KEY}"),
            "primary-1 00".to_string(),
            format!("a {KEY}\na {KEY}"),
            format!("a {KEY}\nb {KEY}"),
        ] {
            assert!(parse_trusted_keys(&bad).is_err(), "{bad}");
        }
    }
}
