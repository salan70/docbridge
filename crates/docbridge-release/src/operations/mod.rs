//! Maintainer operations kept out of the product CLI and public library API.
use ed25519_dalek::SigningKey;
use zeroize::Zeroizing;

mod dry_run;
mod keygen;
mod runner;
mod tag;

const USAGE_ERROR: &str = "invalid usage: ";

fn usage(error: String) -> String {
    format!("{USAGE_ERROR}{error}")
}

pub(super) fn is_usage_error(error: &str) -> bool {
    error.starts_with(USAGE_ERROR)
}

pub(super) fn run(command: &str, args: &[String]) -> Result<String, String> {
    match command {
        "dry-run" => dry_run::run(args),
        "tag" => tag::run(
            args,
            &mut runner::SystemRunner,
            std::env::var("GITHUB_REPOSITORY").ok().as_deref(),
        ),
        "keygen" => keygen::cli(args),
        _ => Err("unknown release operation".into()),
    }
}

fn temporary_key() -> Result<SigningKey, String> {
    let mut seed = Zeroizing::new([0u8; 32]);
    getrandom::getrandom(&mut *seed).map_err(|_| "OS cryptographic random source failed")?;
    Ok(SigningKey::from_bytes(&seed))
}
