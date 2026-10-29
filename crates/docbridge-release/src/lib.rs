//! Signs and verifies the vNext release asset set consumed by `docbridge-update`.
//!
//! `sign_release` writes exactly the assets the upgrade verifier fetches: one raw
//! executable per target named by [`docbridge_update::filename`], the signed
//! `docbridge-manifest.json`, its raw detached Ed25519 signature
//! `docbridge-manifest.sig`, and an unsigned convenience `SHA256SUMS`.
//! `verify_release` checks a complete local asset set through the real
//! `docbridge_update::plan_with` verification for every target.
use docbridge_update::{
    filename, plan_with, write_install_receipt, Options, Release, ReleaseClient, TrustedKeys,
    Version, TARGETS,
};
use ed25519_dalek::{Signer, SigningKey};
use serde::Serialize;
use sha2::{Digest, Sha256};
use std::{
    collections::{BTreeMap, BTreeSet},
    fs,
    io::Read,
    path::Path,
};

pub const MANIFEST: &str = "docbridge-manifest.json";
pub const SIGNATURE: &str = "docbridge-manifest.sig";
pub const SUMS: &str = "SHA256SUMS";
/// Same per-executable bound the upgrade verifier enforces.
const MAX_EXECUTABLE: u64 = 256 * 1024 * 1024;
/// Lower than every stable release, so the verifier treats any signed version as newer.
const BELOW_ANY_RELEASE: &str = "0.0.0-0";

/// Every target executable name, in `TARGETS` order.
pub fn executable_names() -> Vec<String> {
    TARGETS.iter().map(|t| filename(t)).collect()
}
/// The complete release asset set: executables, manifest, signature and checksums.
pub fn asset_names() -> BTreeSet<String> {
    let mut names: BTreeSet<String> = executable_names().into_iter().collect();
    names.extend([MANIFEST, SIGNATURE, SUMS].map(String::from));
    names
}

/// A release version must be canonical stable semver without a leading `v`, without
/// prerelease or build metadata, because the verifier only installs stable releases
/// and binds the manifest version to the `v<version>` tag exactly.
pub fn release_version(value: &str) -> Result<Version, String> {
    let parsed =
        Version::parse(value).map_err(|e| format!("invalid release version {value:?}: {e}"))?;
    if parsed.to_string() != value || !parsed.pre.is_empty() || !parsed.build.is_empty() {
        return Err(format!(
            "release version {value:?} must be canonical X.Y.Z without prerelease or build metadata"
        ));
    }
    Ok(parsed)
}
pub fn validate_key_id(key_id: &str) -> Result<(), String> {
    let ok = !key_id.is_empty()
        && key_id.len() <= 64
        && key_id
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || b"._-".contains(&b));
    if ok {
        Ok(())
    } else {
        Err("key id must be 1-64 characters of [A-Za-z0-9._-]".into())
    }
}
/// Parses a private Ed25519 seed: exactly 64 hex characters, surrounding whitespace
/// ignored. The input buffer is zeroed before returning.
pub fn parse_signing_key(mut text: Vec<u8>) -> Result<SigningKey, String> {
    let result = (|| {
        let trimmed = std::str::from_utf8(&text)
            .map_err(|_| "signing key is not UTF-8 hex".to_string())?
            .trim();
        let mut seed = [0u8; 32];
        if trimmed.len() != 64 || hex::decode_to_slice(trimmed, &mut seed).is_err() {
            return Err("signing key must be 64 hex characters (a 32-byte Ed25519 seed)".into());
        }
        let key = SigningKey::from_bytes(&seed);
        seed.fill(0);
        Ok(key)
    })();
    text.fill(0);
    result
}
pub fn parse_public_key(text: &str) -> Result<[u8; 32], String> {
    let mut key = [0u8; 32];
    let text = text.trim();
    if text.len() != 64 || hex::decode_to_slice(text, &mut key).is_err() {
        return Err("public key must be 64 hex characters".into());
    }
    ed25519_dalek::VerifyingKey::from_bytes(&key)
        .map_err(|e| format!("invalid public key: {e}"))?;
    Ok(key)
}
pub fn public_key_hex(key: &SigningKey) -> String {
    hex::encode(key.verifying_key().to_bytes())
}

