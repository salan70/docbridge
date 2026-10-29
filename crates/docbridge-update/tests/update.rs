use docbridge_update::*;
use ed25519_dalek::{Signer, SigningKey};
use sha2::{Digest, Sha256};
use std::{collections::BTreeMap, fs, path::Path};

mod running_process;

struct Fixture {
    release: Release,
    files: BTreeMap<String, Vec<u8>>,
}
impl ReleaseClient for Fixture {
    fn latest(&self) -> Result<Release, String> {
        Ok(self.release.clone())
    }
    fn fetch(&self, _: &Release, name: &str) -> Result<Vec<u8>, String> {
        self.files
            .get(name)
            .cloned()
            .ok_or_else(|| format!("missing {name}"))
    }
}
fn fixture(version: &str, target: &str, checksum: &str) -> (Fixture, TrustedKeys) {
    let signing = SigningKey::from_bytes(&[42; 32]); // Test-only deterministic key.
    let filename = format!(
        "docbridge-{target}{}",
        if target.contains("windows") {
            ".exe"
        } else {
            ""
        }
    );
    let raw = serde_json::to_vec(&serde_json::json!({"schema":1,"version":version,"key_id":"test-only","assets":[{"target":target,"filename":filename,"sha256":checksum}]})).unwrap();
    let sig = signing.sign(&raw).to_bytes().to_vec();
    (
        Fixture {
            release: Release {
                tag: format!("v{version}"),
                draft: false,
                prerelease: false,
                assets: BTreeMap::new(),
            },
            files: BTreeMap::from([
                ("docbridge-manifest.json".into(), raw),
                ("docbridge-manifest.sig".into(), sig),
                (filename, b"new binary fixture".to_vec()),
            ]),
        },
        BTreeMap::from([("test-only".into(), signing.verifying_key().to_bytes())]),
    )
}
fn setup() -> (tempfile::TempDir, Options, Fixture, TrustedKeys) {
    let dir = tempfile::tempdir().unwrap();
    let exe = dir.path().join("docbridge");
    fs::write(&exe, b"old binary fixture").unwrap();
    write_install_receipt(&exe).unwrap();
    let mut options = Options::new(exe, "1.0.0");
    options.yes = true;
    let (client, keys) = fixture(
        "2.0.0",
        &options.target,
        &hex::encode(Sha256::digest(b"new binary fixture")),
    );
    (dir, options, client, keys)
}
#[test]
fn trusted_update_replaces_binary_and_refreshes_receipt() {
    let (_dir, options, client, keys) = setup();
    let out = run_with(&options, &client, &keys, &NativeFileOps);
    assert_eq!(out.status, Status::Updated, "{}", out.stderr);
    assert_eq!(
        fs::read(&options.executable).unwrap(),
        b"new binary fixture"
    );
    let mut again = options;
    again.current_version = "2.0.0".into();
    assert_eq!(
        run_with(&again, &client, &keys, &NativeFileOps).status,
        Status::Current
    );
}
#[test]
fn verification_failures_never_replace() {
    for failure in [
        "checksum",
        "signature",
        "missing_signature",
        "no_key",
        "old_version",
        "target",
        "tag",
        "schema",
        "malformed",
    ] {
        let (_dir, mut options, mut client, mut keys) = setup();
        match failure {
            "checksum" => {
                client
                    .files
                    .insert(filename(&options.target), b"tampered".to_vec());
            }
            "signature" => {
                client.files.get_mut("docbridge-manifest.sig").unwrap()[0] ^= 1;
            }
            "missing_signature" => {
                client.files.remove("docbridge-manifest.sig");
            }
            "no_key" => keys.clear(),
            "old_version" => options.current_version = "3.0.0".into(),
            "target" => {
                options.target = if options.target == TARGETS[0] {
                    TARGETS[3]
                } else {
                    TARGETS[0]
                }
                .into()
            }
            "tag" => client.release.tag = "v3.0.0".into(),
            "schema" => {
                (client, keys) = fixture("2.0.0", "invalid-target", "00");
            }
            "malformed" => {
                client
                    .files
                    .insert("docbridge-manifest.json".into(), b"{}".to_vec());
            }
            _ => unreachable!(),
        }
        let out = run_with(&options, &client, &keys, &NativeFileOps);
        assert_eq!(out.code, 1, "{failure}: {out:?}");
        let expected = match failure {
            "checksum" => "checksum mismatch",
            "signature" => "signature verification failed",
            "missing_signature" => "missing docbridge-manifest.sig",
            "no_key" => "unknown signing key",
            "old_version" => "replay/downgrade",
            "target" => "signed target missing",
            "tag" => "version/tag mismatch",
            "schema" => "invalid signed target",
            _ => "manifest key hint",
        };
        assert!(out.stderr.contains(expected), "{failure}: {}", out.stderr);
        assert_eq!(
            fs::read(&options.executable).unwrap(),
            b"old binary fixture",
            "{failure}"
        );
    }
}
#[test]
fn check_dry_run_and_decline_have_no_filesystem_writes() {
    for mode in ["check", "dry_run", "decline"] {
        let (dir, mut options, client, keys) = setup();
        match mode {
            "check" => options.check = true,
            "dry_run" => options.dry_run = true,
            _ => options.yes = false,
        }
        let before = snapshot(dir.path());
        let out = run_with(&options, &client, &keys, &NativeFileOps);
        assert_eq!(snapshot(dir.path()), before);
        if mode == "decline" {
            assert_eq!((out.status, out.code), (Status::ConfirmationRequired, 1));
        } else {
            assert_eq!(
                (out.status, out.code),
                (Status::Available, 0),
                "{}",
                out.stderr
            );
        }
    }
}
fn snapshot(dir: &Path) -> BTreeMap<String, Vec<u8>> {
    fs::read_dir(dir)
        .unwrap()
        .map(|e| {
            let e = e.unwrap();
            (
                e.file_name().to_string_lossy().into_owned(),
                fs::read(e.path()).unwrap(),
            )
        })
        .collect()
}
#[test]
fn unknown_or_modified_install_is_never_replaced() {
    for changed in [false, true] {
        let (_dir, options, client, keys) = setup();
        if changed {
            fs::write(&options.executable, b"user modified").unwrap();
        } else {
            for entry in fs::read_dir(options.executable.parent().unwrap()).unwrap() {
                let p = entry.unwrap().path();
                if p != options.executable {
                    fs::remove_file(p).unwrap();
                }
            }
        }
        assert_eq!(run_with(&options, &client, &keys, &NativeFileOps).code, 1);
        assert_ne!(
            fs::read(&options.executable).unwrap(),
            b"new binary fixture"
        );
    }
}

