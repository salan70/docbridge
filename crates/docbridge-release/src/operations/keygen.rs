use super::runner::{arguments, Runner, SystemRunner};
use docbridge_release::{public_key_hex, validate_key_id};
use std::{
    io::{IsTerminal, Read, Write},
    path::{Path, PathBuf},
};
use zeroize::Zeroizing;

mod privacy;
const KEYS: &str = "crates/docbridge-update/keys/trusted-keys.txt";

pub(super) fn cli(args: &[String]) -> Result<String, String> {
    let (role, id, backup, mut flags) = (|| -> Result<_, String> {
        let activate = args.iter().filter(|s| s.as_str() == "--activate").count();
        if activate > 1 {
            return Err("--activate given twice".into());
        }
        let rest: Vec<_> = args
            .iter()
            .filter(|s| s.as_str() != "--activate")
            .cloned()
            .collect();
        let (mut flags, switches) = crate::parse(&rest)?;
        crate::no_switches(&switches)?;
        if flags
            .keys()
            .any(|s| !["--role", "--key-id", "--backup-out", "--root"].contains(&s.as_str()))
        {
            return Err(
            "keygen accepts --role primary|backup or --activate, --key-id, --backup-out and --root"
                .into(),
        );
        }
        let role = match (activate, flags.remove("--role")) {
            (1, None) => "activate".to_string(),
            (0, Some(role)) if role == "primary" || role == "backup" => role,
            _ => return Err("give --role primary|backup or --activate".into()),
        };
        let id = crate::required(flags.remove("--key-id"), "--key-id")?;
        validate_key_id(&id)?;
        let backup = flags.remove("--backup-out").map(PathBuf::from);
        if (role == "backup") != backup.is_some() {
            return Err("only --role backup requires --backup-out".into());
        }
        Ok((role, id, backup, flags))
    })()
    .map_err(super::usage)?;
    let root = match flags.remove("--root") {
        Some(root) => PathBuf::from(root),
        None => std::env::current_dir()
            .map_err(|e| e.to_string())?
            .ancestors()
            .find(|p| p.join(KEYS).exists())
            .ok_or("run keygen in the checkout or supply --root")?
            .to_path_buf(),
    };
    let repo = repository_target(std::env::var("DOCBRIDGE_RELEASE_REPO").ok());
    execute_confirmed(
        &root,
        &role,
        &id,
        backup.as_deref(),
        &repo,
        &mut SystemRunner,
        || {
            if std::io::stdin().is_terminal() {
                print!("Make {id} the active signing key of {repo}? Type the key id to confirm: ");
                std::io::stdout()
                    .flush()
                    .map_err(|_| "could not display activation confirmation")?;
                let mut answer = String::new();
                std::io::stdin()
                    .read_line(&mut answer)
                    .map_err(|_| "could not read activation confirmation")?;
                if answer.trim() != id {
                    return Err("not confirmed; nothing changed".into());
                }
            }
            Ok(())
        },
    )
}

#[cfg(test)]
fn execute(
    root: &Path,
    role: &str,
    id: &str,
    backup: Option<&Path>,
    repo: &str,
    runner: &mut impl Runner,
) -> Result<String, String> {
    execute_confirmed(root, role, id, backup, repo, runner, || Ok(()))
}