#[derive(Serialize)]
struct Manifest<'a> {
    schema: u32,
    version: &'a str,
    key_id: &'a str,
    assets: Vec<Asset>,
}
#[derive(Serialize)]
struct Asset {
    target: String,
    filename: String,
    sha256: String,
}
/// Exact manifest bytes for `(target, sha256)` pairs. The verifier signs and checks
/// these bytes without normalization.
pub fn manifest_bytes(version: &str, key_id: &str, assets: &[(&str, String)]) -> Vec<u8> {
    let manifest = Manifest {
        schema: 1,
        version,
        key_id,
        assets: assets
            .iter()
            .map(|(target, sha256)| Asset {
                target: (*target).into(),
                filename: filename(target),
                sha256: sha256.clone(),
            })
            .collect(),
    };
    let mut bytes = serde_json::to_vec_pretty(&manifest).expect("manifest serializes");
    bytes.push(b'\n');
    bytes
}
pub fn sha256_hex(bytes: &[u8]) -> String {
    hex::encode(Sha256::digest(bytes))
}
/// `sha256sum -c` compatible lines for the named files.
pub fn sums_bytes(files: &BTreeMap<String, Vec<u8>>) -> Vec<u8> {
    let mut text = String::new();
    for (name, bytes) in files {
        text.push_str(&sha256_hex(bytes));
        text.push_str("  ");
        text.push_str(name);
        text.push('\n');
    }
    text.into_bytes()
}

fn read_regular(path: &Path, limit: u64) -> Result<Vec<u8>, String> {
    let meta = fs::symlink_metadata(path).map_err(|e| format!("{}: {e}", path.display()))?;
    if !meta.file_type().is_file() {
        return Err(format!("{} is not a regular file", path.display()));
    }
    let mut bytes = Vec::new();
    fs::File::open(path)
        .and_then(|f| f.take(limit + 1).read_to_end(&mut bytes))
        .map_err(|e| format!("{}: {e}", path.display()))?;
    if bytes.len() as u64 > limit {
        return Err(format!("{} is too large", path.display()));
    }
    Ok(bytes)
}
/// Names in `dir` must be exactly `expected` (regular files, no extras, none missing).
fn exact_entries(dir: &Path, expected: &BTreeSet<String>) -> Result<(), String> {
    let mut found = BTreeSet::new();
    for entry in fs::read_dir(dir).map_err(|e| format!("{}: {e}", dir.display()))? {
        let entry = entry.map_err(|e| e.to_string())?;
        found.insert(entry.file_name().to_string_lossy().into_owned());
    }
    let missing: Vec<_> = expected.difference(&found).cloned().collect();
    let extra: Vec<_> = found.difference(expected).cloned().collect();
    if missing.is_empty() && extra.is_empty() {
        Ok(())
    } else {
        Err(format!(
            "{} must contain exactly the release asset set; missing: [{}], unexpected: [{}]",
            dir.display(),
            missing.join(", "),
            extra.join(", ")
        ))
    }
}

pub struct SignRequest<'a> {
    pub version: &'a str,
    pub key_id: &'a str,
    pub key: &'a SigningKey,
    /// Contains exactly one executable per target, named by `filename(target)`.
    pub artifacts: &'a Path,
    /// Created by signing; must not exist yet, so stale assets are never mixed in.
    pub out: &'a Path,
}
/// Writes the complete signed asset set to `out`, then verifies it with the signing
/// key's public half through the real upgrade verifier. Returns the asset names.
pub fn sign_release(request: &SignRequest) -> Result<Vec<String>, String> {
    release_version(request.version)?;
    validate_key_id(request.key_id)?;
    exact_entries(request.artifacts, &executable_names().into_iter().collect())?;
    let mut files = BTreeMap::new();
    let mut assets = Vec::new();
    for target in TARGETS {
        let name = filename(target);
        let bytes = read_regular(&request.artifacts.join(&name), MAX_EXECUTABLE)?;
        if bytes.is_empty() {
            return Err(format!("{name} is empty"));
        }
        assets.push((target, sha256_hex(&bytes)));
        files.insert(name, bytes);
    }
    let manifest = manifest_bytes(request.version, request.key_id, &assets);
    let signature = request.key.sign(&manifest).to_bytes().to_vec();
    files.insert(MANIFEST.into(), manifest);
    files.insert(SIGNATURE.into(), signature);
    let sums = sums_bytes(&files);
    files.insert(SUMS.into(), sums);

    fs::create_dir(request.out).map_err(|e| format!("create {}: {e}", request.out.display()))?;
    for (name, bytes) in &files {
        fs::write(request.out.join(name), bytes).map_err(|e| format!("write {name}: {e}"))?;
    }
    let keys = TrustedKeys::from([(
        request.key_id.to_string(),
        request.key.verifying_key().to_bytes(),
    )]);
    verify_release(request.out, request.version, &keys)?;
    Ok(files.into_keys().collect())
}