struct FailRename {
    calls: std::cell::Cell<usize>,
    failures: Vec<usize>,
}
impl FileOps for FailRename {
    fn rename(&self, from: &Path, to: &Path) -> std::io::Result<()> {
        let n = self.calls.get() + 1;
        self.calls.set(n);
        if self.failures.contains(&n) {
            Err(std::io::Error::new(
                std::io::ErrorKind::PermissionDenied,
                "fixture rename failure",
            ))
        } else {
            fs::rename(from, to)
        }
    }
}
#[test]
fn receipt_replace_failure_restores_old_binary_and_receipt() {
    let (dir, options, client, keys) = setup();
    let before = snapshot(dir.path());
    // Unix: executable rename, then receipt rename. Windows: move old, install, receipt.
    let failure = if cfg!(windows) { 3 } else { 2 };
    let ops = FailRename {
        calls: std::cell::Cell::new(0),
        failures: vec![failure],
    };
    let out = run_with(&options, &client, &keys, &ops);
    assert_eq!(out.code, 1);
    assert_eq!(
        fs::read(&options.executable).unwrap(),
        b"old binary fixture"
    );
    for (name, bytes) in before {
        assert_eq!(fs::read(dir.path().join(name)).unwrap(), bytes);
    }
}
#[test]
fn managed_path_overrides_positive_receipt() {
    let dir = tempfile::tempdir().unwrap();
    let bin = dir.path().join("nix/store/fixture/bin");
    fs::create_dir_all(&bin).unwrap();
    let exe = bin.join("docbridge");
    fs::write(&exe, b"old binary fixture").unwrap();
    // Even a forged matching receipt cannot authorize a known managed location.
    let canonical = fs::canonicalize(&exe).unwrap();
    fs::write(bin.join("docbridge.docbridge-receipt.json"),serde_json::to_vec(&serde_json::json!({"schema":1,"executable":canonical,"sha256":hex::encode(Sha256::digest(b"old binary fixture"))})).unwrap()).unwrap();
    let mut options = Options::new(exe, "1.0.0");
    options.yes = true;
    let (client, keys) = fixture(
        "2.0.0",
        &options.target,
        &hex::encode(Sha256::digest(b"new binary fixture")),
    );
    let out = run_with(&options, &client, &keys, &NativeFileOps);
    assert_eq!(out.code, 1);
    assert!(out.stderr.contains("managed"), "{}", out.stderr);
}
#[test]
fn receipt_for_another_executable_cannot_authorize_update() {
    let (dir, options, client, keys) = setup();
    let receipt = dir.path().join("docbridge.docbridge-receipt.json");
    let mut value: serde_json::Value =
        serde_json::from_slice(&fs::read(&receipt).unwrap()).unwrap();
    value["executable"] = serde_json::json!(dir.path().join("other"));
    fs::write(receipt, serde_json::to_vec(&value).unwrap()).unwrap();
    assert_eq!(run_with(&options, &client, &keys, &NativeFileOps).code, 1);
    assert_eq!(
        fs::read(&options.executable).unwrap(),
        b"old binary fixture"
    );
}

