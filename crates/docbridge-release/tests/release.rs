//! Signing produces exactly what `docbridge-update` accepts, and tampering is rejected
//! by the real upgrade verifier. All keys here are deterministic test-only keys.
use docbridge_release::*;
use docbridge_update::{filename, TrustedKeys, TARGETS};
use ed25519_dalek::{Signer, SigningKey};
use std::{
    collections::BTreeMap,
    fs,
    path::{Path, PathBuf},
    process::Command,
};

const VERSION: &str = "1.2.3";
const KEY_ID: &str = "test-only-2026";
const SEED_HEX: &str = "2a2a2a2a2a2a2a2a2a2a2a2a2a2a2a2a2a2a2a2a2a2a2a2a2a2a2a2a2a2a2a2a";

fn key() -> SigningKey {
    SigningKey::from_bytes(&[42; 32])
}
fn keys() -> TrustedKeys {
    TrustedKeys::from([(KEY_ID.into(), key().verifying_key().to_bytes())])
}
fn artifacts(root: &Path) -> PathBuf {
    let dir = root.join("artifacts");
    fs::create_dir(&dir).unwrap();
    for target in TARGETS {
        fs::write(dir.join(filename(target)), format!("binary for {target}")).unwrap();
    }
    dir
}
fn signed() -> (tempfile::TempDir, PathBuf) {
    let root = tempfile::tempdir().unwrap();
    let artifacts = artifacts(root.path());
    let out = root.path().join("release");
    sign_release(&SignRequest {
        version: VERSION,
        key_id: KEY_ID,
        key: &key(),
        artifacts: &artifacts,
        out: &out,
    })
    .unwrap();
    (root, out)
}
/// SHA256SUMS is unsigned, so an attacker can always regenerate it; rewriting it
/// leaves only the signed manifest to catch tampering.
fn rewrite_sums(dir: &Path) {
    let files: BTreeMap<String, Vec<u8>> = asset_names()
        .into_iter()
        .filter(|n| n != SUMS)
        .map(|n| {
            let bytes = fs::read(dir.join(&n)).unwrap();
            (n, bytes)
        })
        .collect();
    fs::write(dir.join(SUMS), sums_bytes(&files)).unwrap();
}
fn resign(dir: &Path, manifest: Vec<u8>, signer: &SigningKey) {
    fs::write(dir.join(SIGNATURE), signer.sign(&manifest).to_bytes()).unwrap();
    fs::write(dir.join(MANIFEST), manifest).unwrap();
    rewrite_sums(dir);
}
fn genuine_hashes(dir: &Path) -> Vec<(&'static str, String)> {
    TARGETS
        .iter()
        .map(|t| (*t, sha256_hex(&fs::read(dir.join(filename(t))).unwrap())))
        .collect()
}
fn rejected(dir: &Path, version: &str, keys: &TrustedKeys, expected: &str) {
    let err = verify_release(dir, version, keys).expect_err(expected);
    assert!(err.contains(expected), "expected {expected:?} in {err}");
}

#[test]
fn genuine_asset_set_verifies_for_every_target() {
    let (_root, out) = signed();
    let names: Vec<String> = fs::read_dir(&out)
        .unwrap()
        .map(|e| e.unwrap().file_name().into_string().unwrap())
        .collect();
    assert_eq!(names.len(), asset_names().len());
    assert_eq!(fs::read(out.join(SIGNATURE)).unwrap().len(), 64);
    let lines = verify_release(&out, VERSION, &keys()).unwrap();
    assert_eq!(lines.len(), TARGETS.len());
    let manifest: serde_json::Value =
        serde_json::from_slice(&fs::read(out.join(MANIFEST)).unwrap()).unwrap();
    assert_eq!(manifest["schema"], 1);
    assert_eq!(manifest["version"], VERSION);
    assert_eq!(manifest["key_id"], KEY_ID);
    assert_eq!(manifest["assets"].as_array().unwrap().len(), TARGETS.len());
    let sums = fs::read_to_string(out.join(SUMS)).unwrap();
    assert_eq!(sums.lines().count(), asset_names().len() - 1);
}

#[test]
fn tampered_binary_is_rejected_by_the_signed_checksum() {
    let (_root, out) = signed();
    fs::write(out.join(filename(TARGETS[3])), b"tampered").unwrap();
    rejected(&out, VERSION, &keys(), "SHA256SUMS mismatch");
    rewrite_sums(&out);
    rejected(&out, VERSION, &keys(), "checksum mismatch");
}

