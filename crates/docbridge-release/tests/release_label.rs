//! `scripts/check-release-label.sh` and `scripts/release-bump.sh`, run on a
//! scratch checkout with stubbed `git` and `cargo`. Nothing touches the network.
#![cfg(unix)]
use std::{
    fs,
    os::unix::fs::PermissionsExt,
    path::{Path, PathBuf},
    process::{Command, Output},
};

const MANIFESTS: [&str; 3] = [
    "crates/docbridge/Cargo.toml",
    "crates/docbridge-update/Cargo.toml",
    "crates/docbridge-release/Cargo.toml",
];

fn repo() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR")).join("../..")
}
fn executable(path: &Path, body: &str) {
    fs::write(path, format!("#!/usr/bin/env bash\n{body}")).unwrap();
    fs::set_permissions(path, fs::Permissions::from_mode(0o755)).unwrap();
}
fn manifest(version: &str) -> String {
    format!("[package]\nname = \"x\"\nversion = \"{version}\"\nedition = \"2021\"\n\n[dependencies]\nfoo = {{ version = \"9.9.9\" }}\n")
}
fn changelog(unreleased: &str, released: &[(&str, &str)]) -> String {
    let mut out = format!("# Changelog\n\n## [Unreleased]\n{unreleased}\n");
    for (version, body) in released {
        out.push_str(&format!("## [{version}] - 2026-01-01\n\n{body}\n\n"));
    }
    out.push_str("[Unreleased]: https://github.com/salan70/docbridge/compare/v0.16.0...HEAD\n");
    out.push_str("[0.16.0]: https://github.com/salan70/docbridge/releases/tag/v0.16.0\n");
    out
}

/// A head checkout plus a `base/` tree served by the `git show` stub.
struct Checkout {
    dir: tempfile::TempDir,
}
impl Checkout {
    fn new(base_version: &str, base_changelog: &str) -> Self {
        let dir = tempfile::tempdir().unwrap();
        let c = Checkout { dir };
        for path in MANIFESTS {
            c.write(&format!("base/{path}"), &manifest(base_version));
            c.write(path, &manifest(base_version));
        }
        c.write("base/CHANGELOG.md", base_changelog);
        c.write("CHANGELOG.md", base_changelog);
        let bin = c.path("bin");
        fs::create_dir_all(&bin).unwrap();
        executable(
            &bin.join("git"),
            r#"root="$(dirname "$0")/.."
[ "$1" = show ] || { echo "unexpected git $*" >&2; exit 64; }
ref="${2%%:*}"; path="${2#*:}"
[ "$ref" = base-sha ] || { echo "fatal: bad ref $ref" >&2; exit 128; }
[ -f "$root/base/$path" ] || { echo "fatal: path '$path' does not exist" >&2; exit 128; }
cat "$root/base/$path"
"#,
        );
        executable(
            &bin.join("cargo"),
            r#"printf '%s\n' "$*" >>"$(dirname "$0")/cargo.log"
"#,
        );
        c
    }
    fn path(&self, rel: &str) -> PathBuf {
        self.dir.path().join(rel)
    }
    fn write(&self, rel: &str, body: &str) {
        let path = self.path(rel);
        fs::create_dir_all(path.parent().unwrap()).unwrap();
        fs::write(path, body).unwrap();
    }
    fn read(&self, rel: &str) -> String {
        fs::read_to_string(self.path(rel)).unwrap_or_default()
    }
    fn set_version(&self, version: &str) {
        for path in MANIFESTS {
            self.write(path, &manifest(version));
        }
    }
    fn run(&self, script: &str, args: &[&str]) -> Output {
        Command::new("bash")
            .arg(repo().join("scripts").join(script))
            .args(args)
            .current_dir(self.dir.path())
            .env(
                "PATH",
                format!(
                    "{}:{}",
                    self.path("bin").display(),
                    std::env::var("PATH").unwrap()
                ),
            )
            .output()
            .unwrap()
    }
    fn check(&self, labels: &[&str]) -> Output {
        let mut args = vec!["base-sha"];
        args.extend_from_slice(labels);
        self.run("check-release-label.sh", &args)
    }
}
fn stderr(out: &Output) -> String {
    String::from_utf8_lossy(&out.stderr).into_owned()
}

#[test]
fn exactly_one_known_release_label_is_required() {
    let c = Checkout::new("0.17.0", &changelog("", &[]));
    for labels in [
        &[][..],
        &["bug"][..],
        &["release: none", "release: patch"][..],
        &["release: huge"][..],
    ] {
        let out = c.check(labels);
        assert!(!out.status.success(), "{labels:?}: {out:?}");
    }
    assert!(stderr(&c.check(&[])).contains("Add exactly one release label"));
    let out = c.check(&["bug", "release: none"]);
    assert!(out.status.success(), "{out:?}");
}

