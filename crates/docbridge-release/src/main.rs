//! `docbridge-release`: maintainer tool for the signed vNext release asset set.
//! The private key is read only from a file or an environment variable, never argv.
use docbridge_release::{
    parse_public_key, parse_signing_key, public_key_hex, sign_release, validate_key_id,
    verify_release, SignRequest,
};
use docbridge_update::{checked_compiled_trusted_keys, TrustedKeys};
use ed25519_dalek::SigningKey;
use std::{collections::BTreeMap, path::PathBuf, process::ExitCode};
use zeroize::Zeroizing;

mod operations;

const USAGE: &str = "\
usage:
  docbridge-release sign --version X.Y.Z --artifacts DIR --out DIR --key-id ID
                         (--key-file PATH | --key-env NAME)
  docbridge-release verify --dir DIR --version X.Y.Z
                           (--compiled-keys | --key-id ID --public-key HEX)
  docbridge-release public-key (--key-file PATH | --key-env NAME)
  docbridge-release trusted-keys
  docbridge-release tag check|ensure VERSION SHA
  docbridge-release keygen --role primary|backup --key-id ID [--backup-out PATH] [--root DIR]
  docbridge-release keygen --activate --key-id ID [--root DIR]
  docbridge-release dry-run --artifacts DIR --out DIR --version X.Y.Z

The private key is a 32-byte Ed25519 seed as 64 hex characters. It is never
accepted as a command-line argument.";

fn main() -> ExitCode {
    match run(std::env::args().skip(1).collect()) {
        Ok(output) => {
            print!("{output}");
            ExitCode::SUCCESS
        }
        Err(message) => {
            eprintln!("docbridge-release: {message}");
            if operations::is_usage_error(&message) {
                ExitCode::from(2)
            } else {
                ExitCode::FAILURE
            }
        }
    }
}

fn run(args: Vec<String>) -> Result<String, String> {
    let (command, rest) = args.split_first().ok_or(USAGE)?;
    if matches!(command.as_str(), "tag" | "keygen" | "dry-run") {
        return operations::run(command, rest);
    }
    let (mut flags, switches) = parse(rest)?;
    let allowed: &[&str] = match command.as_str() {
        "sign" => &[
            "--version",
            "--artifacts",
            "--out",
            "--key-id",
            "--key-file",
            "--key-env",
        ],
        "verify" => &["--dir", "--version", "--key-id", "--public-key"],
        "public-key" => &["--key-file", "--key-env"],
        "trusted-keys" => &[],
        _ => return Err(USAGE.into()),
    };
    // Reject unknown options before acting, so a typo never signs or verifies.
    if let Some(flag) = flags.keys().find(|f| !allowed.contains(&f.as_str())) {
        return Err(format!("unknown option {flag}\n{USAGE}"));
    }
    let mut take = |name: &str| flags.remove(name);
    let output = match command.as_str() {
        "sign" => {
            let version = required(take("--version"), "--version")?;
            let artifacts = PathBuf::from(required(take("--artifacts"), "--artifacts")?);
            let out = PathBuf::from(required(take("--out"), "--out")?);
            let key_id = required(take("--key-id"), "--key-id")?;
            let key = signing_key(take("--key-file"), take("--key-env"))?;
            no_switches(&switches)?;
            let names = sign_release(&SignRequest {
                version: &version,
                key_id: &key_id,
                key: &key,
                artifacts: &artifacts,
                out: &out,
            })?;
            format!(
                "Signed and verified {} assets for {version} with key {key_id} in {}\n{}\n",
                names.len(),
                out.display(),
                names.join("\n")
            )
        }
        "verify" => {
            let dir = PathBuf::from(required(take("--dir"), "--dir")?);
            let version = required(take("--version"), "--version")?;
            let compiled = switches.iter().any(|s| s == "--compiled-keys");
            if switches.len() > 1 {
                return Err("--compiled-keys given twice".into());
            }
            let keys: TrustedKeys = match (compiled, take("--key-id"), take("--public-key")) {
                (true, None, None) => checked_compiled_trusted_keys()?,
                (false, Some(id), Some(public)) => {
                    validate_key_id(&id)?;
                    BTreeMap::from([(id, parse_public_key(&public)?)])
                }
                _ => {
                    return Err("verify needs --compiled-keys or --key-id with --public-key".into())
                }
            };
            let lines = verify_release(&dir, &version, &keys)?;
            format!(
                "Verified the complete {version} asset set in {}\n{}\n",
                dir.display(),
                lines.join("\n")
            )
        }
        "public-key" => {
            let key = signing_key(take("--key-file"), take("--key-env"))?;
            no_switches(&switches)?;
            format!("{}\n", public_key_hex(&key))
        }
        // Key IDs compiled into this build, one per line (empty while unprovisioned).
        "trusted-keys" => {
            no_switches(&switches)?;
            let mut ids = String::new();
            for id in checked_compiled_trusted_keys()?.keys() {
                ids.push_str(id);
                ids.push('\n');
            }
            ids
        }
        _ => unreachable!("command validated above"),
    };
    Ok(output)
}

const SWITCHES: [&str; 1] = ["--compiled-keys"];
fn parse(args: &[String]) -> Result<(BTreeMap<String, String>, Vec<String>), String> {
    let mut flags = BTreeMap::new();
    let mut switches = Vec::new();
    let mut iter = args.iter();
    while let Some(arg) = iter.next() {
        if SWITCHES.contains(&arg.as_str()) {
            switches.push(arg.clone());
            continue;
        }
        if !arg.starts_with("--") || arg.contains('=') {
            return Err(format!("unexpected argument {arg:?}\n{USAGE}"));
        }
        let value = iter
            .next()
            .ok_or_else(|| format!("{arg} needs a value\n{USAGE}"))?;
        if flags.insert(arg.clone(), value.clone()).is_some() {
            return Err(format!("{arg} given twice"));
        }
    }
    Ok((flags, switches))
}
fn required(value: Option<String>, name: &str) -> Result<String, String> {
    value.ok_or_else(|| format!("missing {name}\n{USAGE}"))
}
fn no_switches(switches: &[String]) -> Result<(), String> {
    match switches.first() {
        Some(s) => Err(format!("{s} is not valid here\n{USAGE}")),
        None => Ok(()),
    }
}
/// Fails closed: a missing file, an unset or empty variable, or a malformed key is an error.
fn signing_key(file: Option<String>, env: Option<String>) -> Result<SigningKey, String> {
    let bytes = match (file, env) {
        (Some(path), None) => {
            std::fs::read(&path).map_err(|e| format!("read signing key file {path}: {e}"))?
        }
        (None, Some(name)) => match std::env::var(&name).map(Zeroizing::new) {
            // Moved out, not copied; the emptied wrapper and a blank value are zeroized.
            Ok(mut value) if !value.trim().is_empty() => std::mem::take(&mut *value).into_bytes(),
            _ => {
                return Err(format!(
                    "signing key environment variable {name} is unset or empty"
                ))
            }
        },
        _ => return Err("give exactly one of --key-file or --key-env".into()),
    };
    parse_signing_key(bytes)
}
