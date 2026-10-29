mod common;

use common::Project;
use serde_json::Value;

fn project(config: &str) -> Project {
    let p = Project::new();
    p.write("docbridge.config.json", config);
    p
}

const CONFIG: &str =
    r#"{"include":{"code":{"paths":["src"],"extensions":[".rs"]},"docs":["docs"]}}"#;

fn region_lines(v: &Value, id: &str) -> Vec<(u64, u64)> {
    fn find<'a>(nodes: &'a Value, id: &str) -> Option<&'a Value> {
        for n in nodes.as_array()? {
            if n["id"] == id {
                return Some(n);
            }
            if let Some(f) = find(&n["children"], id) {
                return Some(f);
            }
        }
        None
    }
    let node = find(&v["nodes"], id).unwrap_or_else(|| panic!("{id} in {v}"));
    node["regions"]
        .as_array()
        .unwrap()
        .iter()
        .map(|r| {
            (
                r["start_line"].as_u64().unwrap(),
                r["end_line"].as_u64().unwrap(),
            )
        })
        .collect()
}

#[test]
fn unlinked_parent_excludes_child_annotation_lines() {
    for nl in ["\n", "\r\n"] {
        let p = project(CONFIG);
        p.write("src/a.rs", "a");
        p.write("src/b.rs", "b");
        let doc = [
            "# Top",
            "intro",
            "<!-- @code src/a.rs -->",
            "<!-- @code src/b.rs -->",
            "",
            "## Child",
            "body",
            "## Sibling",
            "sib",
            "<!-- @code src/a.rs -->",
            "### Deep",
            "deep",
            "",
        ]
        .join(nl);
        p.write("docs/a.md", &doc);
        let (_, v) = p.json(&["unlinked", "--json"]);
        assert_eq!(
            region_lines(&v, "docs/a.md#top"),
            vec![(1, 2), (8, 9)],
            "{nl:?}"
        );
        assert_eq!(
            region_lines(&v, "docs/a.md#top/sibling"),
            vec![(8, 9)],
            "{nl:?}"
        );
    }
    let p = project(CONFIG);
    p.write("src/a.rs", "a");
    p.write(
        "docs/a.md",
        "# Top\n<!-- @code src/a.rs -->\n## Child\nbody",
    );
    let (_, v) = p.json(&["unlinked", "--json"]);
    assert_eq!(region_lines(&v, "docs/a.md#top"), vec![(1, 1)]);
}

#[test]
fn links_range_still_includes_annotation_lines_of_a_linked_parent() {
    let p = project(CONFIG);
    p.write("src/a.rs", "a");
    p.write(
        "docs/a.md",
        "# Top\n<!-- @code src/a.rs -->\n## Child\nbody",
    );
    let (_, v) = p.json(&["links", "docs/a.md#top", "--json", "--include-content"]);
    assert!(v.to_string().contains("## Child"), "{v}");
}

#[test]
fn exclude_object_may_omit_code_but_unknown_keys_fail() {
    let ok =
        r#"{"include":{"code":{"paths":["src"],"extensions":[".rs"]},"docs":[]},"exclude":{}}"#;
    let p = project(ok);
    p.write("src/a.rs", "a");
    assert!(p.json(&["unlinked", "--json"]).1["complete"] == true);
    let bad = r#"{"include":{"code":{"paths":["src"],"extensions":[".rs"]},"docs":[]},"exclude":{"x":[]}}"#;
    let p = project(bad);
    assert_eq!(p.run(&["unlinked", "--json"]).status.code(), Some(1));
}

#[test]
fn drive_prefixes_are_rejected_but_unix_colons_are_allowed() {
    use docbridge::config::validate_path;
    for path in ["C:/x", "C:foo", "z:"] {
        assert!(validate_path(path, false).is_err(), "{path}");
        assert!(validate_path(path, true).is_err(), "{path}");
    }
    assert_eq!(validate_path("src/c:d.rs", false).is_ok(), cfg!(unix));
}

#[test]
fn discovery_roots_recurse_while_links_globs_select_files() {
    let p =
        project(r#"{"include":{"code":{"paths":["pkg/*"],"extensions":[".rs"]},"docs":["docs"]}}"#);
    p.write("pkg/a/deep/x.rs", "x");
    p.write("pkg/a/y.rs", "y");
    p.write("docs/a.md", "# T\n<!-- @code pkg/a/deep/x.rs -->\n## C\n");
    // The glob-matched directory pkg/a is a root: descendants are discovered.
    let (_, v) = p.json(&["unlinked", "--json"]);
    assert!(v.to_string().contains("pkg/a/y.rs"), "{v}");
    assert!(!v.to_string().contains("pkg/a/deep/x.rs\""), "{v}");
    // The links glob selects files: `*` stays within one segment, `**` recurses.
    let (_, shallow) = p.json(&["links", "pkg/*/*.rs", "--json"]);
    assert!(
        !shallow.to_string().contains("pkg/a/deep/x.rs"),
        "{shallow}"
    );
    let (_, deep) = p.json(&["links", "pkg/**/*.rs", "--json"]);
    assert!(deep.to_string().contains("pkg/a/deep/x.rs"), "{deep}");
}
