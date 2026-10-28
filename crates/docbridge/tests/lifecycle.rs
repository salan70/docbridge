use docbridge::lifecycle::*;
use std::{
    fs,
    path::PathBuf,
    sync::atomic::{AtomicUsize, Ordering},
};
fn root() -> PathBuf {
    static N: AtomicUsize = AtomicUsize::new(0);
    let p = std::env::temp_dir().join(format!(
        "lifecycle-test-{}-{}",
        std::process::id(),
        N.fetch_add(1, Ordering::Relaxed)
    ));
    fs::create_dir_all(&p).unwrap();
    p
}
fn initialized() -> PathBuf {
    let p = root();
    fs::write(p.join("guide.md"), "# Guide\n").unwrap();
    let result = init(
        &p,
        &InitOptions {
            yes: true,
            claude: true,
            ..Default::default()
        },
    );
    assert_eq!(result.code, 0, "{}", result.stderr);
    p
}
#[test]
fn malformed_annotations_are_preserved() {
    let p = initialized();
    let source = "<!-- @code ../escape.rs -->\n# Invalid\n<!-- @code src/a.rs -->\n# Valid\n```md\n<!-- @code example.rs -->\n```\n<!-- ordinary\n<!-- @code nested.rs -->\n-->\n";
    fs::write(p.join("guide.md"), source).unwrap();
    let plan = plan_deinit(&p).unwrap();
    assert_eq!(fs::read_to_string(p.join("guide.md")).unwrap(), source);
    assert_eq!(apply_deinit(&plan).code, 0);
    let after = fs::read_to_string(p.join("guide.md")).unwrap();
    assert!(after.contains("../escape.rs"));
    assert!(!after.contains("src/a.rs"));
    assert!(after.contains("example.rs"));
    assert!(after.contains("nested.rs"));
}
#[test]
fn retain_modified_and_unmanaged_skill_files() {
    let p = initialized();
    let skill = p.join(".agents/skills/docbridge/SKILL.md");
    fs::write(&skill, "my edits").unwrap();
    fs::write(p.join(".agents/skills/docbridge/extra.txt"), "extra").unwrap();
    let plan = plan_deinit(&p).unwrap();
    assert!(plan.to_string().contains("modified"));
    assert_eq!(apply_deinit(&plan).code, 0);
    assert_eq!(fs::read_to_string(skill).unwrap(), "my edits");
    assert!(p.join(".agents/skills/docbridge/extra.txt").exists());
    assert!(!p.join(".claude/skills/docbridge/SKILL.md").exists());
}
#[test]
fn unmanaged_skill_blocks_force_and_inspection_never_writes() {
    let p = root();
    fs::create_dir_all(p.join(".agents/skills/docbridge")).unwrap();
    fs::write(p.join(".agents/skills/docbridge/SKILL.md"), "mine").unwrap();
    assert_eq!(
        init(
            &p,
            &InitOptions {
                yes: true,
                force: true,
                ..Default::default()
            }
        )
        .code,
        1
    );
    assert!(!p.join("docbridge.config.json").exists());
    let p = root();
    assert_eq!(init(&p, &InitOptions::default()).code, 0);
    assert!(!p.join("docbridge.config.json").exists());
}
#[test]
fn stale_plan_cannot_partially_remove() {
    let p = initialized();
    let plan = plan_deinit(&p).unwrap();
    fs::write(p.join(".claude/skills/docbridge/SKILL.md"), "new edit").unwrap();
    let result = apply_deinit(&plan);
    assert_eq!(result.code, 1);
    assert!(result.stderr.contains("stale"));
    assert!(p.join("docbridge.config.json").exists());
    assert!(p.join(".agents/skills/docbridge/SKILL.md").exists());
}
#[test]
fn old_recovery_is_preserved_and_blocks_further_mutation() {
    let p = initialized();
    fs::create_dir(p.join(".docbridge-recovery-old")).unwrap();
    fs::write(p.join(".docbridge-recovery-old/original"), "backup").unwrap();
    let plan = plan_deinit(&p).unwrap();
    assert!(plan.to_string().contains("unfinished recovery"));
    assert_eq!(apply_deinit(&plan).code, 1);
    assert!(p.join("docbridge.config.json").exists());
    assert_eq!(
        fs::read_to_string(p.join(".docbridge-recovery-old/original")).unwrap(),
        "backup"
    );
}
#[test]
fn force_changes_only_owned_skill_and_preserves_extras() {
    let p = initialized();
    fs::write(p.join(".agents/skills/docbridge/SKILL.md"), "edited").unwrap();
    fs::write(p.join(".agents/skills/docbridge/extra"), "mine").unwrap();
    let before = fs::read(p.join("docbridge.config.json")).unwrap();
    assert_eq!(
        init(
            &p,
            &InitOptions {
                yes: true,
                force: true,
                ..Default::default()
            }
        )
        .code,
        0
    );
    assert_ne!(
        fs::read_to_string(p.join(".agents/skills/docbridge/SKILL.md")).unwrap(),
        "edited"
    );
    assert_eq!(
        fs::read_to_string(p.join(".agents/skills/docbridge/extra")).unwrap(),
        "mine"
    );
    assert_eq!(fs::read(p.join("docbridge.config.json")).unwrap(), before);
}
#[test]
fn ownership_escape_is_rejected_before_any_removal() {
    let p = initialized();
    fs::write(
        p.join(".agents/skills/docbridge/.docbridge-owned.json"),
        format!("{{\"../outside\":\"{}\"}}", "0".repeat(64)),
    )
    .unwrap();
    assert!(plan_deinit(&p).is_err());
    assert!(p.join("docbridge.config.json").exists());
}
#[test]
fn references_are_reported_and_never_rewritten() {
    let p = initialized();
    fs::create_dir_all(p.join(".github/workflows")).unwrap();
    fs::write(
        p.join(".github/workflows/check.yml"),
        "run: docbridge validate\n",
    )
    .unwrap();
    fs::write(p.join("flake.nix"), "docbridge").unwrap();
    let plan = plan_deinit(&p).unwrap();
    assert_eq!(plan.references.len(), 2);
    assert!(plan.to_string().contains("nix profile"));
    assert_eq!(apply_deinit(&plan).code, 0);
    assert_eq!(
        fs::read_to_string(p.join("flake.nix")).unwrap(),
        "docbridge"
    );
}
#[cfg(unix)]
#[test]
fn symlink_ancestor_blocks_writes_and_removal() {
    use std::os::unix::fs::symlink;
    let p = root();
    let outside = root();
    symlink(&outside, p.join(".agents")).unwrap();
    assert_eq!(
        init(
            &p,
            &InitOptions {
                yes: true,
                ..Default::default()
            }
        )
        .code,
        1
    );
    assert!(!p.join("docbridge.config.json").exists());
    assert!(plan_deinit(&p).is_err());
    assert_eq!(fs::read_dir(outside).unwrap().count(), 0);
}
#[cfg(unix)]
#[test]
fn out_of_scope_symlinks_are_not_followed() {
    use std::os::unix::fs::symlink;
    let p = initialized();
    let outside = root();
    fs::write(
        outside.join("secret.md"),
        "<!-- @code secret.rs -->\n# Secret\n",
    )
    .unwrap();
    symlink(&outside, p.join("excluded")).unwrap();
    let plan = plan_deinit(&p).unwrap();
    assert_eq!(apply_deinit(&plan).code, 0);
    assert!(fs::read_to_string(outside.join("secret.md"))
        .unwrap()
        .contains("@code"));
}
#[cfg(unix)]
#[test]
fn read_only_parent_is_rejected_before_any_removal() {
    use std::os::unix::fs::PermissionsExt;
    let p = initialized();
    let dir = p.join(".agents/skills/docbridge");
    let plan = plan_deinit(&p).unwrap();
    fs::set_permissions(&dir, fs::Permissions::from_mode(0o500)).unwrap();
    let result = apply_deinit(&plan);
    fs::set_permissions(&dir, fs::Permissions::from_mode(0o700)).unwrap();
    assert_eq!(result.code, 1);
    assert!(result.stderr.contains("read-only"));
    assert!(p.join("docbridge.config.json").exists());
}
#[test]
fn dry_run_and_existing_config() {
    let p = root();
    assert_eq!(
        init(
            &p,
            &InitOptions {
                dry_run: true,
                ..Default::default()
            }
        )
        .code,
        0
    );
    assert!(!p.join("docbridge.config.json").exists());
    fs::write(p.join("docbridge.config.json"), "user config").unwrap();
    assert_eq!(
        init(
            &p,
            &InitOptions {
                yes: true,
                force: true,
                ..Default::default()
            }
        )
        .code,
        0
    );
    assert_eq!(
        fs::read_to_string(p.join("docbridge.config.json")).unwrap(),
        "user config"
    );
}
fn deinit(p: &std::path::Path) -> Outcome {
    let plan = plan_deinit(p).unwrap();
    apply_deinit(&plan)
}
fn write_config(p: &std::path::Path, docs: &str) {
    fs::write(
        p.join("docbridge.config.json"),
        format!("{{\"include\":{{\"code\":{{\"paths\":[\"src\"],\"extensions\":[\".rs\"]}},\"docs\":{docs}}}}}"),
    )
    .unwrap();
}
#[test]
fn init_deinit_init_round_trip_succeeds() {
    let p = initialized();
    let result = deinit(&p);
    assert_eq!(result.code, 0, "{}", result.stderr);
    assert!(!p.join(".agents/skills/docbridge").exists());
    assert!(!p.join(".claude/skills/docbridge").exists());
    let again = init(
        &p,
        &InitOptions {
            yes: true,
            claude: true,
            ..Default::default()
        },
    );
    assert_eq!(again.code, 0, "{}", again.stderr);
    assert!(p.join(".agents/skills/docbridge/SKILL.md").exists());
}
#[test]
fn empty_plain_skill_directory_is_treated_as_absent() {
    let p = root();
    fs::create_dir_all(p.join(".agents/skills/docbridge")).unwrap();
    let result = init(
        &p,
        &InitOptions {
            yes: true,
            ..Default::default()
        },
    );
    assert_eq!(result.code, 0, "{}", result.stderr);
    assert!(p.join(".agents/skills/docbridge/SKILL.md").exists());
}
#[test]
fn deinit_keeps_skill_directory_with_user_files() {
    let p = initialized();
    fs::write(p.join(".agents/skills/docbridge/notes.txt"), "mine").unwrap();
    assert_eq!(deinit(&p).code, 0);
    assert_eq!(
        fs::read_to_string(p.join(".agents/skills/docbridge/notes.txt")).unwrap(),
        "mine"
    );
    assert!(!p.join(".claude/skills/docbridge").exists());
}
#[cfg(unix)]
#[test]
fn rewrite_preserves_permissions_and_new_files_use_defaults() {
    use std::os::unix::fs::PermissionsExt;
    let p = initialized();
    let mode = |path: std::path::PathBuf| fs::metadata(path).unwrap().permissions().mode() & 0o777;
    fs::write(p.join("reference"), "x").unwrap();
    let default_mode = mode(p.join("reference"));
    assert_eq!(mode(p.join("docbridge.config.json")), default_mode);
    assert_eq!(
        mode(p.join(".agents/skills/docbridge/SKILL.md")),
        default_mode
    );
    fs::write(p.join("guide.md"), "<!-- @code src/a.rs -->\n# Guide\n").unwrap();
    fs::set_permissions(p.join("guide.md"), fs::Permissions::from_mode(0o755)).unwrap();
    assert_eq!(deinit(&p).code, 0);
    assert_eq!(fs::read_to_string(p.join("guide.md")).unwrap(), "# Guide\n");
    assert_eq!(mode(p.join("guide.md")), 0o755);
}
#[cfg(unix)]
#[test]
fn init_discovery_skips_and_reports_symlinks() {
    use std::os::unix::fs::symlink;
    let p = root();
    fs::create_dir_all(p.join("node_modules/.bin")).unwrap();
    fs::write(p.join("node_modules/tool.js"), "x").unwrap();
    symlink("../tool.js", p.join("node_modules/.bin/tool")).unwrap();
    let result = init(
        &p,
        &InitOptions {
            yes: true,
            ..Default::default()
        },
    );
    assert_eq!(result.code, 0, "{}", result.stderr);
    assert!(result.stdout.contains("node_modules/.bin/tool"));
    assert!(p.join("docbridge.config.json").exists());
}
#[cfg(unix)]
#[test]
fn advisory_scan_skips_and_reports_symlinks() {
    use std::os::unix::fs::symlink;
    let p = initialized();
    let outside = root();
    fs::write(outside.join("run.sh"), "docbridge validate").unwrap();
    fs::create_dir_all(p.join("scripts")).unwrap();
    symlink(outside.join("run.sh"), p.join("scripts/run.sh")).unwrap();
    let plan = plan_deinit(&p).unwrap();
    assert!(plan.to_string().contains("scripts/run.sh"));
    assert!(plan.references.is_empty());
    assert_eq!(apply_deinit(&plan).code, 0);
}
#[cfg(unix)]
#[test]
fn symlinked_managed_doc_makes_cleanup_incomplete() {
    use std::os::unix::fs::symlink;
    let p = initialized();
    let outside = root();
    fs::write(
        outside.join("linked.md"),
        "<!-- @code src/a.rs -->\n# Linked\n",
    )
    .unwrap();
    fs::create_dir_all(p.join("docs")).unwrap();
    symlink(outside.join("linked.md"), p.join("docs/linked.md")).unwrap();
    write_config(&p, "[\"docs\"]");
    let plan = plan_deinit(&p).unwrap();
    assert!(plan.to_string().contains("docs/linked.md"));
    let result = apply_deinit(&plan);
    assert_eq!(result.code, 1);
    assert!(result.stderr.contains("docs/linked.md"));
    assert!(fs::read_to_string(outside.join("linked.md"))
        .unwrap()
        .contains("@code"));
}
#[test]
fn unparsable_config_still_plans_removal_but_reports_incomplete() {
    let p = initialized();
    fs::write(p.join("guide.md"), "<!-- @code src/a.rs -->\n# Guide\n").unwrap();
    fs::write(p.join("docbridge.config.json"), "{ edited").unwrap();
    let plan = plan_deinit(&p).unwrap();
    let shown = plan.to_string();
    assert!(shown.contains("Remove: docbridge.config.json"));
    assert!(shown.contains("Remove: .agents/skills/docbridge/SKILL.md"));
    assert!(shown.contains("manual"));
    let result = apply_deinit(&plan);
    assert_eq!(result.code, 1);
    assert!(result.stderr.contains("docbridge.config.json"));
    assert!(!p.join("docbridge.config.json").exists());
    assert!(!p.join(".agents/skills/docbridge/SKILL.md").exists());
    assert!(fs::read_to_string(p.join("guide.md"))
        .unwrap()
        .contains("@code"));
}
#[test]
fn code_examples_and_lookalikes_are_preserved_but_canonical_annotations_removed() {
    let p = initialized();
    let source = concat!(
        "<PRE class=\"example\">\n",
        "<!-- @code src/in_pre.rs -->\n",
        "</PRE>\n",
        "<code>\n",
        "<!-- @code src/in_code.rs -->\n",
        "</code>\n",
        "\n",
        "    <!-- @code src/indented.rs -->\n",
        "\n",
        "~~~html\n",
        "<!-- @code src/fenced.rs -->\n",
        "~~~\n",
        "<!-- ordinary\n",
        "<!-- @code src/comment.rs -->\n",
        "-->\n",
        "<!-- @codex src/lookalike.rs -->\n",
        "<!-- @code src/trailing.rs --> text\n",
        "<!-- @code src/valid.rs -->\n",
        "# Valid\n",
        "Paragraph\n",
        "<!-- @code src/interrupted.rs -->\n",
        "Interrupting text\n",
        "<!-- @code src/dangling.rs -->\n",
    );
    fs::write(p.join("guide.md"), source).unwrap();
    assert_eq!(deinit(&p).code, 0);
    let after = fs::read_to_string(p.join("guide.md")).unwrap();
    for kept in [
        "in_pre",
        "in_code",
        "indented",
        "fenced",
        "comment",
        "lookalike",
        "trailing",
    ] {
        assert!(
            after.contains(&format!("src/{kept}.rs")),
            "{kept} removed:\n{after}"
        );
    }
    for removed in ["valid", "interrupted", "dangling"] {
        assert!(
            !after.contains(&format!("src/{removed}.rs")),
            "{removed} kept:\n{after}"
        );
    }
}
#[test]
fn agent_instruction_references_are_reported() {
    let p = initialized();
    fs::write(p.join("AGENTS.md"), "Run docbridge check.\n").unwrap();
    fs::write(p.join("CLAUDE.md"), "Use DocBridge.\n").unwrap();
    fs::write(
        p.join(".claude/settings.json"),
        "{\"hooks\":\"docbridge validate\"}",
    )
    .unwrap();
    let plan = plan_deinit(&p).unwrap();
    for name in ["AGENTS.md", "CLAUDE.md", ".claude/settings.json"] {
        assert!(
            plan.references.iter().any(|r| r == name),
            "{name}: {:?}",
            plan.references
        );
    }
}