#[test]
fn all_five_targets_accept_only_their_signed_binary_fixture() {
    for target in TARGETS {
        let (_dir, mut options, _, _) = setup();
        options.target = target.into();
        let (client, keys) = fixture(
            "2.0.0",
            target,
            &hex::encode(Sha256::digest(b"new binary fixture")),
        );
        let result = run_with(&options, &client, &keys, &NativeFileOps);
        assert_eq!(
            result.status,
            Status::Updated,
            "{target}: {}",
            result.stderr
        );
        assert_eq!(
            fs::read(&options.executable).unwrap(),
            b"new binary fixture"
        );
    }
}
#[test]
fn rollback_failure_reports_paths_and_explicit_recovery_restores_original() {
    let (_dir, options, client, keys) = setup();
    let fail = if cfg!(windows) { 3 } else { 2 };
    let ops = FailRename {
        calls: std::cell::Cell::new(0),
        failures: vec![fail, fail + 1],
    };
    let out = run_with(&options, &client, &keys, &ops);
    assert_eq!(out.code, 1);
    assert!(out.stderr.contains("ROLLBACK FAILED"), "{}", out.stderr);
    assert!(out.stderr.contains("old-binary"));
    assert!(out.stderr.contains("old-receipt.json"));
    assert!(recover(&options.executable, false).is_err());
    recover(&options.executable, true).unwrap();
    assert_eq!(
        fs::read(&options.executable).unwrap(),
        b"old binary fixture"
    );
    cleanup(&options.executable).unwrap();
    assert!(!recovery_path(&options.executable).exists());
}
#[test]
fn cleanup_is_retryable_after_partial_previous_cleanup() {
    let (_dir, options, client, keys) = setup();
    assert_eq!(
        run_with(&options, &client, &keys, &NativeFileOps).status,
        Status::Updated
    );
    fs::remove_file(recovery_path(&options.executable).join("old-binary")).unwrap();
    cleanup(&options.executable).unwrap();
    assert!(!recovery_path(&options.executable).exists());
    assert_eq!(
        fs::read(&options.executable).unwrap(),
        b"new binary fixture"
    );
}
#[test]
fn cleanup_preserves_unrecognized_recovery_data() {
    let (_dir, options, client, keys) = setup();
    assert_eq!(
        run_with(&options, &client, &keys, &NativeFileOps).status,
        Status::Updated
    );
    let dir = recovery_path(&options.executable);
    fs::write(dir.join("user-data"), b"preserve").unwrap();
    assert!(cleanup(&options.executable).is_err());
    assert_eq!(fs::read(dir.join("user-data")).unwrap(), b"preserve");
    assert!(dir.join("old-binary").exists());
}
#[test]
fn interrupted_transaction_is_reported_and_can_be_recovered() {
    let (_dir, options, client, keys) = setup();
    assert_eq!(
        run_with(&options, &client, &keys, &NativeFileOps).status,
        Status::Updated
    );
    let path = recovery_path(&options.executable).join("journal.json");
    let mut value: serde_json::Value = serde_json::from_slice(&fs::read(&path).unwrap()).unwrap();
    value["phase"] = "staged".into();
    fs::write(path, serde_json::to_vec(&value).unwrap()).unwrap();
    let mut next = options;
    next.check = true;
    let out = run_with(&next, &client, &keys, &NativeFileOps);
    assert_eq!(out.code, 1);
    assert!(out.stderr.contains("recover"), "{}", out.stderr);
    recover(&next.executable, true).unwrap();
    assert_eq!(fs::read(&next.executable).unwrap(), b"old binary fixture");
}
#[test]
fn prerelease_and_draft_metadata_are_rejected() {
    for kind in ["draft", "prerelease", "tag"] {
        let (_dir, options, mut client, keys) = setup();
        match kind {
            "draft" => client.release.draft = true,
            "prerelease" => client.release.prerelease = true,
            _ => client.release.tag = "v2.0.0-rc.1".into(),
        }
        let out = run_with(&options, &client, &keys, &NativeFileOps);
        assert_eq!(out.code, 1);
        assert!(out.stderr.contains("not stable"));
    }
}
#[test]
fn signed_payload_cannot_select_paths_or_another_version() {
    for change in ["path", "schema", "version", "duplicate", "hash"] {
        let (_dir, options, mut client, keys) = setup();
        let mut value: serde_json::Value =
            serde_json::from_slice(&client.files["docbridge-manifest.json"]).unwrap();
        match change {
            "path" => value["assets"][0]["filename"] = "../escape".into(),
            "schema" => value["schema"] = 2.into(),
            "version" => value["version"] = "1.0.0".into(),
            "duplicate" => {
                let a = value["assets"][0].clone();
                value["assets"].as_array_mut().unwrap().push(a);
            }
            _ => value["assets"][0]["sha256"] = "xyz".into(),
        }
        let raw = serde_json::to_vec(&value).unwrap();
        let sig = SigningKey::from_bytes(&[42; 32])
            .sign(&raw)
            .to_bytes()
            .to_vec();
        client.files.insert("docbridge-manifest.json".into(), raw);
        client.files.insert("docbridge-manifest.sig".into(), sig);
        let out = run_with(&options, &client, &keys, &NativeFileOps);
        assert_eq!(out.code, 1, "{change}");
        assert_ne!(
            fs::read(&options.executable).unwrap(),
            b"new binary fixture"
        );
    }
}
#[test]
fn official_client_rejects_arbitrary_asset_urls_before_network() {
    let client = OfficialClient::default();
    for url in [
        "http://github.com/salan70/docbridge/releases/download/v2.0.0/binary",
        "https://evil.invalid/binary",
        "https://github.com/other/repo/releases/download/v2.0.0/binary",
    ] {
        let release = Release {
            tag: "v2.0.0".into(),
            draft: false,
            prerelease: false,
            assets: BTreeMap::from([("binary".into(), url.into())]),
        };
        assert!(client
            .fetch(&release, "binary")
            .unwrap_err()
            .contains("untrusted"));
    }
    // Production keys come only from the checked-in file; test keys are never trusted.
    assert!(!compiled_trusted_keys().contains_key("test-only"));
}