#[test]
fn binaries_swapped_between_targets_are_rejected() {
    let (_root, out) = signed();
    let (a, b) = (
        out.join(filename(TARGETS[0])),
        out.join(filename(TARGETS[2])),
    );
    let (bytes_a, bytes_b) = (fs::read(&a).unwrap(), fs::read(&b).unwrap());
    fs::write(&a, bytes_b).unwrap();
    fs::write(&b, bytes_a).unwrap();
    rewrite_sums(&out);
    rejected(&out, VERSION, &keys(), "checksum mismatch");
}

#[test]
fn tampered_manifest_is_rejected_by_the_signature() {
    let (_root, out) = signed();
    // Point the Linux x64 entry at a tampered binary: still valid JSON, but unsigned.
    let tampered = b"tampered";
    let target = filename(TARGETS[3]);
    let genuine = sha256_hex(&fs::read(out.join(&target)).unwrap());
    let manifest = fs::read_to_string(out.join(MANIFEST)).unwrap();
    assert!(manifest.contains(&genuine));
    fs::write(
        out.join(MANIFEST),
        manifest.replace(&genuine, &sha256_hex(tampered)),
    )
    .unwrap();
    fs::write(out.join(target), tampered).unwrap();
    rewrite_sums(&out);
    rejected(&out, VERSION, &keys(), "signature verification failed");
}

#[test]
fn signature_from_another_key_is_rejected() {
    let (_root, out) = signed();
    let manifest = fs::read(out.join(MANIFEST)).unwrap();
    resign(&out, manifest, &SigningKey::from_bytes(&[7; 32]));
    rejected(&out, VERSION, &keys(), "signature verification failed");
}

#[test]
fn unknown_key_id_is_rejected() {
    let (_root, out) = signed();
    let other = TrustedKeys::from([("other-key".into(), key().verifying_key().to_bytes())]);
    rejected(&out, VERSION, &other, "unknown signing key");
    // Production trust is pending, so the compiled key set accepts nothing yet.
    rejected(
        &out,
        VERSION,
        &docbridge_update::compiled_trusted_keys(),
        "unknown signing key",
    );
}

#[test]
fn key_rotation_accepts_either_compiled_key() {
    let (_root, out) = signed();
    let mut rotated = keys();
    rotated.insert(
        "next-key".into(),
        SigningKey::from_bytes(&[9; 32]).verifying_key().to_bytes(),
    );
    verify_release(&out, VERSION, &rotated).unwrap();
    let hashes = genuine_hashes(&out);
    let manifest = manifest_bytes(VERSION, "next-key", &hashes);
    resign(&out, manifest, &SigningKey::from_bytes(&[9; 32]));
    verify_release(&out, VERSION, &rotated).unwrap();
    rejected(&out, VERSION, &keys(), "unknown signing key");
}

#[test]
fn wrong_version_is_rejected() {
    let (_root, out) = signed();
    // Selected tag differs from the signed version.
    rejected(&out, "1.2.4", &keys(), "version/tag mismatch");
    // A manifest signed for another version under the genuine tag.
    let manifest = manifest_bytes("1.2.4", KEY_ID, &genuine_hashes(&out));
    resign(&out, manifest, &key());
    rejected(&out, VERSION, &keys(), "version/tag mismatch");
    // Non-release versions are refused before any verification.
    rejected(&out, "v1.2.3", &keys(), "invalid release version");
    rejected(&out, "1.2.3-rc.1", &keys(), "canonical X.Y.Z");
}

#[test]
fn wrong_or_missing_target_is_rejected() {
    let (_root, out) = signed();
    let mut hashes = genuine_hashes(&out);
    hashes.pop();
    resign(&out, manifest_bytes(VERSION, KEY_ID, &hashes), &key());
    rejected(&out, VERSION, &keys(), "signed target missing");

    let (_root, out) = signed();
    let mut manifest: serde_json::Value =
        serde_json::from_slice(&fs::read(out.join(MANIFEST)).unwrap()).unwrap();
    manifest["assets"][0]["filename"] = filename(TARGETS[1]).into();
    resign(&out, serde_json::to_vec(&manifest).unwrap(), &key());
    rejected(&out, VERSION, &keys(), "invalid signed target/filename");
}

