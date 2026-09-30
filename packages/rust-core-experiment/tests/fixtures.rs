//! Runs every frozen Phase 0 case (`specified/` and `generated/`) through the
//! library and compares the output with `expected.json` as JSON values, which
//! normalizes object key order and nothing else.

use std::fs;
use std::path::{Path, PathBuf};

use docbridge_rust_core_experiment::{run, Phase0Input};

fn fixture_root() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR")).join("../../test-fixtures/phase0")
}

fn case_dirs(kind: &str) -> Vec<PathBuf> {
    let root = fixture_root().join(kind);
    let mut dirs: Vec<PathBuf> = fs::read_dir(&root)
        .unwrap_or_else(|error| panic!("read {}: {error}", root.display()))
        .map(|entry| entry.expect("directory entry").path())
        .filter(|path| path.is_dir())
        .collect();
    dirs.sort();
    dirs
}

fn assert_case(case_dir: &Path) {
    let input_text = fs::read_to_string(case_dir.join("input.json")).expect("input.json");
    let expected_text = fs::read_to_string(case_dir.join("expected.json")).expect("expected.json");
    let input: Phase0Input = serde_json::from_str(&input_text).expect("parse input.json");
    let expected: serde_json::Value =
        serde_json::from_str(&expected_text).expect("parse expected.json");
    let actual = serde_json::to_value(run(&input)).expect("serialize output");
    assert_eq!(actual, expected, "case {}", case_dir.display());
}

#[test]
fn specified_cases_match_their_hand_written_expectations() {
    let cases = case_dirs("specified");
    assert!(!cases.is_empty(), "no specified cases");
    for case_dir in cases {
        assert_case(&case_dir);
    }
}

#[test]
fn generated_cases_match_the_typescript_snapshots() {
    let cases = case_dirs("generated");
    assert!(!cases.is_empty(), "no generated cases");
    for case_dir in cases {
        assert_case(&case_dir);
    }
}
