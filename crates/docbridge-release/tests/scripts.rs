//! Release shell scripts, run with stubbed `gh`, `git`, `cargo`, and `od` on PATH.
//! No test here touches GitHub, the network, or a real key.
#![cfg(unix)]
use std::{
    fs,
    os::unix::fs::{symlink, PermissionsExt},
    path::{Path, PathBuf},
    process::{Command, Output},
};

/// The dummy seed the stubbed `od` returns; it must never reach a log.
const SEED: &str = "101112131415161718191a1b1c1d1e1f202122232425262728292a2b2c2d2e2f";
const STAGED: &str = "DOCBRIDGE_RELEASE_SIGNING_KEY_NEXT_1";

fn repo() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR")).join("../..")
}
fn executable(path: &Path, body: &str) {
    fs::write(path, format!("#!/usr/bin/env bash\n{body}")).unwrap();
    fs::set_permissions(path, fs::Permissions::from_mode(0o755)).unwrap();
}
fn text(path: &Path) -> String {
    fs::read_to_string(path).unwrap_or_default()
}

/// A scratch checkout with the keygen script, a trusted-keys file, the real
/// `docbridge-release` binary where the script expects it, and PATH stubs.
struct Keygen {
    root: tempfile::TempDir,
}
impl Keygen {
    fn new(trusted: &str) -> Self {
        let root = tempfile::tempdir().unwrap();
        let r = root.path();
        fs::create_dir_all(r.join("scripts")).unwrap();
        fs::copy(
            repo().join("scripts/release-keygen.sh"),
            r.join("scripts/release-keygen.sh"),
        )
        .unwrap();
        fs::create_dir_all(r.join("crates/docbridge-update/keys")).unwrap();
        fs::write(
            r.join("crates/docbridge-update/keys/trusted-keys.txt"),
            trusted,
        )
        .unwrap();
        fs::create_dir_all(r.join(".tmp/rust-vnext/debug")).unwrap();
        symlink(
            env!("CARGO_BIN_EXE_docbridge-release"),
            r.join(".tmp/rust-vnext/debug/docbridge-release"),
        )
        .unwrap();
        fs::create_dir(r.join("bin")).unwrap();
        executable(&r.join("bin/cargo"), "exit 0\n");
        let od_bytes: Vec<String> = (0..32)
            .map(|i| format!("{:02x}", 0x10 + i))
            .collect::<Vec<_>>();
        executable(
            &r.join("bin/od"),
            &format!(
                "printf ' %s\\n' '{}' '{}'\n",
                od_bytes[..16].join(" "),
                od_bytes[16..].join(" ")
            ),
        );
        // gh: logs each call, captures stdin of `secret set`, lists the names in
        // secrets.txt, and fails the subcommand named in $GH_FAIL.
        executable(
            &r.join("bin/gh"),
            r#"dir="$(dirname "$0")"
printf '%s\n' "$*" >>"$dir/gh.log"
sub="$1-$2"
if [ "${GH_FAIL:-}" = "$sub" ]; then echo "gh: $sub failed" >&2; exit 1; fi
case "$sub" in
  secret-set) cat >"$dir/gh.stdin" ;;
  secret-list) cat "$dir/secrets.txt" 2>/dev/null || true ;;
esac
"#,
        );
        Keygen { root }
    }
    fn path(&self, rel: &str) -> PathBuf {
        self.root.path().join(rel)
    }
    fn run(&self, trace: &[&str], env: &[(&str, &str)], args: &[&str]) -> Output {
        let path = format!(
            "{}:{}",
            self.path("bin").display(),
            std::env::var("PATH").unwrap()
        );
        let mut command = Command::new("bash");
        command
            .args(trace)
            .arg(self.path("scripts/release-keygen.sh"))
            .args(args)
            .env("PATH", path)
            .env_remove("GH_FAIL")
            .stdin(std::process::Stdio::null());
        for (k, v) in env {
            command.env(k, v);
        }
        command.output().unwrap()
    }
    fn trusted(&self) -> String {
        text(&self.path("crates/docbridge-update/keys/trusted-keys.txt"))
    }
    fn gh_log(&self) -> String {
        text(&self.path("bin/gh.log"))
    }
}
fn assert_no_seed(out: &Output) {
    let all = format!(
        "{}{}",
        String::from_utf8_lossy(&out.stdout),
        String::from_utf8_lossy(&out.stderr)
    );
    assert!(!all.contains(SEED), "seed leaked:\n{all}");
    assert!(!all.contains("10 11 12 13"), "seed bytes leaked:\n{all}");
}
fn public_of_seed() -> String {
    let mut seed = [0u8; 32];
    hex::decode_to_slice(SEED, &mut seed).unwrap();
    hex::encode(
        ed25519_dalek::SigningKey::from_bytes(&seed)
            .verifying_key()
            .to_bytes(),
    )
}

