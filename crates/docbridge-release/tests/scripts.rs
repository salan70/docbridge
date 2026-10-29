//! Workflow integration contracts for the Rust maintainer tools.
//! Tag/keygen behavior lives in the private injected-runner tests and
//! `operations_cli`; publisher fixtures and release-label tests live in xtask.
//! No test invokes a retired release shell script.
use std::{fs, path::Path};

#[test]
fn release_workflow_uses_the_fail_closed_rust_gates_before_publication() {
    let repo = Path::new(env!("CARGO_MANIFEST_DIR")).join("../..");
    let workflow = fs::read_to_string(repo.join(".github/workflows/release-vnext.yml")).unwrap();
    assert!(workflow.contains("-- publisher-gate .github/workflows"));
    assert!(workflow.contains(r#"docbridge-release tag check "$VERSION" "$GITHUB_SHA""#));
    assert!(workflow.contains(r#"docbridge-release tag ensure "$VERSION" "$GITHUB_SHA""#));
    // The operation distinguishes a failed lookup from an absent ref.
    assert!(!workflow.contains("git ls-remote"));
    assert!(workflow.contains("secrets[vars.DOCBRIDGE_RELEASE_KEY_SECRET]"));
    let ensure = workflow
        .find("docbridge-release tag ensure")
        .expect("ensure");
    let publish = workflow.find("-F draft=false").expect("publish");
    assert!(ensure < publish);
}
