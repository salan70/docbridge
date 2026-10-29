use super::*;
#[test]
fn alias_target_is_exact_and_relative() {
    assert!(exact_alias(Path::new("../.agents/skills")));
    #[cfg(windows)]
    assert!(exact_alias(Path::new(r"..\.agents\skills")));
    for target in [
        "../.agents/skills/",
        "../.agents/skills/.",
        "../../.agents/skills",
        "/.agents/skills",
        "../other/skills",
    ] {
        assert!(!exact_alias(Path::new(target)), "{target}");
    }
}
fn write(root: &Path, p: &str, s: &str) {
    let p = root.join(p);
    fs::create_dir_all(p.parent().unwrap()).unwrap();
    fs::write(p, s).unwrap();
}
fn fixture() -> tempfile::TempDir {
    let d = tempfile::tempdir().unwrap();
    write(
        d.path(),
        ".agents/skills/docbridge/SKILL.md",
        "managed skill",
    );
    write(
        d.path(),
        ".agents/skills/docbridge/.docbridge-owned.json",
        "{}",
    );
    write(
        d.path(),
        ".agents/skills/git-workflow/SKILL.md",
        "docs/contributing/README.md#verification",
    );
    write(d.path(), "docs/contributing/README.md", "workflow");
    write(d.path(),"AGENTS.md","docs/contributing/README.md#verification\ndocs/contributing/README.md#git-and-pull-requests\ndocs/contributing/README.md#documentation");
    fs::create_dir_all(d.path().join(".claude")).unwrap();
    d
}
#[cfg(unix)]
fn link(target: &Path, path: &Path) -> std::io::Result<()> {
    std::os::unix::fs::symlink(target, path)
}
#[cfg(windows)]
fn link(target: &Path, path: &Path) -> std::io::Result<()> {
    std::os::windows::fs::symlink_dir(target, path)
}
fn unlink_directory(path: &Path) {
    #[cfg(unix)]
    fs::remove_file(path).unwrap();
    #[cfg(windows)]
    fs::remove_dir(path).unwrap();
}
#[test]
fn canonical_layout_and_all_shell_fixture_rejections() {
    let d = fixture();
    let root = d.path();
    link(Path::new("../.agents/skills"), &root.join(".claude/skills")).expect(
        "agent fixtures require OS symlink support (Windows Developer Mode or symlink privilege)",
    );
    assert!(agent(root).is_ok());
    let workflow = root.join(".agents/skills/git-workflow");
    let saved = root.join("saved-workflow");
    fs::rename(&workflow, &saved).unwrap();
    assert!(agent(root).is_err());
    link(&saved, &workflow).unwrap();
    assert!(agent(root).is_err());
    unlink_directory(&workflow);
    fs::rename(&saved, &workflow).unwrap();
    for name in ["obsolete", "tdd", ".hidden"] {
        fs::create_dir(root.join(".agents/skills").join(name)).unwrap();
        assert!(agent(root).is_err());
        fs::remove_dir(root.join(".agents/skills").join(name)).unwrap();
    }
    let alias_path = root.join(".claude/skills");
    unlink_directory(&alias_path);
    assert!(agent(root).is_err());
    fs::write(&alias_path, "../.agents/skills\n").unwrap();
    assert!(agent(root).is_err());
    fs::remove_file(&alias_path).unwrap();
    fs::create_dir(&alias_path).unwrap();
    assert!(agent(root).is_err());
    fs::remove_dir(&alias_path).unwrap();
    for target in [
        root.join(".agents/skills"),
        "../.agents/skills/".into(),
        "../outside".into(),
        "../../outside".into(),
    ] {
        link(&target, &alias_path).unwrap();
        assert!(agent(root).is_err(), "accepted {}", target.display());
        unlink_directory(&alias_path);
    }
    link(Path::new("../.agents/skills"), &alias_path).unwrap();
    assert!(agent(root).is_ok());
    write(root, "CLAUDE.md", "");
    assert!(agent(root).is_err());
    fs::remove_file(root.join("CLAUDE.md")).unwrap();
    for p in [
        ".agents/skills/docbridge/.docbridge-owned.json",
        "docs/contributing/README.md",
        ".agents/skills/docbridge/SKILL.md",
    ] {
        let original = read(&root.join(p)).unwrap();
        fs::remove_file(root.join(p)).unwrap();
        assert!(agent(root).is_err());
        write(root, p, "");
        assert!(agent(root).is_err());
        write(root, p, &original);
    }
    let original = read(&root.join("AGENTS.md")).unwrap();
    write(root, "AGENTS.md", "# Agent rules");
    assert!(agent(root).is_err());
    write(root, "AGENTS.md", &original);
    for retired in [
        "docs/contributing/testing.md",
        "concise-writing",
        "grill-me",
        "pr-review",
        "review-response",
    ] {
        write(
            root,
            ".agents/skills/git-workflow/SKILL.md",
            &format!("docs/contributing/README.md#verification\n{retired}"),
        );
        assert!(agent(root).is_err());
    }
}
#[test]
fn canonical_tree_cannot_be_a_symlink() {
    let d = fixture();
    let root = d.path();
    let p = root.join(".agents/skills");
    let saved = root.join("saved");
    fs::rename(&p, &saved).unwrap();
    link(&saved, &p).expect("agent fixtures require OS symlink support");
    assert!(agent(root).is_err());
}
#[test]
fn publisher_preserves_every_pattern_and_yaml_exemption() {
    let d = tempfile::tempdir().unwrap();
    assert!(publisher(d.path()).is_ok());
    for pattern in [
        "npm publish",
        "npm\t publish --access public",
        "run: 'npm publish'",
        "prefixnpm publishSuffix",
        "gh release create",
        "gh\t release upload",
        "gh release edit --latest",
        "uses: softprops/action-gh-release@v2",
        "POST /releases",
        "/releases?per_page=1",
        "/releases1",
        "/releases.",
    ] {
        for ext in ["yml", "yaml"] {
            let p = d.path().join(format!("legacy.{ext}"));
            fs::write(&p, pattern).unwrap();
            assert!(publisher(d.path()).is_err(), "missed {pattern}");
            fs::remove_file(p).unwrap();
        }
    }
    fs::write(d.path().join("release-vnext.yml"), "npm publish").unwrap();
    fs::write(d.path().join("ignored.txt"), "gh release create").unwrap();
    assert!(publisher(d.path()).is_ok());
    fs::write(d.path().join("release-vnext.yaml"), "npm publish").unwrap();
    assert!(publisher(d.path()).is_err());
}
#[test]
fn publisher_allows_nonpublishing_release_urls() {
    let d = tempfile::tempdir().unwrap();
    for s in [
        "/releases/latest",
        "/releases-download",
        "/releases_notes",
        "/releasesabc",
        "npm install",
        "gh release view",
    ] {
        fs::write(d.path().join("ci.yml"), s).unwrap();
        assert!(publisher(d.path()).is_ok(), "{s}");
    }
    assert!(publisher(&d.path().join("missing")).is_err());
}