#[test]
fn build_metadata_alone_cannot_authorize_a_newer_release() {
    let (dir, options, _, _) = setup();
    let before = snapshot(dir.path());
    let (client, keys) = fixture(
        "1.0.0+new-build",
        &options.target,
        &hex::encode(Sha256::digest(b"new binary fixture")),
    );
    let out = run_with(&options, &client, &keys, &NativeFileOps);
    assert_eq!(out.status, Status::Current, "{}", out.stderr);
    assert_eq!(snapshot(dir.path()), before);
}
#[test]
fn signature_covers_exact_manifest_bytes_including_whitespace() {
    let (_dir, options, mut client, keys) = setup();
    client
        .files
        .get_mut("docbridge-manifest.json")
        .unwrap()
        .push(b' ');
    let out = run_with(&options, &client, &keys, &NativeFileOps);
    assert_eq!(out.code, 1);
    assert!(out.stderr.contains("signature verification failed"));
    assert_eq!(
        fs::read(&options.executable).unwrap(),
        b"old binary fixture"
    );
}
#[cfg(unix)]
#[test]
fn symlink_receipts_and_executables_never_authorize_replacement() {
    use std::os::unix::fs::symlink;
    for which in ["receipt", "executable"] {
        let (dir, options, client, keys) = setup();
        let original = if which == "receipt" {
            receipt_path(&options.executable)
        } else {
            options.executable.clone()
        };
        let moved = dir.path().join("moved");
        fs::rename(&original, &moved).unwrap();
        symlink(&moved, &original).unwrap();
        assert_eq!(run_with(&options, &client, &keys, &NativeFileOps).code, 1);
        assert!(fs::symlink_metadata(original)
            .unwrap()
            .file_type()
            .is_symlink());
    }
}
#[cfg(unix)]
#[test]
fn ordinary_permissions_are_preserved_without_privileged_bits() {
    use std::os::unix::fs::PermissionsExt;
    let (_dir, options, client, keys) = setup();
    fs::set_permissions(&options.executable, fs::Permissions::from_mode(0o6751)).unwrap();
    assert_eq!(
        run_with(&options, &client, &keys, &NativeFileOps).status,
        Status::Updated
    );
    assert_eq!(
        fs::metadata(&options.executable)
            .unwrap()
            .permissions()
            .mode()
            & 0o7777,
        0o751
    );
}