#[test]
fn keygen_never_traces_the_seed_under_xtrace() {
    for (trace, env) in [
        (&["-x"][..], &[][..]),
        (&[][..], &[("SHELLOPTS", "xtrace")][..]),
        (&["-x"][..], &[("BASH_XTRACEFD", "2")][..]),
    ] {
        let keygen = Keygen::new("# keys\n");
        let out = keygen.run(trace, env, &["--role", "primary", "--key-id", "next-1"]);
        assert!(out.status.success(), "{trace:?} {env:?}: {out:?}");
        assert_no_seed(&out);
        assert_eq!(text(&keygen.path("bin/gh.stdin")), SEED);

        let backup = keygen.path("backup.key");
        let out = keygen.run(
            trace,
            env,
            &[
                "--role",
                "backup",
                "--key-id",
                "backup-1",
                "--backup-out",
                backup.to_str().unwrap(),
            ],
        );
        assert!(out.status.success(), "{out:?}");
        assert_no_seed(&out);
        assert_eq!(text(&backup).trim(), SEED);
    }
}

#[test]
fn staging_a_primary_key_never_touches_the_active_credentials() {
    let keygen = Keygen::new("# keys\n");
    let out = keygen.run(&[], &[], &["--role", "primary", "--key-id", "next-1"]);
    assert!(out.status.success(), "{out:?}");
    assert!(keygen
        .trusted()
        .ends_with(&format!("next-1 {}\n", public_of_seed())));
    let log = keygen.gh_log();
    assert!(
        log.contains(&format!(
            "secret set {STAGED} --env release --repo salan70/docbridge"
        )),
        "{log}"
    );
    assert!(!log.contains("variable set"), "{log}");
    assert!(!log.contains("DOCBRIDGE_RELEASE_SIGNING_KEY "), "{log}");
}

#[test]
fn a_failed_secret_upload_leaves_the_public_entry_and_active_credentials() {
    let keygen = Keygen::new("# keys\n");
    let out = keygen.run(
        &[],
        &[("GH_FAIL", "secret-set")],
        &["--role", "primary", "--key-id", "next-1"],
    );
    assert!(!out.status.success());
    assert_no_seed(&out);
    // The public entry is written first; the active key and ID are never touched.
    assert!(keygen.trusted().contains("next-1 "));
    assert!(!keygen.gh_log().contains("variable set"));
    assert!(String::from_utf8_lossy(&out.stderr).contains("remove the next-1 line"));
}

#[test]
fn staging_refuses_an_existing_or_unlistable_secret() {
    let keygen = Keygen::new("# keys\n");
    fs::write(keygen.path("bin/secrets.txt"), format!("{STAGED}\n")).unwrap();
    let out = keygen.run(&[], &[], &["--role", "primary", "--key-id", "next-1"]);
    assert!(!out.status.success());
    assert_eq!(keygen.trusted(), "# keys\n");
    assert!(!keygen.gh_log().contains("secret set"));

    let keygen = Keygen::new("# keys\n");
    let out = keygen.run(
        &[],
        &[("GH_FAIL", "secret-list")],
        &["--role", "primary", "--key-id", "next-1"],
    );
    assert!(!out.status.success());
    assert_eq!(keygen.trusted(), "# keys\n");
    assert!(!keygen.gh_log().contains("secret set"));
}