#[test]
fn missing_or_invalid_signature_is_rejected() {
    let (_root, out) = signed();
    fs::write(out.join(SIGNATURE), b"").unwrap();
    rewrite_sums(&out);
    rejected(&out, VERSION, &keys(), "invalid signature");

    let (_root, out) = signed();
    fs::remove_file(out.join(SIGNATURE)).unwrap();
    rejected(&out, VERSION, &keys(), "missing: [docbridge-manifest.sig]");
}

#[test]
fn incomplete_or_padded_asset_sets_are_rejected() {
    let (_root, out) = signed();
    fs::remove_file(out.join(filename(TARGETS[4]))).unwrap();
    rejected(
        &out,
        VERSION,
        &keys(),
        "missing: [docbridge-x86_64-pc-windows-msvc.exe]",
    );

    let (_root, out) = signed();
    fs::write(out.join("extra.txt"), b"x").unwrap();
    rejected(&out, VERSION, &keys(), "unexpected: [extra.txt]");
}

#[test]
fn signing_refuses_incomplete_inputs_and_existing_output() {
    let root = tempfile::tempdir().unwrap();
    let artifacts = artifacts(root.path());
    let request = |out: &Path, version: &'static str, key_id: &'static str| {
        sign_release(&SignRequest {
            version,
            key_id,
            key: &key(),
            artifacts: &artifacts,
            out,
        })
    };
    let existing = root.path().join("existing");
    fs::create_dir(&existing).unwrap();
    assert!(request(&existing, VERSION, KEY_ID).is_err());
    assert!(request(&root.path().join("a"), "1.2.3-rc.1", KEY_ID).is_err());
    assert!(request(&root.path().join("b"), "1.2.3+build", KEY_ID).is_err());
    assert!(request(&root.path().join("c"), VERSION, "bad id/with slash").is_err());
    fs::remove_file(artifacts.join(filename(TARGETS[0]))).unwrap();
    let err = request(&root.path().join("d"), VERSION, KEY_ID).unwrap_err();
    assert!(
        err.contains("missing: [docbridge-aarch64-apple-darwin]"),
        "{err}"
    );
    assert!(!root.path().join("d").exists());
}

#[test]
fn signing_key_parsing_is_strict() {
    let parsed = parse_signing_key(format!("{SEED_HEX}\n").into_bytes()).unwrap();
    assert_eq!(parsed.to_bytes(), key().to_bytes());
    assert!(parse_signing_key(SEED_HEX[..62].as_bytes().to_vec()).is_err());
    assert!(parse_signing_key(b"zz".repeat(32)).is_err());
    assert!(parse_public_key(&public_key_hex(&key())).is_ok());
    assert!(parse_public_key("00").is_err());
}

fn cli(args: &[&str], env: &[(&str, &str)]) -> std::process::Output {
    let mut command = Command::new(env!("CARGO_BIN_EXE_docbridge-release"));
    command.args(args).env_remove("DOCBRIDGE_TEST_SIGNING_KEY");
    for (k, v) in env {
        command.env(k, v);
    }
    command.output().unwrap()
}

#[test]
fn cli_signs_from_env_and_file_and_verifies_with_public_key() {
    let root = tempfile::tempdir().unwrap();
    let artifacts = artifacts(root.path());
    let out = root.path().join("release");
    let (a, o) = (artifacts.to_str().unwrap(), out.to_str().unwrap());
    let env = [("DOCBRIDGE_TEST_SIGNING_KEY", SEED_HEX)];
    let sign = [
        "sign",
        "--version",
        VERSION,
        "--artifacts",
        a,
        "--out",
        o,
        "--key-id",
        KEY_ID,
        "--key-env",
        "DOCBRIDGE_TEST_SIGNING_KEY",
    ];
    let result = cli(&sign, &env);
    assert!(result.status.success(), "{result:?}");

    let public = cli(
        &["public-key", "--key-env", "DOCBRIDGE_TEST_SIGNING_KEY"],
        &env,
    );
    let public = String::from_utf8(public.stdout).unwrap();
    assert_eq!(public.trim(), public_key_hex(&key()));
    let verify = [
        "verify",
        "--dir",
        o,
        "--version",
        VERSION,
        "--key-id",
        KEY_ID,
        "--public-key",
        public.trim(),
    ];
    let result = cli(&verify, &[]);
    assert!(result.status.success(), "{result:?}");
    let stdout = String::from_utf8(result.stdout).unwrap();
    assert_eq!(stdout.lines().count(), 1 + TARGETS.len(), "{stdout}");

    // Production trust is pending: the compiled key set fails closed.
    let result = cli(
        &[
            "verify",
            "--dir",
            o,
            "--version",
            VERSION,
            "--compiled-keys",
        ],
        &[],
    );
    assert!(!result.status.success());
    assert!(String::from_utf8_lossy(&result.stderr).contains("unknown signing key"));

    let key_file = root.path().join("key.hex");
    fs::write(&key_file, SEED_HEX).unwrap();
    let out2 = root.path().join("release2");
    let mut sign_file = sign;
    sign_file[6] = out2.to_str().unwrap();
    sign_file[9] = "--key-file";
    sign_file[10] = key_file.to_str().unwrap();
    let result = cli(&sign_file, &[]);
    assert!(result.status.success(), "{result:?}");
    assert_eq!(
        fs::read(out.join(SIGNATURE)).unwrap(),
        fs::read(out2.join(SIGNATURE)).unwrap()
    );
}