struct PartialWriteFailure;
impl FileOps for PartialWriteFailure {
    fn rename(&self, from: &Path, to: &Path) -> std::io::Result<()> {
        fs::rename(from, to)
    }
    fn write_all(&self, file: &mut fs::File, bytes: &[u8]) -> std::io::Result<()> {
        use std::io::Write;
        file.write_all(&bytes[..bytes.len().min(3)])?;
        Err(std::io::Error::new(
            std::io::ErrorKind::StorageFull,
            "fixture disk full during staged write",
        ))
    }
}
#[test]
fn partial_write_or_full_storage_keeps_old_executable_and_receipt() {
    let (dir, options, client, keys) = setup();
    let before = snapshot(dir.path());
    let out = run_with(&options, &client, &keys, &PartialWriteFailure);
    assert_eq!(out.code, 1);
    assert!(out.stderr.contains("disk full"));
    assert!(out.stderr.contains("untouched"));
    for (name, bytes) in before {
        assert_eq!(fs::read(dir.path().join(name)).unwrap(), bytes);
    }
}
#[test]
fn download_interruption_never_creates_recovery_files() {
    let (dir, options, mut client, keys) = setup();
    let before = snapshot(dir.path());
    client.files.remove(&filename(&options.target));
    let out = run_with(&options, &client, &keys, &NativeFileOps);
    assert_eq!(out.code, 1);
    assert_eq!(snapshot(dir.path()), before);
}