/// Serves a local asset directory as the selected `v<version>` stable release.
struct LocalRelease<'a> {
    dir: &'a Path,
    release: Release,
}
impl ReleaseClient for LocalRelease<'_> {
    fn latest(&self) -> Result<Release, String> {
        Ok(self.release.clone())
    }
    fn fetch(&self, _: &Release, name: &str) -> Result<Vec<u8>, String> {
        if !self.release.assets.contains_key(name) {
            return Err(format!("missing {name}"));
        }
        read_regular(&self.dir.join(name), MAX_EXECUTABLE)
    }
}

/// Verifies a complete local release asset set as the upgrade verifier would for the
/// `v<version>` tag: exact asset names, `SHA256SUMS`, and for every target the signed
/// manifest, key ID, version/tag binding, filename and executable SHA-256 through
/// `docbridge_update::plan_with`. Returns one summary line per target.
pub fn verify_release(
    dir: &Path,
    version: &str,
    keys: &TrustedKeys,
) -> Result<Vec<String>, String> {
    release_version(version)?;
    let names = asset_names();
    exact_entries(dir, &names)?;
    verify_sums(dir, &names)?;
    let release = Release {
        tag: format!("v{version}"),
        prerelease: false,
        draft: false,
        assets: names.iter().map(|n| (n.clone(), n.clone())).collect(),
    };
    let client = LocalRelease { dir, release };
    let mut lines = Vec::new();
    for target in TARGETS {
        // The verifier requires a receipt-identified standalone installation, so each
        // target is checked against a throwaway one that is never modified (check mode).
        let scratch = tempfile::tempdir().map_err(|e| e.to_string())?;
        let exe = scratch.path().join(filename(target));
        fs::write(&exe, b"docbridge-release verification placeholder")
            .map_err(|e| e.to_string())?;
        write_install_receipt(&exe)?;
        let mut options = Options::new(exe, BELOW_ANY_RELEASE);
        options.target = target.into();
        options.check = true;
        let plan = plan_with(&options, &client, keys)
            .map_err(|o| format!("{target}: {}", o.stderr.trim()))?;
        let bytes = read_regular(&dir.join(filename(target)), MAX_EXECUTABLE)?;
        if plan.version().to_string() != version
            || plan.target() != target
            || plan.sha256() != sha256_hex(&bytes)
        {
            return Err(format!("{target}: verified plan does not match the asset"));
        }
        lines.push(format!("{target} {} {}", filename(target), plan.sha256()));
    }
    Ok(lines)
}
fn verify_sums(dir: &Path, names: &BTreeSet<String>) -> Result<(), String> {
    let text = String::from_utf8(read_regular(&dir.join(SUMS), 64 * 1024)?)
        .map_err(|_| format!("{SUMS} is not UTF-8"))?;
    let mut covered = BTreeSet::new();
    for line in text.lines() {
        let (hash, name) = line
            .split_once("  ")
            .ok_or_else(|| format!("malformed {SUMS} line: {line:?}"))?;
        if name == SUMS || !names.contains(name) || !covered.insert(name.to_string()) {
            return Err(format!("unexpected or duplicate {SUMS} entry: {name:?}"));
        }
        let actual = sha256_hex(&read_regular(&dir.join(name), MAX_EXECUTABLE)?);
        if hash != actual {
            return Err(format!("{SUMS} mismatch for {name}"));
        }
    }
    let mut expected = names.clone();
    expected.remove(SUMS);
    if covered != expected {
        return Err(format!("{SUMS} does not cover every release asset"));
    }
    Ok(())
}
