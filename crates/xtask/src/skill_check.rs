use crate::{Reply, Runner};
use std::{fs, path::Path};

const SKILL_DIR: &str = ".agents/skills/docbridge";

/// The checked-in skill must equal what `init` emits. `SKILL.md` is compared
/// byte for byte. The ownership record is compared as JSON, because `init`
/// omits the trailing newline that the checked-in file has.
fn compare(skill: (&[u8], &[u8]), record: (&str, &str)) -> Result<(), String> {
    if skill.0 != skill.1 {
        return Err(format!("{SKILL_DIR}/SKILL.md differs from what init emits"));
    }
    let parse = |text: &str| {
        serde_json::from_str::<serde_json::Value>(text)
            .map_err(|e| format!("{SKILL_DIR}/.docbridge-owned.json: {e}"))
    };
    if parse(record.0)? != parse(record.1)? {
        return Err(format!(
            "{SKILL_DIR}/.docbridge-owned.json differs from what init emits"
        ));
    }
    Ok(())
}

fn read(path: &Path) -> Result<Vec<u8>, String> {
    fs::read(path).map_err(|e| format!("{}: {e}", path.display()))
}

/// Run `docbridge init --yes` with `binary` in an empty project and compare
/// the skill it installs with the one checked in under `root`.
pub fn check(root: &Path, binary: &Path, runner: &mut impl Runner) -> Result<String, String> {
    let project = tempfile::tempdir().map_err(|e| e.to_string())?;
    let Reply { code, err, .. } =
        runner.run(binary, &["init".into(), "--yes".into()], project.path())?;
    if code != 0 {
        return Err(format!("docbridge init failed ({code}): {err}"));
    }
    let (emitted, checked_in) = (project.path().join(SKILL_DIR), root.join(SKILL_DIR));
    let text = |dir: &Path| {
        read(&dir.join(".docbridge-owned.json")).map(|b| String::from_utf8_lossy(&b).into_owned())
    };
    compare(
        (
            &read(&emitted.join("SKILL.md"))?,
            &read(&checked_in.join("SKILL.md"))?,
        ),
        (&text(&emitted)?, &text(&checked_in)?),
    )?;
    Ok(format!("{SKILL_DIR} matches what init emits."))
}

#[cfg(test)]
mod tests {
    use super::*;

    const RECORD: &str = "{\n  \"SKILL.md\": \"abc\"\n}";

    #[test]
    fn record_differing_only_in_trailing_newline_matches() {
        compare((b"skill", b"skill"), (RECORD, &format!("{RECORD}\n"))).unwrap();
    }

    #[test]
    fn skill_text_drift_is_reported() {
        let e = compare((b"skill", b"skill!"), (RECORD, RECORD)).unwrap_err();
        assert!(e.contains("SKILL.md differs"), "{e}");
    }

    #[test]
    fn record_drift_is_reported() {
        let e = compare((b"s", b"s"), (RECORD, "{\"SKILL.md\": \"def\"}")).unwrap_err();
        assert!(e.contains(".docbridge-owned.json differs"), "{e}");
    }
}