#[test]
fn release_none_keeps_versions_and_unreleased_unchanged() {
    let c = Checkout::new("0.17.0", &changelog("\n- Pending entry.\n", &[]));
    assert!(c.check(&["release: none"]).status.success());

    c.write("crates/docbridge-update/Cargo.toml", &manifest("0.17.1"));
    let out = c.check(&["release: none"]);
    assert!(!out.status.success());
    assert!(stderr(&out).contains("crates/docbridge-update/Cargo.toml version must stay 0.17.0"));

    c.set_version("0.17.0");
    c.write("CHANGELOG.md", &changelog("\n- Another entry.\n", &[]));
    let out = c.check(&["release: none"]);
    assert!(!out.status.success());
    assert!(stderr(&out).contains("[Unreleased] must stay unchanged"));
}

#[test]
fn a_releasing_label_requires_the_next_version_and_a_rolled_changelog() {
    let c = Checkout::new("0.17.0", &changelog("", &[]));
    let out = c.check(&["release: patch"]);
    assert!(!out.status.success());
    assert!(stderr(&out).contains("version must be 0.17.1 for release: patch"));
    assert!(stderr(&out).contains("'## [0.17.1]'"));

    c.set_version("0.17.1");
    c.write("CHANGELOG.md", &changelog("\n- Not rolled.\n", &[]));
    let out = c.check(&["release: patch"]);
    assert!(!out.status.success());
    assert!(stderr(&out).contains("[Unreleased] must be empty"));

    c.write(
        "CHANGELOG.md",
        &changelog("", &[("0.17.1", "### Fixed\n\n- A fix.")]),
    );
    let out = c.check(&["release: patch"]);
    assert!(out.status.success(), "{out:?}");

    for (label, version) in [("release: minor", "0.18.0"), ("release: major", "1.0.0")] {
        c.set_version(version);
        c.write("CHANGELOG.md", &changelog("", &[(version, "- Change.")]));
        let out = c.check(&[label]);
        assert!(out.status.success(), "{label}: {out:?}");
    }
}

#[test]
fn the_cutover_base_takes_its_version_from_the_legacy_npm_manifest() {
    let c = Checkout::new("0.0.0", &changelog("", &[]));
    c.write(
        "base/package.json",
        "{\n  \"name\": \"docbridge\",\n  \"version\": \"0.16.0\"\n}\n",
    );
    c.set_version("0.17.0");
    c.write(
        "CHANGELOG.md",
        &changelog("", &[("0.17.0", "### Removed\n\n- Legacy CLI.")]),
    );
    let out = c.check(&["release: minor"]);
    assert!(out.status.success(), "{out:?}");
}

#[test]
fn release_bump_rolls_the_changelog_and_sets_every_manifest() {
    let c = Checkout::new(
        "0.17.0",
        &changelog("\n### Fixed\n\n- A fix.\n", &[("0.17.0", "- First.")]),
    );
    let out = c.run("release-bump.sh", &["patch"]);
    assert!(out.status.success(), "{out:?}");
    for path in MANIFESTS {
        let body = c.read(path);
        assert!(body.contains("\nversion = \"0.17.1\"\n"), "{path}: {body}");
        assert!(
            body.contains("foo = { version = \"9.9.9\" }"),
            "{path}: {body}"
        );
    }
    let log = c.read("CHANGELOG.md");
    assert!(log.contains("## [Unreleased]\n\n## [0.17.1] - "), "{log}");
    assert!(
        log.contains("### Fixed\n\n- A fix.\n\n## [0.17.0]"),
        "{log}"
    );
    assert!(log.contains(
        "[Unreleased]: https://github.com/salan70/docbridge/compare/v0.17.1...HEAD\n[0.17.1]: https://github.com/salan70/docbridge/releases/tag/v0.17.1\n[0.16.0]:"
    ), "{log}");
    assert_eq!(c.read("bin/cargo.log"), "update --workspace --offline\n");
    // The rolled change satisfies the label check against the base.
    let out = c.check(&["release: patch"]);
    assert!(out.status.success(), "{out:?}");
}

#[test]
fn release_bump_refuses_an_empty_unreleased_section_without_writing() {
    let c = Checkout::new("0.17.0", &changelog("", &[]));
    let before = c.read("CHANGELOG.md");
    let out = c.run("release-bump.sh", &["minor"]);
    assert!(!out.status.success());
    assert!(stderr(&out).contains("has no entries"));
    assert_eq!(c.read("CHANGELOG.md"), before);
    assert!(c.read(MANIFESTS[0]).contains("version = \"0.17.0\""));
    assert!(!c.run("release-bump.sh", &["build"]).status.success());
}
