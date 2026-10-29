use docbridge::config::{glob_matches, validate_path};

#[test]
fn globs_are_segment_local_recursive_and_case_sensitive() {
    for (pattern, path, expected) in [
        ("src/*.rs", "src/a.rs", true),
        ("src/*.rs", "src/nested/a.rs", false),
        ("**/*.rs", "a.rs", true),
        ("**/*.rs", "a/b/c.rs", true),
        ("a/**/b/*.rs", "a/b/c.rs", true),
        ("a/**/b/*.rs", "a/x/y/b/c.rs", true),
        ("src/*.rs", "src/a.RS", false),
        ("packages/*/src", "packages/a/src", true),
        ("src/a*b*c.rs", "src/axbyc.rs", true),
    ] {
        assert_eq!(glob_matches(pattern, path), expected, "{pattern}: {path}");
    }
}

#[test]
fn paths_reject_escape_and_legacy_symbols_but_allow_spaces_and_discovery_dot() {
    for path in [
        "",
        "/tmp/a",
        "../a",
        "a/../b",
        "a//b",
        "a/./b",
        "a\\b",
        "a#b",
        "C:/file",
        "src/.git/a",
        "a\0b",
    ] {
        assert!(validate_path(path, false).is_err(), "{path:?}");
    }
    assert!(validate_path("src/internal space.rs", false).is_ok());
    assert!(validate_path(".", true).is_ok());
    assert!(validate_path(".", false).is_err());
    for path in ["src/[ab]", "src/a?", "src/{a,b}", "src/a**b"] {
        assert!(validate_path(path, true).is_err());
    }
}