struct CorruptStagedWrite;
impl FileOps for CorruptStagedWrite {
    fn rename(&self, from: &Path, to: &Path) -> std::io::Result<()> {
        fs::rename(from, to)
    }
    fn write_all(&self, file: &mut fs::File, _bytes: &[u8]) -> std::io::Result<()> {
        use std::io::Write;
        file.write_all(b"silently corrupted staged bytes")
    }
}
#[test]
fn staged_bytes_are_reverified_before_replacing_executable() {
    let (_dir, options, client, keys) = setup();
    let out = run_with(&options, &client, &keys, &CorruptStagedWrite);
    assert_eq!(out.code, 1);
    assert!(out.stderr.contains("staged"), "{}", out.stderr);
    assert_eq!(
        fs::read(&options.executable).unwrap(),
        b"old binary fixture"
    );
}
#[test]
fn first_replace_permission_failure_leaves_old_install_usable() {
    let (_dir, options, client, keys) = setup();
    let ops = FailRename {
        calls: std::cell::Cell::new(0),
        failures: vec![1],
    };
    let out = run_with(&options, &client, &keys, &ops);
    assert_eq!(out.code, 1);
    assert!(out.stderr.contains("restored"));
    assert_eq!(
        fs::read(&options.executable).unwrap(),
        b"old binary fixture"
    );
}
#[test]
fn update_does_not_touch_project_configuration_or_skills() {
    let (dir, options, client, keys) = setup();
    let config = dir.path().join("docbridge.config.json");
    fs::write(&config, b"user config").unwrap();
    let skills = dir.path().join(".agents/skills");
    fs::create_dir_all(&skills).unwrap();
    fs::write(skills.join("SKILL.md"), b"user skill").unwrap();
    assert_eq!(
        run_with(&options, &client, &keys, &NativeFileOps).status,
        Status::Updated
    );
    assert_eq!(fs::read(config).unwrap(), b"user config");
    assert_eq!(fs::read(skills.join("SKILL.md")).unwrap(), b"user skill");
}
#[test]
fn cleanup_preserves_substituted_backup_files() {
    let (_dir, options, client, keys) = setup();
    assert_eq!(
        run_with(&options, &client, &keys, &NativeFileOps).status,
        Status::Updated
    );
    let old = recovery_path(&options.executable).join("old-binary");
    fs::write(&old, b"unrecognized user data").unwrap();
    assert!(cleanup(&options.executable).is_err());
    assert_eq!(fs::read(old).unwrap(), b"unrecognized user data");
}
#[test]
fn running_native_binary_survives_update_and_later_cleanup() {
    let (dir, mut options, _, keys) = setup();
    options.executable = dir
        .path()
        .join(format!("native-helper{}", std::env::consts::EXE_SUFFIX));
    let source = std::env::current_exe().unwrap();
    fs::copy(&source, &options.executable).unwrap();
    write_install_receipt(&options.executable).unwrap();
    let old_bytes = fs::read(source).unwrap();
    // macOS must retain identical bytes to preserve the ad hoc code signature.
    #[cfg(target_os = "macos")]
    let new_bytes = old_bytes.clone();
    #[cfg(not(target_os = "macos"))]
    let new_bytes = {
        let mut new_bytes = old_bytes.clone();
        new_bytes.extend_from_slice(b"docbridge-new-image-marker");
        assert_ne!(old_bytes, new_bytes);
        new_bytes
    };
    let client = signed_release("2.0.0", &options.target, &new_bytes);
    let mut old_child = running_process::RunningProcess::start(&options.executable, "old");
    let out = run_with(&options, &client, &keys, &NativeFileOps);
    assert_eq!(out.status, Status::Updated, "{}", out.stderr);
    assert_eq!(fs::read(&options.executable).unwrap(), new_bytes);
    assert_eq!(
        fs::read(recovery_path(&options.executable).join("old-binary")).unwrap(),
        old_bytes
    );
    old_child.ping();
    let mut new_child = running_process::RunningProcess::start(&options.executable, "new");
    new_child.ping();
    new_child.finish();
    #[cfg(windows)]
    {
        let old = recovery_path(&options.executable).join("running-binary");
        assert_eq!(fs::read(&old).unwrap(), old_bytes);
        let error = cleanup(&options.executable).unwrap_err();
        assert!(error.contains("running-binary"), "{error}");
        assert!(old.exists(), "the live PE image must remain available");
        assert!(recovery_path(&options.executable)
            .join("journal.json")
            .exists());
        old_child.ping();
    }
    old_child.finish();
    cleanup(&options.executable).unwrap();
    assert!(!recovery_path(&options.executable).exists());
    let mut installed = running_process::RunningProcess::start(&options.executable, "cleaned");
    installed.ping();
    installed.finish();
}

fn signed_release(version: &str, target: &str, bytes: &[u8]) -> Fixture {
    let signing = SigningKey::from_bytes(&[42; 32]);
    let name = filename(target);
    let raw = serde_json::to_vec(&serde_json::json!({"schema":1,"version":version,"key_id":"test-only","assets":[{"target":target,"filename":name,"sha256":hex::encode(Sha256::digest(bytes))}]})).unwrap();
    let sig = signing.sign(&raw).to_bytes().to_vec();
    Fixture {
        release: Release {
            tag: format!("v{version}"),
            draft: false,
            prerelease: false,
            assets: BTreeMap::new(),
        },
        files: BTreeMap::from([
            ("docbridge-manifest.json".into(), raw),
            ("docbridge-manifest.sig".into(), sig),
            (name, bytes.to_vec()),
        ]),
    }
}
#[test]
fn preparation_failure_does_not_block_a_later_upgrade() {
    let (_dir, options, client, keys) = setup();
    let out = run_with(&options, &client, &keys, &PartialWriteFailure);
    assert_eq!(out.code, 1);
    assert!(
        !recovery_path(&options.executable).exists(),
        "failed preparation must remove its own recovery data"
    );
    let out = run_with(&options, &client, &keys, &NativeFileOps);
    assert_eq!(out.status, Status::Updated, "{}", out.stderr);
}