#[test]
fn staging_refuses_a_key_id_whose_secret_name_collides() {
    let keygen = Keygen::new(&format!("next.1 {}\n", "ab".repeat(32)));
    let out = keygen.run(&[], &[], &["--role", "primary", "--key-id", "next-1"]);
    assert!(!out.status.success());
    assert!(!keygen.gh_log().contains("secret set"));
}

#[test]
fn activation_switches_only_the_variables_to_a_staged_trusted_key() {
    let trusted = format!("next-1 {}\n", "ab".repeat(32));
    let keygen = Keygen::new(&trusted);
    fs::write(keygen.path("bin/secrets.txt"), format!("{STAGED}\n")).unwrap();
    let out = keygen.run(&["-x"], &[], &["--activate", "--key-id", "next-1"]);
    assert!(out.status.success(), "{out:?}");
    let log = keygen.gh_log();
    let secret_var = log
        .find(&format!(
            "variable set DOCBRIDGE_RELEASE_KEY_SECRET --env release --repo salan70/docbridge --body {STAGED}"
        ))
        .expect(&log);
    let id_var = log
        .find("variable set DOCBRIDGE_RELEASE_KEY_ID --env release --repo salan70/docbridge --body next-1")
        .expect(&log);
    assert!(secret_var < id_var, "{log}");
    assert!(!log.contains("secret set"), "{log}");
    assert_eq!(keygen.trusted(), trusted);

    // Not trusted, or no staged secret: nothing changes.
    for (trusted, secrets) in [("# none\n".to_string(), STAGED), (trusted, "OTHER")] {
        let keygen = Keygen::new(&trusted);
        fs::write(keygen.path("bin/secrets.txt"), format!("{secrets}\n")).unwrap();
        let out = keygen.run(&[], &[], &["--activate", "--key-id", "next-1"]);
        assert!(!out.status.success(), "{trusted} {secrets}");
        assert!(!keygen.gh_log().contains("variable set"));
    }
}

/// Runs `scripts/release-vnext-tag.sh` with a `git` stub whose remote tag state is
/// the `tag` file (absent when missing, `error` for a failing lookup, else a SHA)
/// and a `gh` stub that creates the tag by writing that file.
fn tag_script(state: Option<&str>, gh_fails: bool, args: &[&str]) -> (Output, Option<String>) {
    let dir = tempfile::tempdir().unwrap();
    let bin = dir.path().join("bin");
    fs::create_dir(&bin).unwrap();
    if let Some(state) = state {
        fs::write(dir.path().join("tag"), state).unwrap();
    }
    executable(
        &bin.join("git"),
        r#"state="$(dirname "$0")/../tag"
[ "$1 $2 $3 $4" = "ls-remote --exit-code --tags origin" ] || { echo "unexpected git $*" >&2; exit 64; }
[ -f "$state" ] || exit 2
sha="$(cat "$state")"
[ "$sha" = error ] && { echo "fatal: unable to access remote" >&2; exit 128; }
printf '%s\t%s\n' "$sha" "$5"
"#,
    );
    executable(
        &bin.join("gh"),
        &format!(
            r#"printf '%s\n' "$*" >>"$(dirname "$0")/gh.log"
{}
for arg in "$@"; do case "$arg" in sha=*) printf '%s' "${{arg#sha=}}" >"$(dirname "$0")/../tag" ;; esac; done
"#,
            if gh_fails { "exit 1" } else { "" }
        ),
    );
    let out = Command::new("bash")
        .arg(repo().join("scripts/release-vnext-tag.sh"))
        .args(args)
        .env(
            "PATH",
            format!("{}:{}", bin.display(), std::env::var("PATH").unwrap()),
        )
        .env("GITHUB_REPOSITORY", "salan70/docbridge")
        .output()
        .unwrap();
    let log = fs::read_to_string(bin.join("gh.log")).ok();
    (out, log)
}
const SHA: &str = "0123456789abcdef0123456789abcdef01234567";
const OTHER: &str = "89abcdef0123456789abcdef0123456789abcdef";

