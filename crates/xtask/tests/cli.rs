#[test]
fn invalid_usage_exits_two() {
    for args in [
        vec![],
        vec!["unknown"],
        vec!["agent-gate", "a", "b"],
        vec!["publisher-gate"],
        vec!["smoke"],
        vec!["release"],
        vec!["release", "0.18.0"],
        vec!["release", "0.18.0", "2026-10-29", "extra"],
    ] {
        let out = std::process::Command::new(env!("CARGO_BIN_EXE_xtask"))
            .args(&args)
            .output()
            .unwrap();
        assert_eq!(out.status.code(), Some(2), "{args:?}: {out:?}");
    }
}
#[test]
fn gate_failures_exit_one_with_diagnostics() {
    let dir = tempfile::tempdir().unwrap();
    for command in ["agent-gate", "publisher-gate"] {
        let out = std::process::Command::new(env!("CARGO_BIN_EXE_xtask"))
            .arg(command)
            .arg(dir.path().join("missing"))
            .output()
            .unwrap();
        assert_eq!(out.status.code(), Some(1));
        assert!(!out.stderr.is_empty());
        assert!(out.stdout.is_empty());
    }
}
#[test]
fn publisher_gate_accepts_clean_directory() {
    let dir = tempfile::tempdir().unwrap();
    let out = std::process::Command::new(env!("CARGO_BIN_EXE_xtask"))
        .arg("publisher-gate")
        .arg(dir.path())
        .output()
        .unwrap();
    assert!(out.status.success(), "{out:?}");
}