#[test]
fn cli_fails_closed_without_a_key_and_never_takes_one_from_argv() {
    let root = tempfile::tempdir().unwrap();
    let artifacts = artifacts(root.path());
    let out = root.path().join("release");
    let (a, o) = (artifacts.to_str().unwrap(), out.to_str().unwrap());
    let base = [
        "sign",
        "--version",
        VERSION,
        "--artifacts",
        a,
        "--out",
        o,
        "--key-id",
        KEY_ID,
    ];
    for (extra, env) in [
        (&["--key-env", "DOCBRIDGE_TEST_SIGNING_KEY"][..], &[][..]),
        (
            &["--key-env", "DOCBRIDGE_TEST_SIGNING_KEY"][..],
            &[("DOCBRIDGE_TEST_SIGNING_KEY", " ")][..],
        ),
        (&["--key-file", "/nonexistent/key.hex"][..], &[][..]),
        (&["--key", SEED_HEX][..], &[][..]),
        (&[][..], &[][..]),
    ] {
        let args: Vec<&str> = base.iter().chain(extra).copied().collect();
        let result = cli(&args, env);
        assert!(!result.status.success(), "{extra:?}");
        assert!(!out.exists(), "{extra:?} must not write assets");
    }
}

#[test]
fn cli_lists_only_compiled_key_ids() {
    let result = cli(&["trusted-keys"], &[]);
    assert!(result.status.success(), "{result:?}");
    let stdout = String::from_utf8(result.stdout).unwrap();
    let ids: Vec<&str> = stdout.lines().collect();
    let compiled = docbridge_update::compiled_trusted_keys();
    assert_eq!(ids, compiled.keys().map(String::as_str).collect::<Vec<_>>());
    assert!(!ids.contains(&KEY_ID));
}

/// Every deterministic seed used by the release and update tests is a registered
/// fixture, so `docbridge_update` refuses its public key as a production key.
#[test]
fn every_test_seed_is_a_registered_fixture() {
    let crates = Path::new(env!("CARGO_MANIFEST_DIR")).parent().unwrap();
    // Built at runtime so this test's own source does not match.
    let needle = ["from_bytes(&", "["].concat();
    let mut seeds = Vec::new();
    for dir in ["docbridge-release/tests", "docbridge-update/tests"] {
        for entry in fs::read_dir(crates.join(dir)).unwrap() {
            let text = fs::read_to_string(entry.unwrap().path()).unwrap();
            for part in text.split(needle.as_str()).skip(1) {
                let (byte, rest) = part.split_once(';').unwrap();
                assert!(rest.trim_start().starts_with("32]"), "{part}");
                seeds.push([byte.trim().parse::<u8>().unwrap(); 32]);
            }
        }
    }
    let seed_bytes = hex::decode(SEED_HEX).unwrap();
    seeds.push(seed_bytes.try_into().unwrap());
    assert!(seeds.len() >= 4);
    for seed in seeds {
        assert!(
            docbridge_update::TEST_FIXTURE_SEEDS.contains(&seed),
            "{seed:?}"
        );
        let public = SigningKey::from_bytes(&seed).verifying_key().to_bytes();
        assert!(docbridge_update::is_test_fixture_key(&public));
        assert!(!docbridge_update::compiled_trusted_keys()
            .values()
            .any(|k| k == &public));
    }
}