#[test]
fn tag_check_accepts_only_an_absent_tag_or_one_at_the_release_commit() {
    for (state, ok) in [
        (None, true),
        (Some(SHA), true),
        (Some(OTHER), false),
        (Some("error"), false),
    ] {
        let (out, gh) = tag_script(state, false, &["check", "1.2.3", SHA]);
        assert_eq!(out.status.success(), ok, "{state:?}: {out:?}");
        assert!(gh.is_none(), "check never writes");
    }
}

#[test]
fn tag_ensure_creates_the_tag_at_the_release_commit_or_fails_closed() {
    let (out, gh) = tag_script(None, false, &["ensure", "1.2.3", SHA]);
    assert!(out.status.success(), "{out:?}");
    let gh = gh.unwrap();
    assert!(gh.contains("repos/salan70/docbridge/git/refs"), "{gh}");
    assert!(gh.contains("ref=refs/tags/v1.2.3"), "{gh}");
    assert!(gh.contains(&format!("sha={SHA}")), "{gh}");

    let (out, gh) = tag_script(Some(SHA), false, &["ensure", "1.2.3", SHA]);
    assert!(out.status.success(), "{out:?}");
    assert!(gh.is_none());

    for (state, gh_fails) in [(Some(OTHER), false), (Some("error"), false), (None, true)] {
        let (out, _) = tag_script(state, gh_fails, &["ensure", "1.2.3", SHA]);
        assert!(!out.status.success(), "{state:?} {gh_fails}: {out:?}");
    }
    for args in [
        &["ensure", "v1.2.3", SHA][..],
        &["ensure", "1.2.3", "HEAD"][..],
        &["delete", "1.2.3", SHA][..],
    ] {
        let (out, gh) = tag_script(None, false, args);
        assert!(!out.status.success(), "{args:?}");
        assert!(gh.is_none());
    }
}

fn legacy_gate(dir: &Path) -> Output {
    Command::new("bash")
        .arg(repo().join("scripts/check-legacy-publisher-retired.sh"))
        .arg(dir)
        .output()
        .unwrap()
}

#[test]
fn vnext_release_is_blocked_while_another_workflow_publishes() {
    // The legacy npm publisher is retired, so this checkout passes the gate.
    let out = legacy_gate(&repo().join(".github/workflows"));
    assert!(out.status.success(), "{out:?}");

    let dir = tempfile::tempdir().unwrap();
    fs::copy(
        repo().join(".github/workflows/release-vnext.yml"),
        dir.path().join("release-vnext.yml"),
    )
    .unwrap();
    fs::write(dir.path().join("ci.yml"), "jobs: {}\n").unwrap();
    assert!(legacy_gate(dir.path()).status.success());
    for publisher in [
        "run: npm publish x.tgz",
        "run: gh release create v1",
        "uses: softprops/action-gh-release@v2",
        "run: gh api -X POST repos/o/r/releases",
    ] {
        fs::write(dir.path().join("other.yaml"), publisher).unwrap();
        assert!(!legacy_gate(dir.path()).status.success(), "{publisher}");
    }
    assert!(!legacy_gate(&dir.path().join("missing")).status.success());
}

#[test]
fn release_workflow_uses_the_fail_closed_gates() {
    let workflow = text(&repo().join(".github/workflows/release-vnext.yml"));
    assert!(workflow.contains("scripts/check-legacy-publisher-retired.sh .github/workflows"));
    assert!(workflow.contains(r#"scripts/release-vnext-tag.sh check "$VERSION" "$GITHUB_SHA""#));
    assert!(workflow.contains(r#"scripts/release-vnext-tag.sh ensure "$VERSION" "$GITHUB_SHA""#));
    // Lookups go through the script, which separates the command from the test.
    assert!(!workflow.contains("git ls-remote"));
    assert!(workflow.contains("secrets[vars.DOCBRIDGE_RELEASE_KEY_SECRET]"));
    let ensure = workflow
        .find("release-vnext-tag.sh ensure")
        .expect("ensure");
    let publish = workflow.find("-F draft=false").expect("publish");
    assert!(ensure < publish);
}
