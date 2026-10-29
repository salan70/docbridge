use docbridge::lifecycle::*;
use std::fs;
use tempfile::TempDir;
// These tests call the library, so a bare temporary directory is enough.
fn root() -> TempDir {
    tempfile::tempdir().unwrap()
}
fn initialized() -> TempDir {
    let temp = root();
    fs::write(temp.path().join("guide.md"), "# Guide\n").unwrap();
    let result = init(
        temp.path(),
        &InitOptions {
            yes: true,
            claude: true,
            ..Default::default()
        },
    );
    assert_eq!(result.code, 0, "{}", result.stderr);
    temp
}
#[test]
fn malformed_annotations_are_preserved() {
    let temp = initialized();
    let p = temp.path();
    let source = "<!-- @code ../escape.rs -->\n# Invalid\n<!-- @code src/a.rs -->\n# Valid\n```md\n<!-- @code example.rs -->\n```\n<!-- ordinary\n<!-- @code nested.rs -->\n-->\n";
    fs::write(p.join("guide.md"), source).unwrap();
    let plan = plan_deinit(p).unwrap();
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
    let temp = initialized();
    let p = temp.path();
    let skill = p.join(".agents/skills/docbridge/SKILL.md");
    fs::write(&skill, "my edits").unwrap();
    fs::write(p.join(".agents/skills/docbridge/extra.txt"), "extra").unwrap();
    let plan = plan_deinit(p).unwrap();
    assert!(plan.to_string().contains("modified"));
    assert_eq!(apply_deinit(&plan).code, 0);
    assert_eq!(fs::read_to_string(skill).unwrap(), "my edits");
    assert!(p.join(".agents/skills/docbridge/extra.txt").exists());
    assert!(!p.join(".claude/skills/docbridge/SKILL.md").exists());
}
#[test]
fn unmanaged_skill_blocks_force_and_inspection_never_writes() {
    let temp = root();
    let p = temp.path();
    fs::create_dir_all(p.join(".agents/skills/docbridge")).unwrap();
    fs::write(p.join(".agents/skills/docbridge/SKILL.md"), "mine").unwrap();
    assert_eq!(
        init(
            p,
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
    let temp = root();
    let p = temp.path();
    assert_eq!(init(p, &InitOptions::default()).code, 0);
    assert!(!p.join("docbridge.config.json").exists());
}
#[test]
fn stale_plan_cannot_partially_remove() {
    let temp = initialized();
    let p = temp.path();
    let plan = plan_deinit(p).unwrap();
    fs::write(p.join(".claude/skills/docbridge/SKILL.md"), "new edit").unwrap();
    let result = apply_deinit(&plan);
    assert_eq!(result.code, 1);
    assert!(result.stderr.contains("stale"));
    assert!(p.join("docbridge.config.json").exists());
    assert!(p.join(".agents/skills/docbridge/SKILL.md").exists());
}
#[test]
fn force_changes_only_owned_skill_and_preserves_extras() {
    let temp = initialized();
    let p = temp.path();
    fs::write(p.join(".agents/skills/docbridge/SKILL.md"), "edited").unwrap();
    fs::write(p.join(".agents/skills/docbridge/extra"), "mine").unwrap();
    let before = fs::read(p.join("docbridge.config.json")).unwrap();
    assert_eq!(
        init(
            p,
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
    let temp = initialized();
    let p = temp.path();
    fs::write(
        p.join(".agents/skills/docbridge/.docbridge-owned.json"),
        format!("{{\"../outside\":\"{}\"}}", "0".repeat(64)),
    )
    .unwrap();
    assert!(plan_deinit(p).is_err());
    assert!(p.join("docbridge.config.json").exists());
}
#[test]
fn references_are_reported_and_never_rewritten() {
    let temp = initialized();
    let p = temp.path();
    fs::create_dir_all(p.join(".github/workflows")).unwrap();
    fs::write(
        p.join(".github/workflows/check.yml"),
        "run: docbridge validate\n",
    )
    .unwrap();
    fs::write(p.join("flake.nix"), "docbridge").unwrap();
    let plan = plan_deinit(p).unwrap();
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
    let temp = root();
    let p = temp.path();
    let outside_temp = root();
    let outside = outside_temp.path();
    symlink(outside, p.join(".agents")).unwrap();
    assert_eq!(
        init(
            p,
            &InitOptions {
                yes: true,
                ..Default::default()
            }
        )
        .code,
        1
    );
    assert!(!p.join("docbridge.config.json").exists());
    assert!(plan_deinit(p).is_err());
    assert_eq!(fs::read_dir(outside).unwrap().count(), 0);
}
#[cfg(unix)]
#[test]
fn out_of_scope_symlinks_are_not_followed() {
    use std::os::unix::fs::symlink;
    let temp = initialized();
    let p = temp.path();
    let outside_temp = root();
    let outside = outside_temp.path();
    fs::write(
        outside.join("secret.md"),
        "<!-- @code secret.rs -->\n# Secret\n",
    )
    .unwrap();
    symlink(outside, p.join("excluded")).unwrap();
    let plan = plan_deinit(p).unwrap();
    assert_eq!(apply_deinit(&plan).code, 0);
    assert!(fs::read_to_string(outside.join("secret.md"))
        .unwrap()
        .contains("@code"));
}
#[cfg(unix)]
#[test]
fn deinit_rerun_finishes_after_partial_failure() {
    use std::os::unix::fs::PermissionsExt;
    let temp = initialized();
    let p = temp.path();
    fs::write(p.join("guide.md"), "<!-- @code src/a.rs -->\n# Guide\n").unwrap();
    let dir = p.join(".agents/skills/docbridge");
    let plan = plan_deinit(p).unwrap();
    fs::set_permissions(&dir, fs::Permissions::from_mode(0o500)).unwrap();
    let failed = apply_deinit(&plan);
    fs::set_permissions(&dir, fs::Permissions::from_mode(0o700)).unwrap();
    assert_eq!(failed.code, 1);
    assert!(
        failed.stderr.contains("Changed: guide.md\n"),
        "{}",
        failed.stderr
    );
    assert!(
        failed
            .stderr
            .contains("Not changed: .agents/skills/docbridge/SKILL.md, "),
        "{}",
        failed.stderr
    );
    assert!(p.join("docbridge.config.json").exists());
    assert!(!p.read_dir().unwrap().any(|e| e
        .unwrap()
        .file_name()
        .to_string_lossy()
        .starts_with(".docbridge-")));
    let rerun = deinit(p);
    assert_eq!(rerun.code, 0, "{}", rerun.stderr);
    assert_eq!(fs::read_to_string(p.join("guide.md")).unwrap(), "# Guide\n");
    assert!(!p.join("docbridge.config.json").exists());
    assert!(!p.join(".agents/skills/docbridge").exists());
    assert!(!p.join(".claude/skills/docbridge").exists());
}
#[cfg(unix)]
#[test]
fn deinit_rerun_removes_skill_directories_after_late_failure() {
    use std::os::unix::fs::PermissionsExt;
    let temp = initialized();
    let p = temp.path();
    let plan = plan_deinit(p).unwrap();
    // Only the configuration, removed last, lives directly in the root.
    fs::set_permissions(p, fs::Permissions::from_mode(0o500)).unwrap();
    let failed = apply_deinit(&plan);
    fs::set_permissions(p, fs::Permissions::from_mode(0o700)).unwrap();
    assert_eq!(failed.code, 1);
    assert!(
        failed
            .stderr
            .contains("Not changed: docbridge.config.json\n"),
        "{}",
        failed.stderr
    );
    assert!(!p
        .join(".agents/skills/docbridge/.docbridge-owned.json")
        .exists());
    let rerun = deinit(p);
    assert_eq!(rerun.code, 0, "{}", rerun.stderr);
    assert!(!p.join("docbridge.config.json").exists());
    assert!(!p.join(".agents/skills/docbridge").exists());
    assert!(!p.join(".claude/skills/docbridge").exists());
}
#[cfg(unix)]
#[test]
fn init_rerun_finishes_after_partial_failure() {
    use std::os::unix::fs::PermissionsExt;
    let temp = root();
    let p = temp.path();
    let dir = p.join(".agents/skills/docbridge");
    fs::create_dir_all(&dir).unwrap();
    let options = InitOptions {
        yes: true,
        ..Default::default()
    };
    fs::set_permissions(&dir, fs::Permissions::from_mode(0o500)).unwrap();
    let failed = init(p, &options);
    fs::set_permissions(&dir, fs::Permissions::from_mode(0o700)).unwrap();
    assert_eq!(failed.code, 1);
    assert!(
        failed.stderr.contains("Changed: docbridge.config.json\n"),
        "{}",
        failed.stderr
    );
    assert!(failed.stderr.contains("Not changed: "), "{}", failed.stderr);
    let rerun = init(p, &options);
    assert_eq!(rerun.code, 0, "{}", rerun.stderr);
    assert!(dir.join("SKILL.md").is_file());
    assert!(dir.join(".docbridge-owned.json").is_file());
    assert_eq!(deinit(p).code, 0);
    assert!(!dir.exists());
}
#[test]
fn init_rerun_removes_leftover_temporary_file_from_interrupted_write() {
    let temp = root();
    let p = temp.path();
    let dir = p.join(".agents/skills/docbridge");
    fs::create_dir_all(&dir).unwrap();
    // The first run stopped after creating the ownership record's temporary
    // file and before renaming it.
    let leftover = ".docbridge-tmp-4242-1761700000000000000-0";
    fs::write(dir.join(leftover), "{\"SKILL.md\":").unwrap();
    let rerun = init(
        p,
        &InitOptions {
            yes: true,
            ..Default::default()
        },
    );
    assert_eq!(rerun.code, 0, "{}", rerun.stderr);
    assert!(
        rerun
            .stdout
            .contains(&format!(".agents/skills/docbridge/{leftover}")),
        "{}",
        rerun.stdout
    );
    assert!(!dir.join(leftover).exists());
    assert!(dir.join("SKILL.md").is_file());
    assert!(dir.join(".docbridge-owned.json").is_file());
}
#[test]
fn deinit_removes_leftover_temporary_files() {
    let temp = initialized();
    let p = temp.path();
    let agents = p.join(".agents/skills/docbridge");
    let claude = p.join(".claude/skills/docbridge");
    fs::write(agents.join(".docbridge-tmp-1-2-3"), "partial").unwrap();
    // An interrupted init left only a temporary file in this directory.
    fs::remove_file(claude.join("SKILL.md")).unwrap();
    fs::remove_file(claude.join(".docbridge-owned.json")).unwrap();
    fs::write(claude.join(".docbridge-tmp-4-5-6"), "partial").unwrap();
    let plan = plan_deinit(p).unwrap();
    assert!(
        plan.to_string()
            .contains("Remove: .agents/skills/docbridge/.docbridge-tmp-1-2-3\n"),
        "{plan}"
    );
    let result = apply_deinit(&plan);
    assert_eq!(result.code, 0, "{}", result.stderr);
    assert!(!agents.exists());
    assert!(!claude.exists());
}
#[test]
fn temporary_file_lookalikes_remain_user_content() {
    let names = [
        ".docbridge-tmp-notes",
        ".docbridge-tmp-1-2",
        ".docbridge-tmp-1-2-3.md",
    ];
    let temp = initialized();
    let p = temp.path();
    let dir = p.join(".agents/skills/docbridge");
    for name in names {
        fs::write(dir.join(name), "mine").unwrap();
    }
    assert_eq!(deinit(p).code, 0);
    let again = init(
        p,
        &InitOptions {
            yes: true,
            force: true,
            ..Default::default()
        },
    );
    assert_eq!(again.code, 1, "{}", again.stdout);
    assert!(
        again.stderr.contains("unmanaged skill conflict"),
        "{}",
        again.stderr
    );
    for name in names {
        assert_eq!(fs::read_to_string(dir.join(name)).unwrap(), "mine");
    }
}
#[test]
fn temporary_name_directory_remains_user_content() {
    let temp = initialized();
    let p = temp.path();
    let dir = p.join(".agents/skills/docbridge/.docbridge-tmp-7-8-9");
    fs::create_dir_all(&dir).unwrap();
    fs::write(dir.join("notes.md"), "mine").unwrap();
    assert_eq!(deinit(p).code, 0);
    assert_eq!(fs::read_to_string(dir.join("notes.md")).unwrap(), "mine");
}
#[test]
fn recorded_file_with_temporary_name_follows_its_ownership_hash() {
    let name = ".docbridge-tmp-1-2-3";
    let remove = format!("Remove: .agents/skills/docbridge/{name}\n");
    let unedited_temp = initialized();
    let unedited = unedited_temp.path();
    add_owned(&unedited.join(".agents/skills/docbridge"), name, "owned");
    let plan = plan_deinit(unedited).unwrap();
    assert_eq!(plan.to_string().matches(&remove).count(), 1, "{plan}");
    assert_eq!(apply_deinit(&plan).code, 0);
    assert!(!unedited.join(".agents/skills/docbridge").exists());

    let edited_temp = initialized();
    let edited = edited_temp.path();
    let file = edited.join(".agents/skills/docbridge").join(name);
    add_owned(&edited.join(".agents/skills/docbridge"), name, "owned");
    fs::write(&file, "my edits").unwrap();
    let reinit = init(
        edited,
        &InitOptions {
            yes: true,
            ..Default::default()
        },
    );
    assert_eq!(reinit.code, 0, "{}", reinit.stderr);
    assert_eq!(fs::read_to_string(&file).unwrap(), "my edits");
    let plan = plan_deinit(edited).unwrap();
    assert!(!plan.to_string().contains(&remove), "{plan}");
    assert_eq!(apply_deinit(&plan).code, 0);
    assert_eq!(fs::read_to_string(&file).unwrap(), "my edits");
}
/// Write `content` to `name` under the skill directory `dir` and record it as owned.
fn add_owned(dir: &std::path::Path, name: &str, content: &str) {
    use sha2::{Digest, Sha256};
    let path = dir.join(name);
    fs::create_dir_all(path.parent().unwrap()).unwrap();
    fs::write(&path, content).unwrap();
    let marker = dir.join(".docbridge-owned.json");
    let mut record: serde_json::Map<String, serde_json::Value> =
        serde_json::from_slice(&fs::read(&marker).unwrap()).unwrap();
    record.insert(name.into(), format!("{:x}", Sha256::digest(content)).into());
    fs::write(&marker, serde_json::to_vec(&record).unwrap()).unwrap();
}
#[cfg(unix)]
#[test]
fn deinit_rerun_removes_nested_owned_directories_after_late_failure() {
    use std::os::unix::fs::PermissionsExt;
    let temp = initialized();
    let p = temp.path();
    let dir = p.join(".agents/skills/docbridge");
    add_owned(&dir, "support/helper.md", "helper");
    let plan = plan_deinit(p).unwrap();
    // Only the configuration, removed last, lives directly in the root.
    fs::set_permissions(p, fs::Permissions::from_mode(0o500)).unwrap();
    let failed = apply_deinit(&plan);
    fs::set_permissions(p, fs::Permissions::from_mode(0o700)).unwrap();
    assert_eq!(failed.code, 1);
    assert!(
        failed
            .stderr
            .contains("Not changed: docbridge.config.json\n"),
        "{}",
        failed.stderr
    );
    let rerun = deinit(p);
    assert_eq!(rerun.code, 0, "{}", rerun.stderr);
    assert!(!dir.exists());
    let again = init(
        p,
        &InitOptions {
            yes: true,
            ..Default::default()
        },
    );
    assert_eq!(again.code, 0, "{}", again.stderr);
}
#[test]
fn deinit_removes_owned_directories_whose_files_are_already_gone() {
    let temp = initialized();
    let p = temp.path();
    let dir = p.join(".agents/skills/docbridge");
    add_owned(&dir, "support/deep/helper.md", "helper");
    // A run stopped after removing the file and before its directories.
    fs::remove_file(dir.join("support/deep/helper.md")).unwrap();
    let result = deinit(p);
    assert_eq!(result.code, 0, "{}", result.stderr);
    assert!(!dir.exists());
}
#[cfg(unix)]
#[test]
fn failed_directory_removal_is_reported_and_rerun_finishes() {
    use std::os::unix::fs::PermissionsExt;
    let temp = initialized();
    let p = temp.path();
    let skills = p.join(".claude/skills");
    let plan = plan_deinit(p).unwrap();
    // The skill directory's files can be removed, but not the directory.
    fs::set_permissions(&skills, fs::Permissions::from_mode(0o500)).unwrap();
    let failed = apply_deinit(&plan);
    fs::set_permissions(&skills, fs::Permissions::from_mode(0o700)).unwrap();
    assert_eq!(failed.code, 1, "{}", failed.stdout);
    assert!(
        failed
            .stderr
            .contains("Not changed: .claude/skills/docbridge, docbridge.config.json\n"),
        "{}",
        failed.stderr
    );
    let rerun = deinit(p);
    assert_eq!(rerun.code, 0, "{}", rerun.stderr);
    assert!(!p.join(".claude/skills/docbridge").exists());
    assert!(!p.join("docbridge.config.json").exists());
}
#[test]
fn dry_run_and_existing_config() {
    let temp = root();
    let p = temp.path();
    assert_eq!(
        init(
            p,
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
            p,
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
#[cfg(unix)]
fn write_config(p: &std::path::Path, docs: &str) {
    fs::write(
        p.join("docbridge.config.json"),
        format!("{{\"include\":{{\"code\":{{\"paths\":[\"src\"],\"extensions\":[\".rs\"]}},\"docs\":{docs}}}}}"),
    )
    .unwrap();
}
#[test]
fn init_deinit_init_round_trip_succeeds() {
    let temp = initialized();
    let p = temp.path();
    let result = deinit(p);
    assert_eq!(result.code, 0, "{}", result.stderr);
    assert!(!p.join(".agents/skills/docbridge").exists());
    assert!(!p.join(".claude/skills/docbridge").exists());
    let again = init(
        p,
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
    let temp = root();
    let p = temp.path();
    fs::create_dir_all(p.join(".agents/skills/docbridge")).unwrap();
    let result = init(
        p,
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
    let temp = initialized();
    let p = temp.path();
    fs::write(p.join(".agents/skills/docbridge/notes.txt"), "mine").unwrap();
    assert_eq!(deinit(p).code, 0);
    assert_eq!(
        fs::read_to_string(p.join(".agents/skills/docbridge/notes.txt")).unwrap(),
        "mine"
    );
    assert!(!p.join(".claude/skills/docbridge").exists());
}
#[cfg(unix)]
#[test]
fn rewrite_replaces_atomically_preserving_permissions_and_new_files_use_defaults() {
    use std::os::unix::fs::{MetadataExt, PermissionsExt};
    let temp = initialized();
    let p = temp.path();
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
    // A hard link keeps the original inode, so an in-place write would show through it.
    fs::hard_link(p.join("guide.md"), p.join("guide.link")).unwrap();
    assert_eq!(deinit(p).code, 0);
    assert_eq!(fs::read_to_string(p.join("guide.md")).unwrap(), "# Guide\n");
    assert_eq!(mode(p.join("guide.md")), 0o755);
    assert_eq!(
        fs::read_to_string(p.join("guide.link")).unwrap(),
        "<!-- @code src/a.rs -->\n# Guide\n"
    );
    assert_ne!(
        fs::metadata(p.join("guide.md")).unwrap().ino(),
        fs::metadata(p.join("guide.link")).unwrap().ino()
    );
}
#[cfg(unix)]
#[test]
fn init_discovery_skips_and_reports_symlinks() {
    use std::os::unix::fs::symlink;
    let temp = root();
    let p = temp.path();
    fs::create_dir_all(p.join("node_modules/.bin")).unwrap();
    fs::write(p.join("node_modules/tool.js"), "x").unwrap();
    symlink("../tool.js", p.join("node_modules/.bin/tool")).unwrap();
    let result = init(
        p,
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
    let temp = initialized();
    let p = temp.path();
    let outside_temp = root();
    let outside = outside_temp.path();
    fs::write(outside.join("run.sh"), "docbridge validate").unwrap();
    fs::create_dir_all(p.join("scripts")).unwrap();
    symlink(outside.join("run.sh"), p.join("scripts/run.sh")).unwrap();
    let plan = plan_deinit(p).unwrap();
    assert!(plan.to_string().contains("scripts/run.sh"));
    assert!(plan.references.is_empty());
    assert_eq!(apply_deinit(&plan).code, 0);
}
#[cfg(unix)]
#[test]
fn symlinked_managed_doc_makes_cleanup_incomplete() {
    use std::os::unix::fs::symlink;
    let temp = initialized();
    let p = temp.path();
    let outside_temp = root();
    let outside = outside_temp.path();
    fs::write(
        outside.join("linked.md"),
        "<!-- @code src/a.rs -->\n# Linked\n",
    )
    .unwrap();
    fs::create_dir_all(p.join("docs")).unwrap();
    symlink(outside.join("linked.md"), p.join("docs/linked.md")).unwrap();
    write_config(p, "[\"docs\"]");
    let plan = plan_deinit(p).unwrap();
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
    let temp = initialized();
    let p = temp.path();
    fs::write(p.join("guide.md"), "<!-- @code src/a.rs -->\n# Guide\n").unwrap();
    fs::write(p.join("docbridge.config.json"), "{ edited").unwrap();
    let plan = plan_deinit(p).unwrap();
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
    let temp = initialized();
    let p = temp.path();
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
    assert_eq!(deinit(p).code, 0);
    let after = fs::read_to_string(p.join("guide.md")).unwrap();
    for kept in [
        "in_pre",
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
    // `<code>` is inline HTML, not a CommonMark type-1 block, so its line is an annotation.
    for removed in ["in_code", "valid", "interrupted", "dangling"] {
        assert!(
            !after.contains(&format!("src/{removed}.rs")),
            "{removed} kept:\n{after}"
        );
    }
}
#[test]
fn agent_instruction_references_are_reported() {
    let temp = initialized();
    let p = temp.path();
    fs::write(p.join("AGENTS.md"), "Run docbridge check.\n").unwrap();
    fs::write(p.join("CLAUDE.md"), "Use DocBridge.\n").unwrap();
    fs::write(
        p.join(".claude/settings.json"),
        "{\"hooks\":\"docbridge validate\"}",
    )
    .unwrap();
    let plan = plan_deinit(p).unwrap();
    for name in ["AGENTS.md", "CLAUDE.md", ".claude/settings.json"] {
        assert!(
            plan.references.iter().any(|r| r == name),
            "{name}: {:?}",
            plan.references
        );
    }
}
fn deinit_guide(source: &str) -> (Outcome, String, String) {
    let temp = initialized();
    let p = temp.path();
    fs::write(p.join("guide.md"), source).unwrap();
    let plan = plan_deinit(p).unwrap().to_string();
    let result = deinit(p);
    let after = fs::read_to_string(p.join("guide.md")).unwrap();
    (result, after, plan)
}
#[test]
fn html_block_regressions_preserve_examples_without_panicking() {
    for (source, line) in [
        ("<pre\n>\n<!-- @code src/example.rs -->\n</pre>\n", 3),
        (
            "<pre title=\"\n<!-- @code src/example.rs -->\n\">\nexample\n</pre>\n",
            2,
        ),
        (
            "Use <letter in prose\n<pre>\n<!-- @code src/example.rs -->\n</pre>\n",
            3,
        ),
    ] {
        let (result, after, plan) = deinit_guide(source);
        assert_eq!(result.code, 0, "{source:?}: {}", result.stderr);
        assert!(result.stdout.contains("Removal complete."));
        assert_eq!(after, source);
        let example = format!("guide.md:{line} (inside HTML block example)");
        assert!(plan.contains(&example), "{plan}");
    }
}
#[test]
fn closing_tag_ends_html_block_even_after_stray_quote() {
    let source = "<pre>\nUse <letter ' in prose\n</pre>\n<!-- @code src/real.rs -->\n# Real\n";
    let (result, after, plan) = deinit_guide(source);
    assert_eq!(result.code, 0, "{}", result.stderr);
    assert!(result.stdout.contains("Removal complete."));
    assert_eq!(after, "<pre>\nUse <letter ' in prose\n</pre>\n# Real\n");
    assert!(!plan.contains("example"), "{plan}");
}
#[test]
fn unterminated_html_block_annotation_makes_removal_incomplete() {
    let source = "<!-- @code src/real.rs -->\n# Real\n<pre>\n<!-- @code src/example.rs -->\n";
    let (result, after, plan) = deinit_guide(source);
    assert_eq!(result.code, 1);
    assert!(!result.stdout.contains("Removal complete."));
    assert!(result.stderr.contains("guide.md:4"), "{}", result.stderr);
    assert_eq!(after, "# Real\n<pre>\n<!-- @code src/example.rs -->\n");
    assert!(
        plan.contains("guide.md:4 (inside an unterminated HTML block, review manually)"),
        "{plan}"
    );
    assert!(!plan.contains("example)"), "{plan}");
}
#[test]
fn unterminated_html_block_without_annotations_is_complete() {
    let (result, after, _) = deinit_guide("<!-- @code src/a.rs -->\n# A\n<pre>\ntext\n");
    assert_eq!(result.code, 0, "{}", result.stderr);
    assert_eq!(after, "# A\n<pre>\ntext\n");
}
fn snapshot(dir: &std::path::Path) -> Vec<(String, Vec<u8>)> {
    fn visit(base: &std::path::Path, dir: &std::path::Path, out: &mut Vec<(String, Vec<u8>)>) {
        let mut entries: Vec<_> = fs::read_dir(dir)
            .unwrap()
            .map(|e| e.unwrap().path())
            .collect();
        entries.sort();
        for path in entries {
            let name = path
                .strip_prefix(base)
                .unwrap()
                .to_string_lossy()
                .into_owned();
            if path.is_dir() {
                out.push((format!("{name}/"), Vec::new()));
                visit(base, &path, out);
            } else {
                out.push((name, fs::read(&path).unwrap()));
            }
        }
    }
    let mut out = Vec::new();
    visit(dir, dir, &mut out);
    out
}
#[test]
fn hook_and_script_references_are_reported_and_never_rewritten() {
    let temp = initialized();
    let p = temp.path();
    fs::create_dir_all(p.join(".githooks")).unwrap();
    fs::create_dir_all(p.join("scripts")).unwrap();
    let hook = "#!/bin/sh\ndocbridge validate\n";
    let script = "#!/bin/sh\ndocbridge validate --json\n";
    fs::write(p.join(".githooks/pre-commit"), hook).unwrap();
    fs::write(p.join("scripts/check.sh"), script).unwrap();
    let plan = plan_deinit(p).unwrap();
    let text = plan.to_string();
    for name in [".githooks/pre-commit", "scripts/check.sh"] {
        assert!(plan.references.iter().any(|r| r == name), "{name}");
        assert!(text.contains(&format!("Manual reference cleanup: {name}")));
    }
    assert_eq!(apply_deinit(&plan).code, 0);
    assert_eq!(
        fs::read_to_string(p.join(".githooks/pre-commit")).unwrap(),
        hook
    );
    assert_eq!(
        fs::read_to_string(p.join("scripts/check.sh")).unwrap(),
        script
    );
}
#[test]
fn skill_locations_default_agents_and_optional_claude() {
    let temp = root();
    let p = temp.path();
    let result = init(
        p,
        &InitOptions {
            yes: true,
            ..Default::default()
        },
    );
    assert_eq!(result.code, 0, "{}", result.stderr);
    assert!(p.join(".agents/skills/docbridge/SKILL.md").is_file());
    assert!(!p.join(".claude/skills/docbridge").exists());
    let q_temp = initialized();
    let q = q_temp.path();
    let agents = fs::read(q.join(".agents/skills/docbridge/SKILL.md")).unwrap();
    let claude = fs::read(q.join(".claude/skills/docbridge/SKILL.md")).unwrap();
    assert_eq!(agents, claude);
}
#[test]
fn declined_confirmation_leaves_project_byte_identical() {
    let temp = initialized();
    let p = temp.path();
    fs::write(p.join("guide.md"), "<!-- @code src/a.rs -->\n# Guide\n").unwrap();
    fs::create_dir_all(p.join(".githooks")).unwrap();
    fs::write(p.join(".githooks/pre-commit"), "docbridge validate\n").unwrap();
    let before = snapshot(p);
    let invocation = docbridge::cli::Invocation::parse(&["deinit".into()], p).unwrap();
    let mut asked = false;
    let result = docbridge::cli::dispatch_with_confirmation(invocation, "", |plan| {
        asked = true;
        assert!(plan.contains("guide.md"));
        false
    });
    assert!(asked);
    assert_ne!(result.exit_code, 0, "{}", result.stdout);
    assert_eq!(snapshot(p), before);
}
#[test]
fn embedded_skill_names_current_commands_only() {
    let temp = initialized();
    let p = temp.path();
    let text = fs::read_to_string(p.join(".agents/skills/docbridge/SKILL.md")).unwrap();
    for word in ["validate", "links", "unlinked", "docs"] {
        assert!(text.contains(&format!("docbridge {word}")), "{word}");
    }
    let lower = text.to_lowercase();
    for old in ["check", "related", "context", "graph", "lsp"] {
        assert!(
            !lower
                .split(|c: char| !c.is_alphanumeric())
                .any(|w| w == old),
            "{old}"
        );
    }
}
