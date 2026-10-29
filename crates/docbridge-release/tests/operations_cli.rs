use std::{fs, process::Command};

#[test]
fn maintenance_usage_errors_exit_two() {
    for args in [
        vec!["tag"],
        vec!["keygen"],
        vec!["dry-run"],
        vec!["dry-run", "--unknown", "value"],
        vec![
            "dry-run",
            "--artifacts",
            "unused",
            "--out",
            "unused",
            "--version",
            "bad",
        ],
    ] {
        let out = Command::new(env!("CARGO_BIN_EXE_docbridge-release"))
            .args(args)
            .env("PATH", "")
            .output()
            .unwrap();
        assert_eq!(out.status.code(), Some(2), "{out:?}");
    }
}

#[test]
fn dry_run_uses_the_upgrade_verifier_and_rejects_checksum_substitution() {
    let root = tempfile::tempdir().unwrap();
    let artifacts = root.path().join("artifacts");
    fs::create_dir(&artifacts).unwrap();
    for name in docbridge_release::executable_names() {
        fs::write(artifacts.join(&name), format!("fixture executable {name}")).unwrap();
    }
    let out = Command::new(env!("CARGO_BIN_EXE_docbridge-release"))
        .args(["dry-run", "--artifacts"])
        .arg(&artifacts)
        .arg("--out")
        .arg(root.path().join("signed"))
        .args(["--version", "1.2.3"])
        .output()
        .unwrap();
    assert!(out.status.success(), "{out:?}");
    let stdout = String::from_utf8(out.stdout).unwrap();
    assert!(stdout.contains("unknown signing key"), "{stdout}");
    assert!(stdout.contains("checksum mismatch"), "{stdout}");
    assert_eq!(fs::read_dir(root.path().join("signed")).unwrap().count(), 8);
}

#[test]
fn tag_rejects_invalid_inputs_before_invoking_external_commands() {
    for args in [
        [
            "tag",
            "check",
            "v1.2.3",
            "0123456789abcdef0123456789abcdef01234567",
        ],
        ["tag", "ensure", "1.2.3", "HEAD"],
    ] {
        let out = Command::new(env!("CARGO_BIN_EXE_docbridge-release"))
            .args(args)
            .env("PATH", "")
            .output()
            .unwrap();
        assert_eq!(out.status.code(), Some(2));
        let err = String::from_utf8(out.stderr).unwrap();
        assert!(err.contains("version") || err.contains("SHA"), "{err}");
        assert!(!err.contains("spawn"), "{err}");
    }
}

#[cfg(unix)]
#[test]
fn backup_cli_ignores_shell_tracing_and_never_prints_the_private_seed() {
    use std::os::unix::fs::PermissionsExt;
    for (name, value) in [("SHELLOPTS", "xtrace"), ("BASH_XTRACEFD", "2")] {
        let root = tempfile::tempdir_in(std::env::temp_dir().canonicalize().unwrap()).unwrap();
        fs::set_permissions(root.path(), fs::Permissions::from_mode(0o700)).unwrap();
        let keys = root
            .path()
            .join("crates/docbridge-update/keys/trusted-keys.txt");
        fs::create_dir_all(keys.parent().unwrap()).unwrap();
        fs::write(&keys, "# fixture keys\n").unwrap();
        let backup = root.path().join("fixture.key");
        let out = Command::new(env!("CARGO_BIN_EXE_docbridge-release"))
            .args([
                "keygen",
                "--role",
                "backup",
                "--key-id",
                "fixture-backup",
                "--root",
            ])
            .arg(root.path())
            .arg("--backup-out")
            .arg(&backup)
            .env(name, value)
            .env("PATH", "")
            .output()
            .unwrap();
        assert!(out.status.success(), "{out:?}");
        let seed = fs::read_to_string(&backup).unwrap();
        let key = docbridge_release::parse_signing_key(seed.as_bytes().to_vec()).unwrap();
        assert!(fs::read_to_string(keys)
            .unwrap()
            .contains(&docbridge_release::public_key_hex(&key)));
        assert!(!String::from_utf8(out.stdout).unwrap().contains(seed.trim()));
        assert!(!String::from_utf8(out.stderr).unwrap().contains(seed.trim()));
    }
}

