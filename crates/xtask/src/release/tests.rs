use super::*;
use crate::Reply;
use std::fs;
#[test]
fn references_require_a_nonempty_label_without_closing_brackets() {
    for invalid in ["[]: x", "[a][b]: x", "[]:x", "[a][b]:x"] {
        assert!(!reference(invalid), "{invalid}");
    }
    assert!(reference("[a]: x"));
}

#[cfg(unix)]
#[test]
fn release_replaces_files_atomically_and_preserves_permissions() {
    use std::os::unix::fs::{MetadataExt, PermissionsExt};
    let (d, mut f) = fixture("- Change.");
    let path = d.path().join("CHANGELOG.md");
    fs::set_permissions(&path, fs::Permissions::from_mode(0o640)).unwrap();
    let original = fs::File::open(&path).unwrap();
    let before = original.metadata().unwrap();
    prepare(d.path(), "0.17.1", DATE, &mut f).unwrap();
    let after = fs::metadata(&path).unwrap();
    assert_ne!(before.ino(), after.ino());
    assert_eq!(after.permissions().mode() & 0o777, 0o640);
    assert_eq!(original.metadata().unwrap().len(), before.len());
}
const DATE: &str = "2026-10-29";
#[derive(Default)]
struct Fake {
    calls: Vec<Vec<String>>,
    fail_cargo: bool,
}
impl Runner for Fake {
    fn run(&mut self, p: &Path, a: &[String], _: &Path) -> Result<Reply, String> {
        self.calls.push(
            std::iter::once(p.to_string_lossy().into_owned())
                .chain(a.iter().cloned())
                .collect(),
        );
        Ok(Reply {
            code: if self.fail_cargo { 1 } else { 0 },
            out: String::new(),
            err: "cargo failed".into(),
        })
    }
}
fn write(root: &Path, p: &str, s: &str) {
    let p = root.join(p);
    fs::create_dir_all(p.parent().unwrap()).unwrap();
    fs::write(p, s).unwrap();
}
fn manifest(v: &str) -> String {
    format!("[workspace]\nmembers = [\"a\"]\n\n[workspace.package]\nedition = \"2021\"\nversion = \"{v}\"\n\n[workspace.dependencies]\nfoo = {{ version = \"9.9.9\" }}\n")
}
fn log(body: &str) -> String {
    format!("# Changelog\n\n## [Unreleased]\n\n{body}\n\n## [0.17.0] - 2026-10-01\n\n- Past change.\n\n[Unreleased]: https://github.com/salan70/docbridge/compare/v0.17.0...HEAD\n[0.17.0]: https://github.com/salan70/docbridge/releases/tag/v0.17.0\n[0.16.0]: old\n")
}
fn fixture(body: &str) -> (tempfile::TempDir, Fake) {
    let d = tempfile::tempdir().unwrap();
    write(d.path(), "Cargo.toml", &manifest("0.17.0"));
    write(d.path(), "CHANGELOG.md", &log(body));
    (d, Fake::default())
}
fn snapshot(d: &Path) -> Vec<Vec<u8>> {
    ["Cargo.toml", "CHANGELOG.md"]
        .iter()
        .map(|p| fs::read(d.join(p)).unwrap())
        .collect()
}
#[test]
fn release_rolls_changelog_and_sets_workspace_version() {
    let (d, mut f) = fixture("### Fixed\n\n- A fix.");
    assert!(prepare(d.path(), "0.18.0", DATE, &mut f).is_ok());
    assert_eq!(
        read(&d.path().join("Cargo.toml")).unwrap(),
        manifest("0.18.0")
    );
    assert_eq!(
        read(&d.path().join("CHANGELOG.md")).unwrap(),
        "# Changelog\n\n## [Unreleased]\n\n## [0.18.0] - 2026-10-29\n\n### Fixed\n\n- A fix.\n\n## [0.17.0] - 2026-10-01\n\n- Past change.\n\n[Unreleased]: https://github.com/salan70/docbridge/compare/v0.18.0...HEAD\n[0.18.0]: https://github.com/salan70/docbridge/releases/tag/v0.18.0\n[0.17.0]: https://github.com/salan70/docbridge/releases/tag/v0.17.0\n[0.16.0]: old\n"
    );
    assert_eq!(
        f.calls,
        vec![vec!["cargo", "update", "--workspace", "--offline"]]
    );
}
#[test]
fn release_rejects_a_version_already_in_the_changelog_without_writes() {
    let (d, mut f) = fixture("- Change.");
    write(d.path(), "Cargo.toml", &manifest("0.16.0"));
    let before = snapshot(d.path());
    assert!(prepare(d.path(), "0.17.0", DATE, &mut f)
        .unwrap_err()
        .contains("already has"));
    assert_eq!(before, snapshot(d.path()));
    assert!(f.calls.is_empty());
}
#[test]
fn release_rejects_a_version_not_above_the_workspace_version_without_writes() {
    let (d, mut f) = fixture("- Change.");
    let before = snapshot(d.path());
    for v in ["0.17.0", "0.16.5", "0.9.0"] {
        assert!(
            prepare(d.path(), v, DATE, &mut f)
                .unwrap_err()
                .contains("not greater than"),
            "{v}"
        );
    }
    assert_eq!(before, snapshot(d.path()));
    assert!(f.calls.is_empty());
}
#[test]
fn release_compares_versions_numerically() {
    let (d, mut f) = fixture("- Change.");
    write(d.path(), "Cargo.toml", &manifest("0.9.9"));
    prepare(d.path(), "0.10.0", DATE, &mut f).unwrap();
    assert_eq!(
        read(&d.path().join("Cargo.toml")).unwrap(),
        manifest("0.10.0")
    );
}
#[test]
fn release_refuses_empty_unreleased_without_writes() {
    let (d, mut f) = fixture("");
    let before = snapshot(d.path());
    assert!(prepare(d.path(), "0.18.0", DATE, &mut f)
        .unwrap_err()
        .contains("has no entries"));
    assert_eq!(before, snapshot(d.path()));
    assert!(f.calls.is_empty());
}
#[test]
fn release_rejects_invalid_versions_and_dates_before_writes() {
    let (d, mut f) = fixture("- Change.");
    let before = snapshot(d.path());
    for v in [
        "",
        "1.2",
        "1.2.3.4",
        "v1.2.3",
        "1.2.3-beta.1",
        "1.2.3+b",
        "01.2.3",
        "1..3",
        "1.x.3",
    ] {
        assert!(prepare(d.path(), v, DATE, &mut f).is_err(), "{v}");
    }
    for date in [
        "",
        "2026-1-01",
        "26-10-29",
        "2026/10/29",
        "2026-13-01",
        "2026-00-10",
        "2026-10-32",
        "2026-10-00",
        "2026-10-29x",
    ] {
        assert!(prepare(d.path(), "0.18.0", date, &mut f).is_err(), "{date}");
    }
    assert_eq!(before, snapshot(d.path()));
    assert!(f.calls.is_empty());
}
#[test]
fn release_rejects_missing_heading_or_workspace_version_before_writes() {
    for defect in ["missing-heading", "missing-version"] {
        let (d, mut f) = fixture("- Change.");
        match defect {
            "missing-heading" => write(d.path(), "CHANGELOG.md", "# Changelog\n"),
            _ => write(
                d.path(),
                "Cargo.toml",
                "[workspace]\n\n[package]\nversion = \"0.17.0\"\n",
            ),
        }
        let before = snapshot(d.path());
        assert!(
            prepare(d.path(), "0.18.0", DATE, &mut f).is_err(),
            "{defect}"
        );
        assert_eq!(before, snapshot(d.path()));
        assert!(f.calls.is_empty());
    }
}
#[test]
fn cargo_failure_is_reported() {
    let (d, mut f) = fixture("- Change.");
    f.fail_cargo = true;
    assert!(prepare(d.path(), "0.18.0", DATE, &mut f)
        .unwrap_err()
        .contains("cargo failed"));
}
