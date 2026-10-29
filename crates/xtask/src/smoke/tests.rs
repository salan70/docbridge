use super::*;
use crate::Reply;
struct Fake {
    calls: Vec<Vec<String>>,
    fail: Option<usize>,
    corrupt: Option<usize>,
    seen_bin: PathBuf,
    scratch: PathBuf,
}
impl Runner for Fake {
    fn run(&mut self, p: &Path, a: &[String], cwd: &Path) -> Result<Reply, String> {
        self.seen_bin = p.into();
        self.scratch = cwd.into();
        let n = self.calls.len();
        self.calls.push(a.to_vec());
        let root = cwd.join("project");
        assert!(read(&root.join("src/main.rs")).unwrap().contains("fn main"));
        assert!(read(&root.join("src/extra.rs")).unwrap().contains("unused"));
        let config: serde_json::Value =
            serde_json::from_str(&read(&root.join("docbridge.config.json")).unwrap()).unwrap();
        assert!(config.get("include").is_some());
        if n == 7 {
            assert!(read(&root.join("docs/design.md"))
                .unwrap()
                .contains("src/missing.rs"));
        }
        let (code, out, err) = match n {
            0 => (0, "", ""),
            1 => (0, "getting-started", ""),
            2 => (3, "", ""),
            3 => (0, "", ""),
            4 => (0, "{\"edges\":[]}", ""),
            5 => (0, "The program starts here.", ""),
            6 => (0, "src/extra.rs", ""),
            7 => (1, "", ""),
            _ => panic!("unexpected command"),
        };
        Ok(Reply {
            code: if self.fail == Some(n) { 99 } else { code },
            out: if self.corrupt == Some(n) {
                "invalid".into()
            } else {
                out.into()
            },
            err: if self.corrupt == Some(n) {
                "invalid".into()
            } else {
                err.into()
            },
        })
    }
}
fn fake() -> Fake {
    Fake {
        calls: vec![],
        fail: None,
        corrupt: None,
        seen_bin: PathBuf::new(),
        scratch: PathBuf::new(),
    }
}
#[cfg(unix)]
#[test]
fn smoke_rejects_a_validate_process_killed_by_signal() {
    struct Signaled(Fake);
    impl Runner for Signaled {
        fn run(&mut self, p: &Path, a: &[String], cwd: &Path) -> Result<Reply, String> {
            if self.0.calls.len() == 7 {
                return crate::System.run(
                    Path::new("/bin/sh"),
                    &["-c".into(), "kill -TERM $$".into()],
                    cwd,
                );
            }
            self.0.run(p, a, cwd)
        }
    }
    let d = tempfile::tempdir().unwrap();
    let error = check(&d.path().join("docbridge"), &mut Signaled(fake())).unwrap_err();
    assert!(error.contains("expected exit 1"), "{error}");
}
fn mark_executable(path: &Path) {
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        fs::set_permissions(path, fs::Permissions::from_mode(0o755)).unwrap();
    }
    #[cfg(windows)]
    {
        assert!(path.is_file());
    }
}
#[test]
fn smoke_preserves_exit_content_json_and_cleanup_contracts() {
    let d = tempfile::tempdir().unwrap();
    let bin = d.path().join("docbridge");
    fs::write(&bin, "").unwrap();
    let mut f = fake();
    assert!(check(&bin, &mut f).is_ok());
    assert_eq!(f.calls.len(), 8);
    assert_eq!(f.calls[0], ["--help"]);
    assert_eq!(f.calls[1], ["docs", "list"]);
    assert_eq!(f.calls[2], ["docs", "show", "no-such-guide"]);
    assert!(!f.scratch.exists());
}
#[test]
fn smoke_rejects_each_wrong_exit_and_missing_output() {
    let d = tempfile::tempdir().unwrap();
    let bin = d.path().join("docbridge");
    for n in 0..8 {
        let mut f = fake();
        f.fail = Some(n);
        assert!(check(&bin, &mut f).unwrap_err().contains("expected exit"));
        assert!(!f.scratch.exists());
    }
    for n in [1, 4, 5, 6] {
        let mut f = fake();
        f.corrupt = Some(n);
        assert!(check(&bin, &mut f).is_err());
        assert!(!f.scratch.exists());
    }
}
#[test]
fn smoke_resolves_windows_executable_suffix() {
    let d = tempfile::tempdir().unwrap();
    let bin = d.path().join("docbridge");
    let exe = d.path().join("docbridge.exe");
    fs::write(&exe, "").unwrap();
    mark_executable(&exe);
    let mut f = fake();
    check(&bin, &mut f).unwrap();
    assert_eq!(f.seen_bin, exe);
}
#[cfg(unix)]
#[test]
fn smoke_uses_exe_when_unsuffixed_file_is_not_executable() {
    let d = tempfile::tempdir().unwrap();
    let bin = d.path().join("docbridge");
    let exe = d.path().join("docbridge.exe");
    fs::write(&bin, "not executable").unwrap();
    fs::write(&exe, "").unwrap();
    mark_executable(&exe);
    let mut f = fake();
    check(&bin, &mut f).unwrap();
    assert_eq!(f.seen_bin, exe);
}