#[test]
fn malformed_keygen_options_never_mutate_the_fixture_checkout() {
    let root = tempfile::tempdir().unwrap();
    let keys = root
        .path()
        .join("crates/docbridge-update/keys/trusted-keys.txt");
    fs::create_dir_all(keys.parent().unwrap()).unwrap();
    fs::write(&keys, "# fixture keys\n").unwrap();
    for args in [
        vec!["--role", "activate", "--key-id", "fixture"],
        vec!["--activate", "--role", "primary", "--key-id", "fixture"],
        vec![
            "--role",
            "primary",
            "--key-id",
            "fixture",
            "--backup-out",
            "backup",
        ],
        vec!["--role", "backup", "--key-id", "fixture"],
        vec!["--activate", "--activate", "--key-id", "fixture"],
        vec!["--role", "primary", "--key-id", "invalid/id"],
    ] {
        let out = Command::new(env!("CARGO_BIN_EXE_docbridge-release"))
            .arg("keygen")
            .args(args)
            .arg("--root")
            .arg(root.path())
            .env("PATH", "")
            .stdin(std::process::Stdio::null())
            .output()
            .unwrap();
        assert_eq!(out.status.code(), Some(2), "{out:?}");
        assert_eq!(fs::read_to_string(&keys).unwrap(), "# fixture keys\n");
    }
}

#[cfg(unix)]
#[test]
fn nonsecret_query_and_mutation_failures_keep_bounded_child_diagnostics() {
    use std::os::unix::fs::PermissionsExt;
    for failing_program in ["git", "gh"] {
        let root = tempfile::tempdir().unwrap();
        for program in ["git", "gh"] {
            let stub = root.path().join(program);
            let script = if program == failing_program {
                "#!/bin/sh\nprintf 'fixture diagnostic: ' >&2\ni=0\nwhile [ \"$i\" -lt 5000 ]; do printf x >&2; i=$((i+1)); done\nprintf 'TRUNCATED-TAIL' >&2\nexit 1\n"
            } else {
                "#!/bin/sh\nexit 2\n"
            };
            fs::write(&stub, script).unwrap();
            fs::set_permissions(&stub, fs::Permissions::from_mode(0o700)).unwrap();
        }
        let out = Command::new(env!("CARGO_BIN_EXE_docbridge-release"))
            .args([
                "tag",
                "ensure",
                "1.2.3",
                "0123456789abcdef0123456789abcdef01234567",
            ])
            .env("PATH", root.path())
            .env("GITHUB_REPOSITORY", "fixture/repo")
            .output()
            .unwrap();
        assert_eq!(out.status.code(), Some(1));
        let stderr = String::from_utf8(out.stderr).unwrap();
        assert!(stderr.contains("fixture diagnostic: "), "{stderr}");
        assert!(!stderr.contains("TRUNCATED-TAIL"));
        assert!(stderr.len() < 4352);
    }
}

#[cfg(unix)]
#[test]
fn real_secret_upload_redacts_echoed_seed_and_preserves_public_entry() {
    use std::os::unix::fs::PermissionsExt;
    let root = tempfile::tempdir_in(std::env::temp_dir().canonicalize().unwrap()).unwrap();
    fs::set_permissions(root.path(), fs::Permissions::from_mode(0o700)).unwrap();
    let keys = root
        .path()
        .join("crates/docbridge-update/keys/trusted-keys.txt");
    fs::create_dir_all(keys.parent().unwrap()).unwrap();
    fs::write(&keys, "# fixture\n").unwrap();
    let bin = root.path().join("bin");
    fs::create_dir(&bin).unwrap();
    let gh = bin.join("gh");
    fs::write(&gh, "#!/bin/sh\nprintf '%s\\n' \"$@\" >> \"$FIXTURE_ARGV\"\nif [ \"$2\" = list ]; then echo query-diagnostic >&2; exit 0; fi\nIFS= read -r seed || :\nprintf '%s' \"$seed\" > \"$FIXTURE_SEED\"\nprintf '%s' \"$seed\"\nprintf '%s' \"$seed\" >&2\nexit 1\n").unwrap();
    fs::set_permissions(&gh, fs::Permissions::from_mode(0o700)).unwrap();
    let seed_path = root.path().join("uploaded");
    let argv_path = root.path().join("argv");
    let out = Command::new(env!("CARGO_BIN_EXE_docbridge-release"))
        .args([
            "keygen", "--role", "primary", "--key-id", "fixture", "--root",
        ])
        .arg(root.path())
        .env("PATH", &bin)
        .env("FIXTURE_SEED", &seed_path)
        .env("FIXTURE_ARGV", &argv_path)
        .output()
        .unwrap();
    assert_eq!(out.status.code(), Some(1));
    let seed = fs::read_to_string(seed_path).unwrap();
    let key = docbridge_release::parse_signing_key(seed.as_bytes().to_vec()).unwrap();
    assert!(fs::read_to_string(keys).unwrap().contains(&format!(
        "fixture {}",
        docbridge_release::public_key_hex(&key)
    )));
    assert!(String::from_utf8_lossy(&out.stderr).contains("query-diagnostic"));
    for text in [
        String::from_utf8(out.stdout).unwrap(),
        String::from_utf8(out.stderr).unwrap(),
        fs::read_to_string(argv_path).unwrap(),
    ] {
        assert!(!text.contains(&seed));
    }
}
