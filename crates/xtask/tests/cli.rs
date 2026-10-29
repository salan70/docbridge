#[test]
fn invalid_usage_exits_two() {
    for args in [
        vec![],
        vec!["unknown"],
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
