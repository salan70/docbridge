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
        let mut command = Command::new(bin());
        command.env_clear().current_dir(&dir).args(args);
        // Windows cannot start a process without SystemRoot.
        #[cfg(windows)]
        if let Some(root) = std::env::var_os("SystemRoot") {
            command.env("SystemRoot", root);
        }
        command.output().unwrap()
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
fn migrated_project_preserves_every_legacy_relationship() {
    let dir = fixture_copy("legacy-project-migrated");
    let out = run(&dir, &["links", "--json"]);
    assert_eq!(out.status.code(), Some(0), "{}", text(&out.stderr));
    let graph: serde_json::Value = serde_json::from_slice(&out.stdout).unwrap();
    assert_eq!(graph["complete"], true);
    let mut edges: Vec<(String, String)> = graph["edges"]
        .as_array()
        .unwrap()
        .iter()
        .map(|e| {
            (
                e["source"].as_str().unwrap().to_owned(),
                e["target"].as_str().unwrap().to_owned(),
            )
        })
        .collect();
    edges.sort();
    // Each edge maps to its source in tests/fixtures/legacy-project.
    let mut expected: Vec<(&str, &str)> = vec![
        // docs/auth.md: `@code src/auth/login.ts#login`
        ("docs/auth.md#login-spec", "src/auth/login.ts"),
        // docs/auth.md: `@code src/auth/session.ts#SessionStore`
        ("docs/auth.md#session-store", "src/auth/session.ts"),
        // src/auth/session.ts: in-code `@doc docs/auth.md#session-lookup` on `find`
        ("docs/auth.md#session-lookup", "src/auth/session.ts"),
        // docs/auth.md: `@code src/auth/session.ts#SessionStore.evict`
        ("docs/auth.md#session-eviction", "src/auth/session.ts"),
        // docbridge.links.json: `src/auth/login.ts#logout` <-> `docs/auth.md#logout-spec`
        ("docs/auth.md#logout-spec", "src/auth/login.ts"),
    ];
    expected.sort();
    let expected: Vec<(String, String)> = expected
        .into_iter()
        .map(|(a, b)| (a.to_owned(), b.to_owned()))
        .collect();
    assert_eq!(edges, expected);
    let _ = fs::remove_dir_all(dir);
}

#[test]
fn migrated_ci_and_hook_call_validate_without_the_gate() {
    let root = crate_dir().join("tests/fixtures/legacy-project-migrated");
    let ci = fs::read_to_string(root.join(".github/workflows/ci.yml")).unwrap();
    assert!(ci.contains("run: docbridge validate"), "{ci}");
    for legacy in ["docbridge check", "related", "--gate"] {
        assert!(!ci.contains(legacy), "ci: {legacy}");
    }
    let hook = fs::read_to_string(root.join(".githooks/pre-commit")).unwrap();
    assert!(hook.contains("docbridge validate || exit $?"), "{hook}");
    for legacy in ["docbridge check", "related", "--gate", "|| true"] {
        assert!(!hook.contains(legacy), "hook: {legacy}");
    }
}

fn options(text: &str) -> std::collections::BTreeSet<String> {
    let mut found = std::collections::BTreeSet::new();
    let mut rest = text;
    while let Some(at) = rest.find("--") {
        let tail = &rest[at + 2..];
        let len = tail
            .find(|c: char| !(c.is_ascii_lowercase() || c == '-'))
            .unwrap_or(tail.len());
        let name = tail[..len].trim_end_matches('-');
        if !name.is_empty() {
            found.insert(format!("--{name}"));
        }
        rest = &tail[len..];
    }
    found
}

/// Options the binary exposes for a command. Commands with their own usage
/// text print it for `--help`; the read commands fall back to global help.
fn binary_options(command: &str, global_help: &str) -> std::collections::BTreeSet<String> {
    let out = run(&temp_dir("usage"), &[command, "--help"]);
    assert_eq!(out.status.code(), Some(0), "{command}");
    let usage = text(&out.stdout);
    if usage.starts_with("Usage:") {
        return options(&usage);
    }
    let line = |prefix: &str| {
        global_help
            .lines()
            .find(|l| l.starts_with(prefix))
            .unwrap_or_else(|| panic!("global help lacks {prefix}"))
            .to_owned()
    };
    let mut set = options(&line("Read commands:"));
    if command == "links" {
        set.extend(options(&line("links:")));
    }
    set
}

