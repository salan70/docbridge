use serde_json::{json, Value};
use std::{
    fs,
    io::Write,
    path::PathBuf,
    process::{Command, Output, Stdio},
};

struct Project(PathBuf);
impl Project {
    fn new() -> Self {
        static NEXT: std::sync::atomic::AtomicUsize = std::sync::atomic::AtomicUsize::new(0);
        let path = std::env::temp_dir().join(format!(
            "docbridge-query-{}-{}",
            std::process::id(),
            NEXT.fetch_add(1, std::sync::atomic::Ordering::Relaxed)
        ));
        fs::create_dir_all(&path).unwrap();
        let p = Self(path);
        p.write("docbridge.config.json", r#"{"include":{"code":{"paths":["src"],"extensions":[".rs"]},"docs":["docs"]},"exclude":{"code":["**/*.test.rs"]}}"#);
        p
    }
    fn write(&self, path: &str, text: &str) {
        let p = self.0.join(path);
        fs::create_dir_all(p.parent().unwrap()).unwrap();
        fs::write(p, text).unwrap();
    }
    fn run(&self, args: &[&str]) -> Output {
        Command::new(env!("CARGO_BIN_EXE_docbridge"))
            .current_dir(&self.0)
            .args(args)
            .output()
            .unwrap()
    }
    fn json(&self, args: &[&str]) -> (Output, Value) {
        let o = self.run(args);
        let v = serde_json::from_slice(&o.stdout).unwrap_or_else(|_| {
            panic!(
                "stdout {:?}, stderr {:?}",
                String::from_utf8_lossy(&o.stdout),
                String::from_utf8_lossy(&o.stderr)
            )
        });
        (o, v)
    }
}
impl Drop for Project {
    fn drop(&mut self) {
        let _ = fs::remove_dir_all(&self.0);
    }
}

#[test]
fn validates_required_exact_configuration_and_usage_exit_codes() {
    let p = Project::new();
    assert_eq!(p.run(&["validate"]).status.code(), Some(0));
    assert_eq!(p.run(&["validate", "--audit"]).status.code(), Some(1));
    assert_eq!(p.run(&["links", "--audit"]).status.code(), Some(3));
    for command in ["check", "related", "context", "graph", "lsp"] {
        assert_eq!(p.run(&[command]).status.code(), Some(3));
    }
    p.write(
        "docbridge.config.json",
        r#"{"include":{"code":{"paths":[],"extensions":[]},"docs":[]},"extra":true}"#,
    );
    let (o, v) = p.json(&["validate", "--json"]);
    assert_eq!(o.status.code(), Some(1));
    assert!(!v["diagnostics"].as_array().unwrap().is_empty());
    assert!(v["summary"].is_object());
    fs::remove_file(p.0.join("docbridge.config.json")).unwrap();
    assert_eq!(p.run(&["validate"]).status.code(), Some(1));
}

#[test]
fn links_have_hierarchical_unicode_collision_ids_and_direct_edges() {
    let p = Project::new();
    p.write("src/a.rs", "a\n");
    p.write("src/b.rs", "b\n");
    p.write("docs/a.md", "<!-- @code src/a.rs -->\n# 日本_語\n<!-- @code src/b.rs -->\n### Child\n### Child\n### Child-2\n# !!!\n## Leaf\n");
    let (o, v) = p.json(&["links", "--json"]);
    assert!(o.status.success());
    let ids: Vec<_> = v["nodes"]
        .as_array()
        .unwrap()
        .iter()
        .filter_map(|n| n["id"].as_str())
        .collect();
    for id in [
        "docs/a.md#日本_語",
        "docs/a.md#日本_語/child",
        "docs/a.md#日本_語/child-2",
        "docs/a.md#日本_語/child-2-2",
        "docs/a.md#section/leaf",
    ] {
        assert!(ids.contains(&id), "{ids:?}");
    }
    let (_, v) = p.json(&["links", "src/a.rs", "--json"]);
    assert_eq!(v["edges"].as_array().unwrap().len(), 1);
    assert_eq!(v["nodes"].as_array().unwrap().len(), 2);
    assert!(v["edges"][0]["source"]
        .as_str()
        .unwrap()
        .starts_with("docs/"));
}

#[test]
fn partial_links_keep_valid_json_and_empty_globs_succeed() {
    let p = Project::new();
    p.write("src/a.rs", "ok");
    p.write(
        "docs/a.md",
        "<!-- @code src/a.rs -->\n# A\n<!-- @code ../escape.rs -->\n## Bad\n",
    );
    let (o, v) = p.json(&["links", "src/a.rs", "missing.rs", "--json"]);
    assert_eq!(o.status.code(), Some(2));
    assert_eq!(v["complete"], false);
    assert!(!o.stderr.is_empty());
    assert_eq!(p.run(&["links", "missing.rs"]).status.code(), Some(1));
    let clean = Project::new();
    let (o, v) = clean.json(&["links", "none/**/*.rs", "--json"]);
    assert!(o.status.success());
    assert_eq!(v["nodes"], json!([]));
}

#[test]
fn content_is_merged_without_losing_section_references_or_crlf() {
    let p = Project::new();
    p.write("src/a.rs", "entire\r\nfile\r\n");
    let md = "# Parent\r\nbody\r\n## Child\r\nchild body\r\n";
    p.write("docs/a.md", md);
    let (o, v) = p.json(&[
        "links",
        "docs/a.md#parent",
        "docs/a.md#parent/child",
        "--include-content",
        "--json",
    ]);
    assert!(o.status.success());
    assert_eq!(v["contents"].as_array().unwrap().len(), 1);
    assert_eq!(v["contents"][0]["text"], md);
    for n in v["nodes"].as_array().unwrap() {
        assert!(n["content"]["block"].is_string());
        assert!(n["content"]["start_line"].is_number());
    }
    let o = p.run(&["links", "docs/a.md", "--include-content"]);
    let s = String::from_utf8(o.stdout).unwrap();
    assert!(s.contains("Links\n"));
    assert!(s.contains("Contents\n"));
    assert!(s.contains(md));
    assert!(s.contains("already present"));
}

#[test]
fn stdin_deduplicates_and_root_is_explicit() {
    let p = Project::new();
    p.write("src/a.rs", "a");
    p.write("docs/a.md", "<!-- @code src/a.rs -->\n# A\n");
    let mut child = Command::new(env!("CARGO_BIN_EXE_docbridge"))
        .current_dir(&p.0)
        .args(["links", "--stdin", "--json"])
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .spawn()
        .unwrap();
    child
        .stdin
        .take()
        .unwrap()
        .write_all(b"src/a.rs\n\nsrc/a.rs\n")
        .unwrap();
    let o = child.wait_with_output().unwrap();
    assert!(o.status.success());
    let v: Value = serde_json::from_slice(&o.stdout).unwrap();
    assert_eq!(v["nodes"].as_array().unwrap().len(), 2);
    fs::create_dir_all(p.0.join("nested")).unwrap();
    let o = Command::new(env!("CARGO_BIN_EXE_docbridge"))
        .current_dir(p.0.join("nested"))
        .arg("validate")
        .output()
        .unwrap();
    assert_eq!(o.status.code(), Some(1));
    let o = Command::new(env!("CARGO_BIN_EXE_docbridge"))
        .current_dir(p.0.join("nested"))
        .args(["validate", "--root"])
        .arg(&p.0)
        .output()
        .unwrap();
    assert!(o.status.success());
}

#[test]
fn unlinked_respects_parent_coverage_and_preserves_uncovered_regions() {
    let p = Project::new();
    p.write("src/a.rs", "a");
    p.write("src/free.rs", "free");
    p.write("docs/a.md", "Preamble\n# Parent\nparent body\n<!-- @code src/a.rs -->\n## Child\ncovered\n# Free\n## Nested\ntext\n");
    let (o, v) = p.json(&["unlinked", "--json"]);
    assert!(o.status.success());
    assert_eq!(v["complete"], true);
    let s = v.to_string();
    assert!(s.contains("#parent"));
    assert!(s.contains("#free/nested"));
    assert!(!s.contains("#parent/child"));
    assert!(s.contains("preamble"));
    assert!(s.contains("src/free.rs"));
    p.write(
        "docs/a.md",
        "<!-- @code src/a.rs -->\n# Parent\n## Child\ntext\n",
    );
    let (_, v) = p.json(&["unlinked", "--json"]);
    assert!(!v.to_string().contains("docs/a.md#"));
}

#[test]
fn discovery_honors_case_exclusion_git_and_rejects_binary() {
    let p = Project::new();
    p.write("src/a.rs", "a");
    p.write("src/no.test.rs", "excluded");
    p.write("src/UP.RS", "uppercase");
    p.write("src/.git/internal.rs", "git");
    let (_, v) = p.json(&["unlinked", "--json"]);
    let s = v.to_string();
    assert!(s.contains("src/a.rs"));
    assert!(!s.contains("no.test"));
    assert!(!s.contains("UP.RS"));
    assert!(!s.contains("internal"));
    fs::write(p.0.join("src/b.rs"), b"a\0b").unwrap();
    let (o, v) = p.json(&["unlinked", "--json"]);
    assert_eq!(o.status.code(), Some(1));
    assert_eq!(v["complete"], false);
    fs::write(p.0.join("src/b.rs"), [255]).unwrap();
    assert_eq!(p.run(&["validate"]).status.code(), Some(1));
}

#[test]
fn invalid_targets_and_duplicate_links_fail_validation() {
    let p = Project::new();
    p.write("src/a.rs", "a");
    p.write("src/no.test.rs", "excluded");
    for target in [
        "/tmp/a.rs",
        "../a.rs",
        "src\\a.rs",
        "src/a.rs#symbol",
        "src/A.rs",
        "src/no.test.rs",
        ".",
    ] {
        p.write("docs/a.md", &format!("<!-- @code {target} -->\n# A\n"));
        assert_eq!(p.run(&["validate"]).status.code(), Some(1), "{target}");
    }
    p.write(
        "docs/a.md",
        "<!-- @code src/a.rs -->\n<!-- @code src/a.rs -->\n# A\n",
    );
    let (o, v) = p.json(&["validate", "--json"]);
    assert_eq!(o.status.code(), Some(1));
    assert_eq!(v["summary"]["errors"], 1);
}

#[cfg(unix)]
#[test]
fn symlink_files_and_ancestors_are_never_followed() {
    use std::os::unix::fs::symlink;
    let p = Project::new();
    let outside = Project::new();
    outside.write("secret.rs", "secret");
    fs::create_dir_all(p.0.join("src")).unwrap();
    symlink(&outside.0, p.0.join("src/linked")).unwrap();
    let (o, v) = p.json(&["unlinked", "--json"]);
    assert_eq!(o.status.code(), Some(1));
    assert_eq!(v["complete"], false);
    assert!(!v.to_string().contains("secret.rs"));
}

#[test]
fn uncovered_parent_ranges_exclude_linked_child_subtrees() {
    let p = Project::new();
    p.write("src/a.rs", "a");
    p.write("docs/a.md", "# Parent\nbody\n<!-- @code src/a.rs -->\n## Linked\ncovered\n### Covered\ncovered too\n## Free\nfree\n");
    let (_, v) = p.json(&["unlinked", "--json"]);
    let parent = v["nodes"]
        .as_array()
        .unwrap()
        .iter()
        .find(|n| n["id"] == "docs/a.md#parent")
        .unwrap();
    assert_eq!(
        parent["regions"],
        json!([{"start_line":1,"end_line":2},{"start_line":8,"end_line":9}])
    );
    assert_eq!(parent["children"][0]["id"], "docs/a.md#parent/free");
}

#[test]
fn json_usage_errors_and_invalid_selectors_stay_structured() {
    let p = Project::new();
    let (o, v) = p.json(&["validate", "--json", "--audit"]);
    assert_eq!(o.status.code(), Some(1));
    assert!(v["summary"].is_object());
    let (o, v) = p.json(&["links", "--json", "--audit"]);
    assert_eq!(o.status.code(), Some(3));
    assert_eq!(v["complete"], false);
    for selector in [".", "./src/a.rs", "a?b", "a[b]"] {
        let (o, v) = p.json(&["links", selector, "--json"]);
        assert_eq!(o.status.code(), Some(1), "{selector}");
        assert_eq!(v["complete"], false);
    }
}

#[test]
fn required_nested_config_fields_and_unsupported_globs_are_rejected() {
    let p = Project::new();
    for config in [
        r#"{}"#,
        r#"{"include":{"code":{"paths":[],"extensions":[]},"docs":[],"extra":[]}}"#,
        r#"{"include":{"code":{"paths":[],"extensions":[]},"docs":[]},"exclude":{"docs":[]}}"#,
        r#"{"include":{"code":{"paths":["src/**x"],"extensions":[".rs"]},"docs":[]}}"#,
        r#"{"include":{"code":{"paths":["../src"],"extensions":[".rs"]},"docs":[]}}"#,
        r#"{"include":{"code":{"paths":[],"extensions":["rs"]},"docs":[]}}"#,
    ] {
        p.write("docbridge.config.json", config);
        assert_eq!(p.run(&["validate"]).status.code(), Some(1), "{config}");
    }
    p.write(
        "docbridge.config.json",
        r#"{"include":{"code":{"paths":[],"extensions":[]},"docs":[]}}"#,
    );
    p.write("src/a.rs", "bad\0");
    p.write("docs/a.md", "<!-- @code missing.rs -->\n# A\n");
    assert!(p.run(&["validate"]).status.success());
}

#[test]
fn stdin_empty_selection_and_deterministic_content_are_not_whole_project() {
    let p = Project::new();
    p.write("src/a.rs", "a");
    p.write("docs/a.md", "<!-- @code src/a.rs -->\n# A\n");
    let a = p.run(&["links", "--include-content", "--json"]);
    let b = p.run(&["links", "--include-content", "--json"]);
    assert_eq!(a.stdout, b.stdout);
    let (o, v) = p.json(&["links", "--stdin", "--json"]);
    assert!(o.status.success());
    assert_eq!(v["nodes"], json!([]));
}

#[cfg(unix)]
#[test]
fn excluded_symlinks_and_git_metadata_do_not_make_scans_incomplete() {
    use std::os::unix::fs::symlink;
    let p = Project::new();
    fs::create_dir_all(p.0.join("src/.git")).unwrap();
    symlink("/nonexistent", p.0.join("src/excluded.test.rs")).unwrap();
    symlink("/nonexistent", p.0.join("src/.git/secret.rs")).unwrap();
    assert!(p.run(&["validate"]).status.success());
}

#[cfg(unix)]
#[test]
fn unreadable_managed_files_are_incomplete_and_safety_api_is_shared() {
    use std::os::unix::fs::{symlink, PermissionsExt};
    let p = Project::new();
    p.write("src/a.rs", "a");
    let root = fs::canonicalize(&p.0).unwrap();
    assert_eq!(
        docbridge::project::read_text(&root, "src/a.rs").unwrap(),
        "a"
    );
    fs::set_permissions(p.0.join("src/a.rs"), fs::Permissions::from_mode(0o0)).unwrap();
    let (o, v) = p.json(&["links", "--json"]);
    fs::set_permissions(p.0.join("src/a.rs"), fs::Permissions::from_mode(0o600)).unwrap();
    assert_eq!(o.status.code(), Some(1));
    assert_eq!(v["complete"], false);
    symlink(p.0.join("src"), p.0.join("alias")).unwrap();
    assert!(docbridge::project::read_text(&root, "alias/a.rs").is_err());
    assert!(docbridge::project::read_text(&root, "../outside").is_err());
    assert!(docbridge::project::read_text(&root, "src/A.rs").is_err());
}

#[test]
fn dot_discovery_supports_hidden_files_but_never_git() {
    let p = Project::new();
    p.write(
        "docbridge.config.json",
        r#"{"include":{"code":{"paths":["."],"extensions":[".rs"]},"docs":["."]}}"#,
    );
    p.write(".hidden/a.rs", "a");
    p.write(".hidden/a.md", "<!-- @code .hidden/a.rs -->\n# A\n");
    p.write(".git/a.rs", "hidden");
    let (o, v) = p.json(&["links", "--json"]);
    assert!(o.status.success());
    assert_eq!(v["edges"].as_array().unwrap().len(), 1);
    assert!(!v.to_string().contains(".git"));
}

#[test]
fn invalid_annotations_do_not_cover_unlinked_regions_and_empty_documents_are_not_regions() {
    let p = Project::new();
    p.write("docs/blank.md", " \n<!-- ordinary comment -->\n");
    p.write("docs/plain.md", "Headingless body\n");
    p.write(
        "docs/broken.md",
        "<!-- @code missing.rs -->\n# Parent\n## Child\n",
    );
    let (o, v) = p.json(&["unlinked", "--json"]);
    assert_eq!(o.status.code(), Some(1));
    assert_eq!(v["complete"], false);
    let s = v["nodes"].to_string();
    assert!(s.contains("docs/plain.md#@preamble"));
    assert!(!s.contains("blank.md"));
    assert!(s.contains("docs/broken.md#parent/child"));
}

#[test]
fn all_six_commands_are_visible_in_help() {
    let p = Project::new();
    let help = String::from_utf8(p.run(&["--help"]).stdout).unwrap();
    for command in ["validate", "links", "unlinked", "init", "deinit", "docs"] {
        assert!(help.contains(command));
    }
}

#[test]
fn embedded_docs_work_without_project_configuration_or_guide_files() {
    let p = Project::new();
    fs::remove_file(p.0.join("docbridge.config.json")).unwrap();
    let overview = p.run(&["docs"]);
    assert_eq!(overview.status.code(), Some(0));
    assert!(overview.stderr.is_empty());
    let list = p.run(&["docs", "list"]);
    assert_eq!(list.status.code(), Some(0));
    let names: Vec<_> = String::from_utf8(list.stdout)
        .unwrap()
        .lines()
        .map(|line| line.split_once(':').unwrap().0.to_owned())
        .collect();
    assert_eq!(names.len(), 8);
    for name in names {
        let guide = p.run(&["docs", "show", &name]);
        assert_eq!(guide.status.code(), Some(0), "{name}");
        assert!(guide.stderr.is_empty());
        assert!(guide.stdout.starts_with(b"# "), "{name}");
    }
}

#[test]
fn embedded_docs_reject_unknown_guides_and_invalid_arguments() {
    let p = Project::new();
    for args in [
        vec!["docs", "show", "unknown"],
        vec!["docs", "show"],
        vec!["docs", "list", "extra"],
        vec!["docs", "--root", "."],
    ] {
        let result = p.run(&args);
        assert_eq!(result.status.code(), Some(3), "{args:?}");
        assert!(result.stdout.is_empty());
        assert!(!result.stderr.is_empty());
    }
}

#[test]
fn lifecycle_inspection_never_writes_and_init_yes_respects_root() {
    let p = Project::new();
    let selected = p.0.join("selected");
    fs::create_dir_all(selected.join("src")).unwrap();
    fs::write(selected.join("src/example.rs"), "fn example() {}\n").unwrap();
    for args in [
        vec!["init", "--root", "selected"],
        vec!["init", "--root", "selected", "--dry-run", "--yes"],
    ] {
        let result = p.run(&args);
        assert_eq!(result.status.code(), Some(0));
        assert!(!selected.join("docbridge.config.json").exists());
        assert!(!selected.join(".agents").exists());
    }
    let result = p.run(&["init", "--root", "selected", "--yes", "--claude"]);
    assert_eq!(result.status.code(), Some(0));
    assert!(selected.join("docbridge.config.json").is_file());
    assert!(selected.join(".agents/skills/docbridge/SKILL.md").is_file());
    assert!(selected.join(".claude/skills/docbridge/SKILL.md").is_file());
    assert!(!p.0.join(".agents").exists());
}

#[test]
fn deinit_requires_confirmation_and_rejects_unapproved_flags() {
    let p = Project::new();
    p.write("src/a.rs", "fn a() {}\n");
    p.write("docs/a.md", "<!-- @code src/a.rs -->\n# A\nBody\n");
    assert_eq!(p.run(&["init", "--yes"]).status.code(), Some(0));
    let plan = p.run(&["deinit", "--dry-run"]);
    assert_eq!(plan.status.code(), Some(0));
    assert!(String::from_utf8(plan.stdout)
        .unwrap()
        .contains("Removal root:"));
    assert_eq!(p.run(&["deinit"]).status.code(), Some(1));
    for args in [vec!["deinit", "--yes"], vec!["deinit", "--root", "."]] {
        assert_eq!(p.run(&args).status.code(), Some(3));
    }
    assert!(p.0.join("docbridge.config.json").exists());
    assert!(fs::read_to_string(p.0.join("docs/a.md"))
        .unwrap()
        .contains("@code"));
}

#[test]
fn deinit_applies_only_after_the_exact_plan_is_confirmed() {
    let p = Project::new();
    p.write("src/a.rs", "fn a() {}\n");
    p.write("docs/a.md", "<!-- @code src/a.rs -->\n# A\nBody\n");
    let invocation = docbridge::cli::Invocation::parse(&["deinit".into()], &p.0).unwrap();
    let mut confirmed = false;
    let result = docbridge::cli::dispatch_with_confirmation(invocation, "", |plan| {
        assert!(p.0.join("docbridge.config.json").exists());
        assert!(plan.contains("docs/a.md"));
        assert!(plan.contains("docbridge.config.json"));
        confirmed = true;
        true
    });
    assert!(confirmed);
    assert_eq!(result.exit_code, 0, "{}", result.stderr);
    assert!(!p.0.join("docbridge.config.json").exists());
    assert_eq!(
        fs::read_to_string(p.0.join("docs/a.md")).unwrap(),
        "# A\nBody\n"
    );
}

// APFS rejects invalid UTF-8 filenames before discovery can observe them.
#[cfg(target_os = "linux")]
#[test]
fn unmanaged_non_utf8_names_do_not_poison_managed_discovery() {
    use std::{ffi::OsString, os::unix::ffi::OsStringExt};
    let p = Project::new();
    p.write("src/a.rs", "a");
    fs::write(p.0.join(OsString::from_vec(vec![255])), "unmanaged").unwrap();
    assert!(p.run(&["validate"]).status.success());
}

#[cfg(unix)]
#[test]
fn configuration_symlinks_are_rejected_without_reading_the_target() {
    use std::os::unix::fs::symlink;
    let p = Project::new();
    let outside = Project::new();
    fs::remove_file(p.0.join("docbridge.config.json")).unwrap();
    symlink(
        outside.0.join("docbridge.config.json"),
        p.0.join("docbridge.config.json"),
    )
    .unwrap();
    assert_eq!(p.run(&["validate"]).status.code(), Some(1));
}

#[test]
fn selected_sections_retrieve_neighbors_without_traversing_through_shared_code() {
    let p = Project::new();
    p.write("src/internal space.rs", "full file\n");
    p.write("src/b.rs", "b\n");
    p.write("docs/a.md", "<!-- @code src/internal space.rs -->\n# A\n");
    p.write(
        "docs/b.md",
        "<!-- @code src/internal space.rs -->\n<!-- @code src/b.rs -->\n# B\n",
    );
    let (o, v) = p.json(&["links", "docs/a.md#a", "--include-content", "--json"]);
    assert!(o.status.success());
    assert_eq!(v["edges"].as_array().unwrap().len(), 1);
    assert_eq!(v["nodes"].as_array().unwrap().len(), 2);
    assert!(!v["nodes"].to_string().contains("docs/b.md"));
    let (o, v) = p.json(&["links", "src/internal space.rs", "--json"]);
    assert!(o.status.success());
    assert_eq!(v["edges"].as_array().unwrap().len(), 2);
    assert_eq!(v["nodes"].as_array().unwrap().len(), 3);
}

#[test]
fn headingless_indented_code_examples_are_meaningful_unlinked_content() {
    let p = Project::new();
    p.write("docs/example.md", "    <!-- example -->\n");
    let (o, v) = p.json(&["unlinked", "--json"]);
    assert!(o.status.success());
    assert!(v["nodes"].to_string().contains("docs/example.md#@preamble"));
}

#[test]
fn annotations_inside_html_blocks_are_not_links() {
    let p = Project::new();
    p.write("src/a.rs", "fn a() {}\n");
    p.write(
        "docs/a.md",
        "<pre>\n<!-- @code src/missing.rs -->\n</pre>\n<!-- @code src/a.rs -->\n# A\n",
    );
    assert_eq!(p.run(&["validate"]).status.code(), Some(0));
    let (o, v) = p.json(&["links", "--json"]);
    assert!(o.status.success());
    assert!(!v.to_string().contains("missing.rs"));
    assert_eq!(v["edges"].as_array().unwrap().len(), 1);
}

#[test]
fn deinit_with_unterminated_html_block_annotation_exits_incomplete() {
    let p = Project::new();
    p.write("src/a.rs", "fn a() {}\n");
    p.write(
        "docs/a.md",
        "<!-- @code src/a.rs -->\n# A\n<pre>\n<!-- @code src/a.rs -->\n",
    );
    let invocation = docbridge::cli::Invocation::parse(&["deinit".into()], &p.0).unwrap();
    let result = docbridge::cli::dispatch_with_confirmation(invocation, "", |plan| {
        assert!(plan.contains("docs/a.md:4 (inside an unterminated HTML block, review manually)"));
        true
    });
    assert_eq!(result.exit_code, 1);
    assert!(!result.stdout.contains("Removal complete."));
    assert!(result.stderr.contains("docs/a.md:4"), "{}", result.stderr);
    assert!(!p.0.join("docbridge.config.json").exists());
    assert_eq!(
        fs::read_to_string(p.0.join("docs/a.md")).unwrap(),
        "# A\n<pre>\n<!-- @code src/a.rs -->\n"
    );
}