struct KilledDuringStagedWrite;
impl FileOps for KilledDuringStagedWrite {
    fn rename(&self, from: &Path, to: &Path) -> std::io::Result<()> {
        fs::rename(from, to)
    }
    fn write_all(&self, file: &mut fs::File, bytes: &[u8]) -> std::io::Result<()> {
        use std::io::Write;
        file.write_all(&bytes[..bytes.len().min(3)])?;
        panic!("simulated process kill during staged write");
    }
}
#[test]
fn killed_preparation_is_cleaned_by_the_next_upgrade() {
    let (_dir, options, client, keys) = setup();
    let killed = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
        run_with(&options, &client, &keys, &KilledDuringStagedWrite)
    }));
    assert!(killed.is_err());
    assert_eq!(
        fs::read(&options.executable).unwrap(),
        b"old binary fixture"
    );
    let out = run_with(&options, &client, &keys, &NativeFileOps);
    assert_eq!(out.status, Status::Updated, "{}", out.stderr);
    assert_eq!(
        fs::read(&options.executable).unwrap(),
        b"new binary fixture"
    );
}
#[test]
fn consecutive_upgrades_need_no_explicit_cleanup() {
    let (_dir, options, client, keys) = setup();
    assert_eq!(
        run_with(&options, &client, &keys, &NativeFileOps).status,
        Status::Updated
    );
    let mut next = Options::new(options.executable.clone(), "2.0.0");
    next.target = options.target.clone();
    next.yes = true;
    let third = signed_release("3.0.0", &next.target, b"third binary fixture");
    let mut check = Options::new(options.executable.clone(), "2.0.0");
    check.target = options.target.clone();
    check.check = true;
    let out = run_with(&check, &third, &keys, &NativeFileOps);
    assert_eq!(out.status, Status::Available, "{}", out.stderr);
    let out = run_with(&next, &third, &keys, &NativeFileOps);
    assert_eq!(out.status, Status::Updated, "{}", out.stderr);
    assert_eq!(
        fs::read(&options.executable).unwrap(),
        b"third binary fixture"
    );
    cleanup(&options.executable).unwrap();
    assert!(!recovery_path(&options.executable).exists());
}
#[test]
fn successful_rollback_does_not_demand_recovery() {
    let (_dir, options, client, keys) = setup();
    let failure = if cfg!(windows) { 3 } else { 2 };
    let ops = FailRename {
        calls: std::cell::Cell::new(0),
        failures: vec![failure],
    };
    let out = run_with(&options, &client, &keys, &ops);
    assert!(out.stderr.contains("restored"), "{}", out.stderr);
    assert!(!out.stderr.contains("recover "), "{}", out.stderr);
    let mut check = Options::new(options.executable.clone(), "1.0.0");
    check.target = options.target.clone();
    check.check = true;
    let out = run_with(&check, &client, &keys, &NativeFileOps);
    assert_eq!(out.status, Status::Available, "{}", out.stderr);
    let out = run_with(&options, &client, &keys, &NativeFileOps);
    assert_eq!(out.status, Status::Updated, "{}", out.stderr);
}
#[test]
fn interrupted_restore_scratch_files_are_cleanable() {
    let (_dir, options, client, keys) = setup();
    assert_eq!(
        run_with(&options, &client, &keys, &NativeFileOps).status,
        Status::Updated
    );
    let dir = recovery_path(&options.executable);
    fs::write(dir.join("restore-binary.tmp"), b"old bin").unwrap();
    fs::write(dir.join("restore-receipt.tmp"), b"{").unwrap();
    cleanup(&options.executable).unwrap();
    assert!(!dir.exists());
}