/// The lines strictly between the `start` heading and the `end` heading. Line
/// based, so a CRLF checkout (Git on Windows) reads the same as LF.
fn section(text: &str, start: &str, end: &str) -> String {
    let mut lines = text.lines().skip_while(|l| *l != start);
    assert!(lines.next().is_some(), "missing {start}");
    let body: Vec<&str> = lines.take_while(|l| *l != end).collect();
    body.join("\n")
}

#[test]
fn section_reads_lf_and_crlf_alike() {
    let lf = "# T\n## Commands\na\nb\n## Output model\nc\n";
    let crlf = lf.replace('\n', "\r\n");
    assert_eq!(section(lf, "## Commands", "## Output model"), "a\nb");
    assert_eq!(section(&crlf, "## Commands", "## Output model"), "a\nb");
}

#[test]
fn help_and_command_guide_agree() {
    let help = run(&temp_dir("help"), &["--help"]);
    assert_eq!(help.status.code(), Some(0));
    let help = text(&help.stdout);
    let commands = ["validate", "links", "unlinked", "init", "deinit", "docs"];
    let guide = fs::read_to_string(crate_dir().join("guides/commands.md")).unwrap();
    let spec = fs::read_to_string(crate_dir().join("../../docs/specs/vnext-contracts.md")).unwrap();
    let syntax = section(&spec, "## Commands", "## Output model");
    for command in commands {
        assert!(
            help.lines().any(|l| l.trim_start().starts_with(command)),
            "help lacks {command}"
        );
        let expected = binary_options(command, &help);
        let row = guide
            .lines()
            .find(|l| l.starts_with(&format!("| `{command}`")))
            .unwrap_or_else(|| panic!("guide lacks {command}"));
        assert_eq!(options(row), expected, "guide options for {command}");
        let line = syntax
            .lines()
            .find(|l| {
                l.strip_prefix(&format!("docbridge {command}"))
                    .is_some_and(|r| r.is_empty() || r.starts_with(' '))
            })
            .unwrap_or_else(|| panic!("spec syntax lacks {command}"));
        assert_eq!(options(line), expected, "spec options for {command}");
    }
    assert!(guide.contains("Success exits 0"));
    assert!(guide.contains("incomplete scans exit 1"));
    assert!(guide.contains("partial `links` exits 2"));
    assert!(guide.contains("invalid arguments exit 3"));
    assert!(guide.contains("no writes without confirmation"));
    assert!(guide.contains("`--dry-run` never writes"));
}

#[test]
fn documented_exit_codes_hold_through_the_binary() {
    let legacy = fixture_copy("legacy-project");
    let migrated = fixture_copy("legacy-project-migrated");
    let code = |dir: &Path, args: &[&str]| run(dir, args).status.code();
    // Errors exit 1.
    assert_eq!(code(&legacy, &["validate"]), Some(1));
    // Partial links results exit 2.
    assert_eq!(
        code(&migrated, &["links", "docs/auth.md", "missing.md"]),
        Some(2)
    );
    // Invalid arguments exit 3, including for validate.
    assert_eq!(code(&migrated, &["links", "--bogus"]), Some(3));
    assert_eq!(code(&migrated, &["unlinked", "--bogus"]), Some(3));
    assert_eq!(code(&migrated, &["deinit", "--bogus"]), Some(3));
    assert_eq!(code(&migrated, &["docs", "show", "no-such-guide"]), Some(3));
    assert_eq!(code(&migrated, &["no-such-command"]), Some(3));
    assert_eq!(code(&migrated, &["validate", "--bogus"]), Some(3));
    // Success exits 0.
    assert_eq!(code(&migrated, &["validate"]), Some(0));
    let _ = fs::remove_dir_all(legacy);
    let _ = fs::remove_dir_all(migrated);
}
