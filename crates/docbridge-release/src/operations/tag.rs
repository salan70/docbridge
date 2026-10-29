use super::runner::{arguments, Runner};

pub(super) fn run(
    args: &[String],
    runner: &mut impl Runner,
    repo: Option<&str>,
) -> Result<String, String> {
    if args.len() != 3 || !matches!(args[0].as_str(), "check" | "ensure") {
        return Err(super::usage(
            "usage: docbridge-release tag check|ensure VERSION SHA".into(),
        ));
    }
    docbridge_release::release_version(&args[1]).map_err(super::usage)?;
    let sha = &args[2];
    if sha.len() != 40
        || !sha
            .bytes()
            .all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b))
    {
        return Err(super::usage(
            "SHA must be a full 40-character commit SHA".into(),
        ));
    }
    let tag = format!("v{}", args[1]);
    let reference = format!("refs/tags/{tag}");
    let current = absent_or_at_sha(runner, &reference, sha)?;
    if args[0] == "check" {
        return Ok(format!(
            "tag {tag}: {}\n",
            current.as_deref().unwrap_or("absent")
        ));
    }
    if current.is_none() {
        let repo = repo
            .filter(|s| !s.is_empty())
            .ok_or("GITHUB_REPOSITORY is required to create a tag")?;
        let created = runner.run(
            "gh",
            &arguments(&[
                "api",
                "-X",
                "POST",
                &format!("repos/{repo}/git/refs"),
                "-f",
                &format!("ref={reference}"),
                "-f",
                &format!("sha={sha}"),
            ]),
            None,
        )?;
        // Preserve the legacy create-race contract: a failed POST is fatal even
        // if a different actor happened to create the desired tag concurrently.
        if created.status != 0 {
            return Err("creating the release tag failed".into());
        }
    }
    if absent_or_at_sha(runner, &reference, sha)?.as_deref() != Some(sha) {
        return Err(format!(
            "tag {tag} does not point at {sha} after creating it"
        ));
    }
    Ok(format!("tag {tag}: {sha}\n"))
}

fn absent_or_at_sha(
    runner: &mut impl Runner,
    reference: &str,
    sha: &str,
) -> Result<Option<String>, String> {
    let response = runner.run(
        "git",
        &arguments(&["ls-remote", "--exit-code", "--tags", "origin", reference]),
        None,
    )?;
    if response.status == 2 {
        return Ok(None);
    }
    if response.status != 0 {
        return Err(format!(
            "looking up {reference} on origin failed (git exit {})",
            response.status
        ));
    }
    let text = std::str::from_utf8(&response.stdout).map_err(|_| "invalid git remote response")?;
    let matches: Vec<_> = text
        .lines()
        .filter_map(|line| {
            let fields: Vec<_> = line.split_whitespace().collect();
            (fields.len() == 2 && fields[1] == reference).then(|| fields[0])
        })
        .collect();
    if matches.len() != 1 {
        return Err("git succeeded without exactly one matching tag ref".into());
    }
    if matches[0] != sha {
        return Err(format!(
            "tag {reference} exists at {}, not the release commit {sha}",
            matches[0]
        ));
    }
    Ok(Some(sha.into()))
}

#[cfg(test)]
mod tests {
    use super::super::runner::{arguments, fixture::Fake};
    use super::*;
    const SHA: &str = "0123456789abcdef0123456789abcdef01234567";
    const OTHER: &str = "89abcdef0123456789abcdef0123456789abcdef";
    fn invoke(mode: &str, runner: &mut Fake) -> Result<String, String> {
        run(
            &arguments(&[mode, "1.2.3", SHA]),
            runner,
            Some("owner/repo"),
        )
    }
    #[test]
    fn check_accepts_only_absent_or_exact_full_sha_without_mutations() {
        for (status, output, ok) in [
            (2, String::new(), true),
            (0, format!("{SHA}\trefs/tags/v1.2.3\n"), true),
            (
                0,
                format!("{OTHER}\trefs/tags/v1.2.3\n{SHA}\trefs/tags/v1.2.3^{{}}\n"),
                false,
            ),
            (128, String::new(), false),
            (0, String::new(), false),
            (0, format!("{SHA}\trefs/tags/other\n"), false),
        ] {
            let mut runner = Fake::new(&[(status, &output)]);
            assert_eq!(
                invoke("check", &mut runner).is_ok(),
                ok,
                "{status} {output}"
            );
            assert_eq!(runner.calls.len(), 1);
            assert_eq!(runner.calls[0].0, "git");
            assert_eq!(
                runner.calls[0].1,
                arguments(&[
                    "ls-remote",
                    "--exit-code",
                    "--tags",
                    "origin",
                    "refs/tags/v1.2.3"
                ])
            );
        }
    }
    #[test]
    fn ensure_creates_then_rechecks_and_never_accepts_a_create_race() {
        let at_sha = format!("{SHA}\trefs/tags/v1.2.3\n");
        let conflict = format!("{OTHER}\trefs/tags/v1.2.3\n");
        for (replies, ok, calls) in [
            (vec![(2, ""), (0, ""), (0, at_sha.as_str())], true, 3),
            (vec![(0, at_sha.as_str()), (0, at_sha.as_str())], true, 2),
            (vec![(2, ""), (1, "already exists")], false, 2),
            (vec![(2, ""), (0, ""), (0, conflict.as_str())], false, 3),
            (vec![(2, ""), (0, ""), (2, "")], false, 3),
            (vec![(2, ""), (0, ""), (128, "network failure")], false, 3),
        ] {
            let mut runner = Fake::new(&replies);
            assert_eq!(invoke("ensure", &mut runner).is_ok(), ok);
            assert_eq!(runner.calls.len(), calls);
            if runner.calls[0].0 == "git" && replies[0].0 == 2 {
                assert_eq!(
                    runner.calls[1].1,
                    arguments(&[
                        "api",
                        "-X",
                        "POST",
                        "repos/owner/repo/git/refs",
                        "-f",
                        "ref=refs/tags/v1.2.3",
                        "-f",
                        &format!("sha={SHA}")
                    ])
                );
            }
        }
    }
    #[test]
    fn invalid_arguments_and_missing_repository_fail_before_mutation() {
        for args in [
            arguments(&["check", "v1.2.3", SHA]),
            arguments(&["check", "1.2.3", "HEAD"]),
            arguments(&["delete", "1.2.3", SHA]),
        ] {
            let mut runner = Fake::new(&[]);
            assert!(run(&args, &mut runner, None).is_err());
            assert!(runner.calls.is_empty());
        }
        let mut runner = Fake::new(&[(2, "")]);
        assert!(run(&arguments(&["ensure", "1.2.3", SHA]), &mut runner, None).is_err());
        assert!(runner.calls.iter().all(|c| c.0 == "git"));
    }
}