struct Counting {
    inner: std::cell::RefCell<Fixture>,
    fetches: std::cell::RefCell<Vec<String>>,
}
impl ReleaseClient for Counting {
    fn latest(&self) -> Result<Release, String> {
        self.inner.borrow().latest()
    }
    fn fetch(&self, release: &Release, name: &str) -> Result<Vec<u8>, String> {
        self.fetches.borrow_mut().push(name.into());
        self.inner.borrow().fetch(release, name)
    }
}
#[test]
fn apply_installs_exactly_the_confirmed_plan_without_refetching() {
    let (_dir, options, client, keys) = setup();
    let counting = Counting {
        inner: std::cell::RefCell::new(client),
        fetches: Default::default(),
    };
    let plan = plan_with(&options, &counting, &keys).unwrap();
    assert_eq!(plan.version().to_string(), "2.0.0");
    assert_eq!(plan.target(), options.target);
    assert_eq!(
        plan.sha256(),
        hex::encode(Sha256::digest(b"new binary fixture"))
    );
    // A newer release published between confirmation and apply must not be installed.
    *counting.inner.borrow_mut() = signed_release("3.0.0", &options.target, b"unconfirmed");
    let out = apply_with(plan, &options, &NativeFileOps);
    assert_eq!(out.status, Status::Updated, "{}", out.stderr);
    assert_eq!(
        fs::read(&options.executable).unwrap(),
        b"new binary fixture"
    );
    let binary_fetches = counting
        .fetches
        .borrow()
        .iter()
        .filter(|n| **n == filename(&options.target))
        .count();
    assert_eq!(binary_fetches, 1);
}
#[test]
fn plan_reports_current_and_errors_as_outcomes() {
    let (_dir, mut options, client, keys) = setup();
    options.current_version = "2.0.0".into();
    let current = plan_with(&options, &client, &keys).unwrap_err();
    assert_eq!((current.status, current.code), (Status::Current, 0));
    options.current_version = "3.0.0".into();
    let error = plan_with(&options, &client, &keys).unwrap_err();
    assert_eq!((error.status, error.code), (Status::Error, 1));
}
#[test]
fn confirmation_required_is_an_error_but_interactive_decline_is_not() {
    let (dir, mut options, client, keys) = setup();
    options.yes = false;
    let before = snapshot(dir.path());
    let out = run_with(&options, &client, &keys, &NativeFileOps);
    assert_eq!(out.status, Status::ConfirmationRequired);
    assert_eq!(out.code, 1);
    assert!(out.stderr.contains("--yes"), "{}", out.stderr);
    let plan = plan_with(&options, &client, &keys).unwrap();
    let out = decline(&plan);
    assert_eq!((out.status, out.code), (Status::Declined, 0));
    assert_eq!(snapshot(dir.path()), before);
}
#[test]
fn an_existing_lock_blocks_upgrade_cleanup_and_recovery() {
    let (_dir, options, client, keys) = setup();
    assert_eq!(
        run_with(&options, &client, &keys, &NativeFileOps).status,
        Status::Updated
    );
    let lock = lock_path(&fs::canonicalize(&options.executable).unwrap());
    fs::write(&lock, b"other process").unwrap();
    let dir = recovery_path(&options.executable);
    let error = cleanup(&options.executable).unwrap_err();
    assert!(error.contains(&lock.display().to_string()), "{error}");
    assert!(dir.join("old-binary").exists());
    let error = recover(&options.executable, true).unwrap_err();
    assert!(error.contains(&lock.display().to_string()), "{error}");
    let next = signed_release("3.0.0", &options.target, b"third binary fixture");
    let mut again = Options::new(options.executable.clone(), "2.0.0");
    again.target = options.target.clone();
    again.yes = true;
    let out = run_with(&again, &next, &keys, &NativeFileOps);
    assert_eq!(out.code, 1);
    assert!(
        out.stderr.contains(&lock.display().to_string()),
        "{}",
        out.stderr
    );
    assert_eq!(
        fs::read(&options.executable).unwrap(),
        b"new binary fixture"
    );
    assert_eq!(fs::read(&lock).unwrap(), b"other process");
    fs::remove_file(&lock).unwrap();
    assert_eq!(
        run_with(&again, &next, &keys, &NativeFileOps).status,
        Status::Updated
    );
    assert!(!lock.exists());
}
#[test]
fn stale_plan_cannot_downgrade_an_installation_updated_after_planning() {
    let (dir, options, client, keys) = setup();
    let stale = plan_with(&options, &client, &keys).unwrap();
    assert_eq!(stale.version().to_string(), "2.0.0");
    let third = signed_release("3.0.0", &options.target, b"third binary fixture");
    let out = run_with(&options, &third, &keys, &NativeFileOps);
    assert_eq!(out.status, Status::Updated, "{}", out.stderr);
    let before = tree(dir.path());
    let out = apply_with(stale, &options, &NativeFileOps);
    assert_eq!(out.status, Status::Error, "{}", out.stdout);
    assert!(
        out.stderr
            .contains("installation changed since the plan; re-run upgrade"),
        "{}",
        out.stderr
    );
    assert_eq!(tree(dir.path()), before, "stale plan must not write");
    assert_eq!(
        fs::read(&options.executable).unwrap(),
        b"third binary fixture"
    );
}
fn tree(dir: &Path) -> BTreeMap<String, Vec<u8>> {
    let mut out = BTreeMap::new();
    for e in fs::read_dir(dir).unwrap() {
        let path = e.unwrap().path();
        if path.is_dir() {
            for (name, bytes) in tree(&path) {
                out.insert(format!("{}/{name}", path.display()), bytes);
            }
        } else {
            out.insert(path.display().to_string(), fs::read(&path).unwrap());
        }
    }
    out
}
