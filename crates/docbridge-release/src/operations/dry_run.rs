use docbridge_release::{
    asset_names, executable_names, sign_release, sums_bytes, verify_release, SignRequest, SUMS,
};
use docbridge_update::{checked_compiled_trusted_keys, TrustedKeys};
use std::{collections::BTreeMap, fs, path::PathBuf};

pub(super) fn run(args: &[String]) -> Result<String, String> {
    let (artifacts, out, version) = (|| -> Result<_, String> {
        let (mut flags, switches) = crate::parse(args)?;
        crate::no_switches(&switches)?;
        if flags
            .keys()
            .any(|f| !["--artifacts", "--out", "--version"].contains(&f.as_str()))
        {
            return Err("dry-run accepts only --artifacts, --out and --version".into());
        }
        let artifacts = PathBuf::from(crate::required(flags.remove("--artifacts"), "--artifacts")?);
        let out = PathBuf::from(crate::required(flags.remove("--out"), "--out")?);
        let version = crate::required(flags.remove("--version"), "--version")?;
        docbridge_release::release_version(&version)?;
        Ok((artifacts, out, version))
    })()
    .map_err(super::usage)?;
    let key = super::temporary_key()?;
    let key_id = "dry-run-throwaway";
    sign_release(&SignRequest {
        version: &version,
        key_id,
        key: &key,
        artifacts: &artifacts,
        out: &out,
    })?;
    let keys = TrustedKeys::from([(key_id.into(), key.verifying_key().to_bytes())]);
    let lines = verify_release(&out, &version, &keys)?;
    expect_rejected(
        verify_release(&out, &version, &checked_compiled_trusted_keys()?),
        "unknown signing key",
    )?;

    let scratch = tempfile::tempdir().map_err(|e| e.to_string())?;
    let mut files = BTreeMap::new();
    for name in asset_names() {
        if name != SUMS {
            files.insert(
                name.clone(),
                fs::read(out.join(&name)).map_err(|e| e.to_string())?,
            );
        }
    }
    files.insert(executable_names()[0].clone(), b"tampered".to_vec());
    files.insert(SUMS.into(), sums_bytes(&files));
    for (name, bytes) in files {
        fs::write(scratch.path().join(name), bytes).map_err(|e| e.to_string())?;
    }
    expect_rejected(
        verify_release(scratch.path(), &version, &keys),
        "checksum mismatch",
    )?;
    Ok(format!("{}\ndry run: throwaway key rejected as expected (unknown signing key)\ndry run: tampered executable with substituted SHA256SUMS rejected as expected (checksum mismatch)\n", lines.join("\n")))
}

fn expect_rejected(result: Result<Vec<String>, String>, reason: &str) -> Result<(), String> {
    match result {
        Err(error) if error.contains(reason) => Ok(()),
        Err(error) => Err(format!(
            "dry run: rejected for an unexpected reason: {error}"
        )),
        Ok(_) => Err(format!(
            "dry run: unsafe asset set was accepted; expected {reason}"
        )),
    }
}
