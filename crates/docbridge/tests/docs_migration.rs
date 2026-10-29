use std::{
    fs,
    path::{Path, PathBuf},
    process::{Command, Output},
};

fn bin() -> &'static str {
    env!("CARGO_BIN_EXE_docbridge")
}

fn crate_dir() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR"))
}

fn temp_dir(label: &str) -> PathBuf {
    static NEXT: std::sync::atomic::AtomicUsize = std::sync::atomic::AtomicUsize::new(0);
    let path = std::env::temp_dir().join(format!(
        "docbridge-docs-migration-{label}-{}-{}",
        std::process::id(),
        NEXT.fetch_add(1, std::sync::atomic::Ordering::Relaxed)
    ));
    let _ = fs::remove_dir_all(&path);
    fs::create_dir_all(&path).unwrap();
    path
}

fn copy_tree(from: &Path, to: &Path) {
    fs::create_dir_all(to).unwrap();
    for entry in fs::read_dir(from).unwrap() {
        let entry = entry.unwrap();
        let target = to.join(entry.file_name());
        if entry.file_type().unwrap().is_dir() {
            copy_tree(&entry.path(), &target);
        } else {
            fs::copy(entry.path(), target).unwrap();
        }
    }
}

fn files(dir: &Path, out: &mut Vec<PathBuf>) {
    for entry in fs::read_dir(dir).unwrap() {
        let entry = entry.unwrap();
        if entry.file_type().unwrap().is_dir() {
            files(&entry.path(), out);
        } else {
            out.push(entry.path());
        }
    }
}

fn fixture_copy(name: &str) -> PathBuf {
    let dir = temp_dir(name);
    copy_tree(&crate_dir().join("tests/fixtures").join(name), &dir);
    dir
}

fn run(dir: &Path, args: &[&str]) -> Output {
    Command::new(bin())
        .current_dir(dir)
        .args(args)
        .output()
        .unwrap()
}

fn text(bytes: &[u8]) -> String {
    String::from_utf8_lossy(bytes).into_owned()
}

#[test]
fn legacy_project_is_rejected_by_validate() {
    let dir = fixture_copy("legacy-project");
    let out = run(&dir, &["validate"]);
    assert_eq!(out.status.code(), Some(1), "{}", text(&out.stderr));
    let stderr = text(&out.stderr);
    assert!(
        stderr.contains("docbridge.config.json") && stderr.contains("unknown field"),
        "{stderr}"
    );
    let _ = fs::remove_dir_all(dir);
}

#[test]
fn legacy_symbol_paths_are_rejected_even_with_a_new_configuration() {
    let dir = fixture_copy("legacy-project");
    fs::copy(
        crate_dir().join("tests/fixtures/legacy-project-migrated/docbridge.config.json"),
        dir.join("docbridge.config.json"),
    )
    .unwrap();
    let out = run(&dir, &["validate"]);
    assert_eq!(out.status.code(), Some(1));
    let stderr = text(&out.stderr);
    assert!(
        stderr.contains("src/auth/session.ts#SessionStore"),
        "{stderr}"
    );
    assert!(stderr.contains("invalid managed path"), "{stderr}");
    let _ = fs::remove_dir_all(dir);
}

#[test]
fn migrated_project_validates_and_accepts_init() {
    let dir = fixture_copy("legacy-project-migrated");
    let out = run(&dir, &["validate"]);
    assert_eq!(out.status.code(), Some(0), "{}", text(&out.stderr));
    let init = run(&dir, &["init", "--yes"]);
    assert_eq!(init.status.code(), Some(0), "{}", text(&init.stderr));
    assert!(dir.join(".agents/skills/docbridge/SKILL.md").is_file());
    let again = run(&dir, &["validate"]);
    assert_eq!(again.status.code(), Some(0), "{}", text(&again.stderr));
    let _ = fs::remove_dir_all(dir);
}

#[test]
fn migrated_project_has_no_legacy_markers() {
    let root = crate_dir().join("tests/fixtures/legacy-project-migrated");
    let mut all = Vec::new();
    files(&root, &mut all);
    assert!(!all.is_empty());
    for path in all {
        let rel = path
            .strip_prefix(&root)
            .unwrap()
            .to_string_lossy()
            .into_owned();
        assert!(!rel.contains("docbridge.links.json"), "{rel}");
        assert!(
            !rel.starts_with(".agents") && !rel.starts_with(".vscode"),
            "{rel}"
        );
        let body = fs::read_to_string(&path).unwrap();
        assert!(!body.contains("@doc"), "{rel}: @doc");
        assert!(!body.contains("docbridge.links.json"), "{rel}: manifest");
        assert!(!body.contains("$schema"), "{rel}: $schema");
        for line in body.lines().filter(|l| l.contains("@code")) {
            assert!(!line.contains('#'), "{rel}: symbol target in {line}");
        }
        for legacy in ["docbridge check", "docbridge related", "--gate"] {
            assert!(!body.contains(legacy), "{rel}: {legacy}");
        }
    }
}

#[test]
fn docs_work_offline_from_an_empty_scrubbed_environment() {
    let dir = temp_dir("offline");
    let docs = |args: &[&str]| -> Output {
        Command::new(bin())
            .env_clear()
            .current_dir(&dir)
            .args(args)
            .output()
            .unwrap()
    };
    let assert_ok = |args: &[&str]| -> String {
        let out = docs(args);
        assert_eq!(
            out.status.code(),
            Some(0),
            "{args:?}: {}",
            text(&out.stderr)
        );
        let stdout = text(&out.stdout);
        assert!(!stdout.trim().is_empty(), "{args:?}");
        stdout
    };
    assert_ok(&["docs"]);
    let list = assert_ok(&["docs", "list"]);
    let names: Vec<_> = list
        .lines()
        .filter_map(|l| l.split(':').next())
        .map(str::trim)
        .filter(|n| !n.is_empty())
        .collect();
    assert!(names.len() >= 8, "{list}");
    for name in names {
        assert_ok(&["docs", "show", name]);
    }
    let _ = fs::remove_dir_all(dir);
}

#[test]
fn help_and_command_guide_agree() {
    let help = run(&temp_dir("help"), &["--help"]);
    assert_eq!(help.status.code(), Some(0));
    let help = text(&help.stdout);
    let commands = [
        "validate", "links", "unlinked", "init", "deinit", "docs", "upgrade",
    ];
    let guide = fs::read_to_string(crate_dir().join("guides/commands.md")).unwrap();
    for command in commands {
        assert!(
            help.lines().any(|l| l.trim_start().starts_with(command)),
            "help lacks {command}"
        );
        assert!(
            guide.contains(&format!("`{command}`")),
            "guide lacks {command}"
        );
    }
    assert!(guide.contains("Success exits 0"));
    assert!(guide.contains("incomplete scans exit 1"));
    assert!(guide.contains("partial `links` exits 2"));
    assert!(guide.contains("invalid arguments exit 3"));
    assert!(guide.contains("no writes without confirmation"));
    assert!(guide.contains("`--dry-run` never writes"));
}