fn execute_confirmed(
    root: &Path,
    role: &str,
    id: &str,
    backup: Option<&Path>,
    repo: &str,
    runner: &mut impl Runner,
    confirm: impl FnOnce() -> Result<(), String>,
) -> Result<String, String> {
    validate_key_id(id)?;
    let mut keys = privacy::open_keys(root, KEYS, role != "activate")?;
    let mut trusted = String::new();
    keys.read_to_string(&mut trusted)
        .map_err(|e| format!("read trusted keys: {e}"))?;
    let ids: Vec<_> = trusted
        .lines()
        .filter_map(|line| line.split('#').next()?.split_whitespace().next())
        .collect();
    let secret = secret_name(id);
    if role == "activate" {
        if !ids.contains(&id) {
            return Err(format!(
                "key id {id} is not trusted; stage it and merge the entry first"
            ));
        }
        if !staged_secrets(runner, repo)?
            .lines()
            .any(|line| line == secret)
        {
            return Err(format!(
                "secret {secret} is not in the release environment of {repo}; nothing changed"
            ));
        }
        confirm()?;
        for (name, body) in [
            ("DOCBRIDGE_RELEASE_KEY_SECRET", secret.as_str()),
            ("DOCBRIDGE_RELEASE_KEY_ID", id),
        ] {
            let response = runner.run(
                "gh",
                &arguments(&[
                    "variable", "set", name, "--env", "release", "--repo", repo, "--body", body,
                ]),
                None,
            )?;
            if response.status != 0 {
                return Err(format!(
                    "setting {name} failed; rerun activation to repair the pair"
                ));
            }
        }
        return Ok(format!(
            "Activated {id} ({secret}). The previous key's secret is unchanged.\n"
        ));
    }
    if let Some(existing) = ids.iter().find(|existing| secret_name(existing) == secret) {
        return Err(format!("key id {id} already exists or maps to the same secret name as {existing}; choose another id"));
    }
    if role == "primary"
        && staged_secrets(runner, repo)?
            .lines()
            .any(|line| line == secret)
    {
        return Err(format!(
            "secret {secret} already exists in the release environment; nothing changed"
        ));
    }
    // Reserve the private backup before generating any key. Exclusive creation
    // rejects existing files, dangling symlinks, and a concurrent creator.
    let mut backup_file = if role == "backup" {
        Some(privacy::create_backup(
            backup.ok_or("backup path is required")?,
        )?)
    } else {
        None
    };
    let key = super::temporary_key()?;
    let public = public_key_hex(&key);
    let seed = Zeroizing::new(hex::encode(Zeroizing::new(key.to_bytes()).as_ref()));
    if let Some(file) = backup_file.as_mut() {
        file.write_all(seed.as_bytes())
            .and_then(|_| file.write_all(b"\n"))
            .and_then(|_| file.sync_all())
            .map_err(|_| {
                "writing private backup failed; check the reserved backup file before retrying"
            })?;
    }
    // Preserve the legacy ordering: an upload failure leaves an unused public
    // entry, never an active credential change. Keep this descriptor open so a
    // path replacement cannot redirect the append after the safety checks.
    if !trusted.is_empty() && !trusted.ends_with('\n') {
        keys.write_all(b"\n").map_err(|e| e.to_string())?;
    }
    writeln!(keys, "{id} {public}")
        .and_then(|_| keys.sync_all())
        .map_err(|e| format!("append trusted public key: {e}"))?;
    if role == "primary" {
        // Discard all child output and error details: a failed executable may
        // echo the private seed. The runner never receives it in argv or env.
        let result = runner.run(
            "gh",
            &arguments(&["secret", "set", &secret, "--env", "release", "--repo", repo]),
            Some(seed.as_bytes()),
        );
        if !matches!(result, Ok(response) if response.status == 0) {
            return Err(format!("storing {secret} failed; the active key is unchanged. This seed is discarded: remove the {id} line from {KEYS} and run again."));
        }
        Ok(format!("Staged primary key {id} as {secret} and added it to {KEYS}: {public}\nIt is not active. Run --activate --key-id {id} once a published release trusts it.\nCommit trusted-keys.txt in a reviewed pull request.\n"))
    } else {
        Ok(format!("Added backup key {id} to {KEYS}: {public}\nMove the private backup to offline storage now, then delete the local copy.\nCommit trusted-keys.txt in a reviewed pull request.\n"))
    }
}

fn secret_name(id: &str) -> String {
    format!(
        "DOCBRIDGE_RELEASE_SIGNING_KEY_{}",
        id.to_ascii_uppercase().replace(['.', '-'], "_")
    )
}

