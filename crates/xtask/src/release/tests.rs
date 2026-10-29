use super::*;
use crate::Reply;
use std::{collections::BTreeMap, fs};
#[test]
fn references_require_a_nonempty_label_without_closing_brackets() {
    for invalid in ["[]: x", "[a][b]: x", "[]:x", "[a][b]:x"] {
        assert!(!reference(invalid), "{invalid}");
    }
    assert!(reference("[a]: x"));
}

#[cfg(unix)]
#[test]
fn bump_replaces_files_atomically_and_preserves_permissions() {
    use std::os::unix::fs::{MetadataExt, PermissionsExt};
    let (d, mut f) = fixture("- Change.");
    let path = d.path().join("CHANGELOG.md");
    fs::set_permissions(&path, fs::Permissions::from_mode(0o640)).unwrap();
    let original = fs::File::open(&path).unwrap();
    let before = original.metadata().unwrap();
    bump(d.path(), "patch", &mut f).unwrap();
    let after = fs::metadata(&path).unwrap();
    assert_ne!(before.ino(), after.ino());
    assert_eq!(after.permissions().mode() & 0o777, 0o640);
    assert_eq!(original.metadata().unwrap().len(), before.len());
}
const MANIFESTS: [&str; 2] = ["crates/docbridge/Cargo.toml", "crates/xtask/Cargo.toml"];
#[derive(Default)]
struct Fake {
    base: BTreeMap<String, String>,
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
        if p == Path::new("git") {
            let s = a
                .get(1)
                .and_then(|s| s.strip_prefix("base:"))
                .and_then(|p| self.base.get(p));
            Ok(Reply {
                code: if s.is_some() { 0 } else { 128 },
                out: s.cloned().unwrap_or_default(),
                err: "missing base file".into(),
            })
        } else {
            Ok(Reply {
                code: if self.fail_cargo { 1 } else { 0 },
                out: String::new(),
                err: "cargo failed".into(),
            })
        }
    }
}
fn write(root: &Path, p: &str, s: &str) {
    let p = root.join(p);
    fs::create_dir_all(p.parent().unwrap()).unwrap();
    fs::write(p, s).unwrap();
}
fn manifest(v: &str) -> String {
    format!("[package]\nname = \"fixture\"\nversion = \"{v}\"\n[dependencies]\nfoo = {{ version = \"9.9.9\" }}\n")
}
fn log(body: &str, released: &str) -> String {
    format!("# Changelog\n\n## [Unreleased]\n\n{body}\n\n{released}\n[Unreleased]: https://github.com/salan70/docbridge/compare/v0.16.0...HEAD\n[0.16.0]: old\n")
}
fn fixture(body: &str) -> (tempfile::TempDir, Fake) {
    let d = tempfile::tempdir().unwrap();
    let mut f = Fake::default();
    for p in MANIFESTS {
        write(d.path(), p, &manifest("0.17.0"));
        f.base.insert(p.into(), manifest("0.17.0"));
    }
    let s = log(body, "");
    write(d.path(), "CHANGELOG.md", &s);
    f.base.insert("CHANGELOG.md".into(), s);
    (d, f)
}
fn check(d: &Path, f: &mut Fake, l: &[&str]) -> Result<String, String> {
    label(
        d,
        "base",
        &l.iter().map(|s| s.to_string()).collect::<Vec<_>>(),
        f,
    )
}
#[test]
fn exactly_one_known_release_label_is_required() {
    let (d, mut f) = fixture("");
    for l in [
        &[][..],
        &["bug"][..],
        &["release: none", "release: patch"][..],
        &["release: huge"][..],
    ] {
        assert!(check(d.path(), &mut f, l).is_err());
    }
    assert!(check(d.path(), &mut f, &[])
        .unwrap_err()
        .contains("Add exactly one release label"));
    assert!(check(d.path(), &mut f, &["bug", "release: none"]).is_ok());
}
#[test]
fn release_none_keeps_versions_and_unreleased_unchanged() {
    let (d, mut f) = fixture("- Pending.");
    assert!(check(d.path(), &mut f, &["release: none"]).is_ok());
    for p in MANIFESTS {
        write(d.path(), p, &manifest("0.17.1"));
        assert!(check(d.path(), &mut f, &["release: none"])
            .unwrap_err()
            .contains(p));
        write(d.path(), p, &manifest("0.17.0"));
    }
    write(d.path(), "CHANGELOG.md", &log("- Different.", ""));
    assert!(check(d.path(), &mut f, &["release: none"])
        .unwrap_err()
        .contains("[Unreleased] must stay unchanged"));
}
#[test]
fn releasing_label_requires_next_version_and_rolled_changelog() {
    let (d, mut f) = fixture("");
    let e = check(d.path(), &mut f, &["release: patch"]).unwrap_err();
    assert!(e.contains("version must be 0.17.1"));
    assert!(e.contains("'## [0.17.1]'"));
    for (k, v) in [("patch", "0.17.1"), ("minor", "0.18.0"), ("major", "1.0.0")] {
        for p in MANIFESTS {
            write(d.path(), p, &manifest(v));
        }
        write(
            d.path(),
            "CHANGELOG.md",
            &log("- Pending.", &format!("## [{v}]\n\n- Fixed.")),
        );
        assert!(check(d.path(), &mut f, &[&format!("release: {k}")])
            .unwrap_err()
            .contains("[Unreleased] must be empty"));
        write(
            d.path(),
            "CHANGELOG.md",
            &log("", &format!("## [{v}]\n\n- Fixed.")),
        );
        assert!(check(d.path(), &mut f, &[&format!("release: {k}")]).is_ok());
    }
}
#[test]
fn cutover_base_uses_legacy_npm_version() {
    let (d, mut f) = fixture("");
    f.base
        .insert("package.json".into(), "{\"version\":\"0.16.0\"}".into());
    write(
        d.path(),
        "CHANGELOG.md",
        &log("", "## [0.17.0]\n\n- Legacy CLI removed."),
    );
    assert!(check(d.path(), &mut f, &["release: minor"]).is_ok());
}
#[test]
fn bump_rolls_changelog_and_every_manifest() {
    let (d, mut f) = fixture("### Fixed\n\n- A fix.");
    assert!(bump(d.path(), "patch", &mut f).is_ok());
    for p in MANIFESTS {
        let s = read(&d.path().join(p)).unwrap();
        assert!(s.contains("version = \"0.17.1\""));
        assert!(s.contains("foo = { version = \"9.9.9\" }"));
    }
    let s = read(&d.path().join("CHANGELOG.md")).unwrap();
    assert!(s.contains("## [Unreleased]\n\n## [0.17.1] - "));
    assert!(s.contains("### Fixed\n\n- A fix.\n\n"));
    assert!(s.contains("compare/v0.17.1...HEAD\n[0.17.1]: https://github.com/salan70/docbridge/releases/tag/v0.17.1\n[0.16.0]:"));
    assert_eq!(
        f.calls,
        vec![vec!["cargo", "update", "--workspace", "--offline"]]
    );
    assert!(check(d.path(), &mut f, &["release: patch"]).is_ok());
}
#[test]
fn bump_refuses_empty_unreleased_without_writes() {
    let (d, mut f) = fixture("");
    let before = read(&d.path().join("CHANGELOG.md")).unwrap();
    assert!(bump(d.path(), "minor", &mut f)
        .unwrap_err()
        .contains("has no entries"));
    assert_eq!(before, read(&d.path().join("CHANGELOG.md")).unwrap());
    for p in MANIFESTS {
        assert!(read(&d.path().join(p))
            .unwrap()
            .contains("version = \"0.17.0\""));
    }
    assert!(f.calls.is_empty());
    assert!(bump(d.path(), "build", &mut f).is_err());
}
#[test]
fn malformed_last_manifest_refuses_before_any_write() {
    let (d, mut f) = fixture("- Change.");
    write(d.path(), MANIFESTS[1], "[package]\nname = \"bad\"\n");
    let before = read(&d.path().join("CHANGELOG.md")).unwrap();
    assert!(bump(d.path(), "patch", &mut f).is_err());
    assert_eq!(before, read(&d.path().join("CHANGELOG.md")).unwrap());
    assert!(f.calls.is_empty());
}
#[test]
fn cargo_failure_is_reported() {
    let (d, mut f) = fixture("- Change.");
    f.fail_cargo = true;
    assert!(bump(d.path(), "patch", &mut f)
        .unwrap_err()
        .contains("cargo failed"));
}
#[test]
fn utc_dates_cover_epoch_leap_day_and_year_boundary() {
    assert_eq!(date_from_days(0), "1970-01-01");
    assert_eq!(date_from_days(11016), "2000-02-29");
    assert_eq!(date_from_days(20453), "2025-12-31");
    assert_eq!(date_from_days(20454), "2026-01-01");
}
#[test]
fn bump_rejects_missing_heading_invalid_versions_and_mismatched_manifests_before_writes() {
    for defect in ["missing-heading", "invalid-version", "mismatch"] {
        let (d, mut f) = fixture("- Change.");
        match defect {
            "missing-heading" => write(d.path(), "CHANGELOG.md", "# Changelog\n"),
            "invalid-version" => {
                for p in MANIFESTS {
                    write(d.path(), p, &manifest("1.2.3-beta.1"));
                }
            }
            _ => write(d.path(), MANIFESTS[1], &manifest("0.18.0")),
        }
        let before = MANIFESTS
            .iter()
            .chain(std::iter::once(&"CHANGELOG.md"))
            .map(|p| (*p, fs::read(d.path().join(p)).unwrap()))
            .collect::<Vec<_>>();
        assert!(bump(d.path(), "patch", &mut f).is_err(), "{defect}");
        for (p, bytes) in before {
            assert_eq!(fs::read(d.path().join(p)).unwrap(), bytes);
        }
        assert!(f.calls.is_empty());
    }
}