fn repository_target(value: Option<String>) -> String {
    value
        .filter(|repo| !repo.is_empty())
        .unwrap_or_else(|| "salan70/docbridge".into())
}

fn staged_secrets(runner: &mut impl Runner, repo: &str) -> Result<String, String> {
    let response = runner
        .run(
            "gh",
            &arguments(&[
                "secret", "list", "--env", "release", "--repo", repo, "--json", "name", "--jq",
                ".[].name",
            ]),
            None,
        )
        .map_err(|_| "could not list the release environment secrets; nothing changed")?;
    if response.status != 0 {
        return Err("could not list the release environment secrets; nothing changed".into());
    }
    String::from_utf8(response.stdout.to_vec())
        .map_err(|_| "invalid secret listing; nothing changed".into())
}

#[cfg(test)]
mod tests {
    use super::super::runner::fixture::Fake;
    use super::*;
    use std::fs;
    const SLOT: &str = "DOCBRIDGE_RELEASE_SIGNING_KEY_NEXT_1";
    #[test]
    fn empty_repository_override_uses_the_legacy_default() {
        assert_eq!(repository_target(None), "salan70/docbridge");
        assert_eq!(repository_target(Some(String::new())), "salan70/docbridge");
        assert_eq!(repository_target(Some("owner/repo".into())), "owner/repo");
    }
    struct Checkout {
        root: tempfile::TempDir,
        keys: PathBuf,
    }
    impl Checkout {
        fn new(trusted: &str) -> Self {
            // macOS exposes /var as a symlink. Use its physical temporary path
            // so fixtures exercise the same nonsymlink contract as operators.
            let root = tempfile::tempdir_in(std::env::temp_dir().canonicalize().unwrap()).unwrap();
            #[cfg(unix)]
            {
                use std::os::unix::fs::PermissionsExt;
                fs::set_permissions(root.path(), fs::Permissions::from_mode(0o700)).unwrap();
            }
            let keys = root
                .path()
                .join("crates/docbridge-update/keys/trusted-keys.txt");
            fs::create_dir_all(keys.parent().unwrap()).unwrap();
            fs::write(&keys, trusted).unwrap();
            Self { root, keys }
        }
        fn run(
            &self,
            role: &str,
            backup: Option<&Path>,
            runner: &mut Fake,
        ) -> Result<String, String> {
            execute(
                self.root.path(),
                role,
                "next-1",
                backup,
                "owner/repo",
                runner,
            )
        }
        fn text(&self) -> String {
            fs::read_to_string(&self.keys).unwrap()
        }
    }
    #[test]
    fn primary_stages_public_entry_and_private_stdin_without_activation() {
        let c = Checkout::new("# keys\n");
        let mut runner = Fake::new(&[(0, ""), (0, "<echo-secret>")]);
        let output = c.run("primary", None, &mut runner).unwrap();
        let seed = std::str::from_utf8(&runner.uploaded).unwrap();
        let key = docbridge_release::parse_signing_key(runner.uploaded.to_vec()).unwrap();
        assert!(c.text().ends_with(&format!(
            "next-1 {}\n",
            docbridge_release::public_key_hex(&key)
        )));
        assert!(!output.contains(seed));
        assert!(!output.contains("untrusted child output"));
        assert_eq!(runner.calls.len(), 2);
        assert_eq!(
            runner.calls[1].1,
            super::super::runner::arguments(&[
                "secret",
                "set",
                SLOT,
                "--env",
                "release",
                "--repo",
                "owner/repo"
            ])
        );
        assert!(runner.calls[1].2);
        assert!(runner
            .calls
            .iter()
            .all(|c| !c.1.iter().any(|a| a.contains(seed))));
    }
    #[test]
    fn upload_failure_leaves_only_public_entry_and_redacts_child_output() {
        let c = Checkout::new("# keys\n");
        let mut runner = Fake::new(&[(0, ""), (1, "<echo-secret>")]);
        let error = c.run("primary", None, &mut runner).unwrap_err();
        assert!(c.text().contains("next-1 "));
        assert!(error.contains("remove the next-1 line"), "{error}");
        assert!(!error.contains("sensitive"));
        assert!(!error.contains(std::str::from_utf8(&runner.uploaded).unwrap()));
        assert_eq!(runner.calls.len(), 2);
    }
    #[test]
    fn duplicate_ids_normalized_collisions_and_secret_listing_fail_closed() {
        for trusted in ["next-1 ab\n", "next.1 ab\n", "NEXT_1 ab\n"] {
            let c = Checkout::new(trusted);
            let mut runner = Fake::new(&[]);
            assert!(c.run("primary", None, &mut runner).is_err());
            assert_eq!(c.text(), trusted);
            assert!(runner.calls.is_empty());
        }
        for (status, names) in [(1, ""), (0, SLOT)] {
            let c = Checkout::new("# keys\n");
            let mut runner = Fake::new(&[(status, names)]);
            assert!(c.run("primary", None, &mut runner).is_err());
            assert_eq!(c.text(), "# keys\n");
            assert_eq!(runner.calls.len(), 1);
            assert!(runner.uploaded.is_empty());
        }
    }
    #[test]
    fn activation_validates_before_confirmation_and_mutates_only_after_confirmation() {
        for (trusted, replies) in [("# none\n", vec![]), ("next-1 ab\n", vec![(0, "OTHER")])] {
            let c = Checkout::new(trusted);
            let mut runner = Fake::new(&replies);
            let result = execute_confirmed(
                c.root.path(),
                "activate",
                "next-1",
                None,
                "owner/repo",
                &mut runner,
                || panic!("invalid activation must not prompt"),
            );
            assert!(result.is_err());
            assert!(runner.calls.len() <= 1);
        }
        let c = Checkout::new("next-1 ab\n");
        let mut runner = Fake::new(&[(0, SLOT)]);
        let error = execute_confirmed(
            c.root.path(),
            "activate",
            "next-1",
            None,
            "owner/repo",
            &mut runner,
            || Err("confirmation declined".into()),
        )
        .unwrap_err();
        assert_eq!(error, "confirmation declined");
        assert_eq!(runner.calls.len(), 1);
    }
    #[test]
    fn activation_requires_trusted_staged_key_and_updates_variables_in_order() {
        let trusted = "next-1 ab\n";
        let c = Checkout::new(trusted);
        let mut runner = Fake::new(&[(0, SLOT), (0, ""), (0, "")]);
        c.run("activate", None, &mut runner).unwrap();
        assert_eq!(c.text(), trusted);
        assert_eq!(runner.calls.len(), 3);
        for (call, variable, body) in [
            (&runner.calls[1], "DOCBRIDGE_RELEASE_KEY_SECRET", SLOT),
            (&runner.calls[2], "DOCBRIDGE_RELEASE_KEY_ID", "next-1"),
        ] {
            assert_eq!(
                call.1,
                super::super::runner::arguments(&[
                    "variable",
                    "set",
                    variable,
                    "--env",
                    "release",
                    "--repo",
                    "owner/repo",
                    "--body",
                    body
                ])
            );
            assert!(!call.2);
        }
        for (trusted, replies) in [
            ("# none\n", vec![]),
            (trusted, vec![(0, "OTHER")]),
            (trusted, vec![(1, "")]),
        ] {
            let c = Checkout::new(trusted);
            let mut runner = Fake::new(&replies);
            assert!(c.run("activate", None, &mut runner).is_err());
            assert!(runner.calls.len() <= 1);
        }
        let mut runner = Fake::new(&[(0, SLOT), (1, "")]);
        assert!(c.run("activate", None, &mut runner).is_err());
        assert_eq!(
            runner.calls.len(),
            2,
            "failed secret-name update must not update the ID"
        );
    }
    #[cfg(unix)]
    #[test]
    fn backup_is_exclusive_private_and_never_uploaded() {
        use std::os::unix::fs::PermissionsExt;
        let c = Checkout::new("# keys\n");
        let backup = c.root.path().join("backup.key");
        let mut runner = Fake::new(&[]);
        let output = c.run("backup", Some(&backup), &mut runner).unwrap();
        let text = fs::read_to_string(&backup).unwrap();
        let key = docbridge_release::parse_signing_key(text.as_bytes().to_vec()).unwrap();
        assert_eq!(
            fs::metadata(&backup).unwrap().permissions().mode() & 0o777,
            0o600
        );
        assert!(c.text().contains(&docbridge_release::public_key_hex(&key)));
        assert!(!output.contains(text.trim()));
        assert!(runner.calls.is_empty());
        let c2 = Checkout::new("# keys\n");
        assert!(c2.run("backup", Some(&backup), &mut runner).is_err());
        assert_eq!(fs::read_to_string(&backup).unwrap(), text);
        assert_eq!(c2.text(), "# keys\n");
    }
    #[cfg(unix)]
    #[test]
    fn symlinked_keys_backup_paths_and_unprivate_directories_are_rejected() {
        use std::os::unix::fs::{symlink, PermissionsExt};
        let c = Checkout::new("# keys\n");
        let mut runner = Fake::new(&[]);
        let target = c.root.path().join("target");
        fs::write(&target, "original").unwrap();
        let backup = c.root.path().join("backup.key");
        symlink(&target, &backup).unwrap();
        assert!(c.run("backup", Some(&backup), &mut runner).is_err());
        assert_eq!(fs::read_to_string(&target).unwrap(), "original");
        fs::remove_file(&backup).unwrap();
        fs::set_permissions(c.root.path(), fs::Permissions::from_mode(0o755)).unwrap();
        assert!(c.run("backup", Some(&backup), &mut runner).is_err());
        fs::set_permissions(c.root.path(), fs::Permissions::from_mode(0o777)).unwrap();
        assert!(c.run("primary", None, &mut runner).is_err());
        fs::set_permissions(c.root.path(), fs::Permissions::from_mode(0o700)).unwrap();
        fs::remove_file(&c.keys).unwrap();
        symlink(&target, &c.keys).unwrap();
        assert!(c.run("primary", None, &mut runner).is_err());
        assert_eq!(fs::read_to_string(target).unwrap(), "original");
        assert!(runner.calls.is_empty());
    }
    #[cfg(unix)]
    #[test]
    fn checkout_paths_cannot_hide_symlinks_in_an_ancestor() {
        use std::os::unix::fs::symlink;
        let c = Checkout::new("# keys\n");
        let alias = c.root.path().join("alias");
        symlink(c.root.path(), &alias).unwrap();
        let mut runner = Fake::new(&[]);
        assert!(execute(
            &alias.join("."),
            "primary",
            "next-1",
            None,
            "owner/repo",
            &mut runner
        )
        .is_err());
        assert!(runner.calls.is_empty());
        assert_eq!(c.text(), "# keys\n");
    }
    #[cfg(unix)]
    #[test]
    fn activation_does_not_require_write_access_to_the_public_key_file() {
        use std::os::unix::fs::PermissionsExt;
        let c = Checkout::new("next-1 ab\n");
        fs::set_permissions(&c.keys, fs::Permissions::from_mode(0o444)).unwrap();
        let mut runner = Fake::new(&[(0, SLOT), (0, ""), (0, "")]);
        c.run("activate", None, &mut runner).unwrap();
        assert_eq!(c.text(), "next-1 ab\n");
    }
    #[cfg(not(unix))]
    #[test]
    fn backup_fails_closed_without_implemented_private_acl_creation() {
        let c = Checkout::new("# keys\n");
        let backup = c.root.path().join("fixture.key");
        let mut runner = Fake::new(&[]);
        let error = c.run("backup", Some(&backup), &mut runner).unwrap_err();
        assert!(error.contains("ACL"), "{error}");
        assert!(!backup.exists());
        assert_eq!(c.text(), "# keys\n");
        assert!(runner.calls.is_empty());
    }
}
