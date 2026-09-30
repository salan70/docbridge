//! `phase0-runner`: reads one Phase 0 input document from stdin and writes the
//! merged diagnostics and per-query counterparts as JSON on stdout.

use std::io::{self, Read, Write};

fn main() {
    let mut input = String::new();
    if let Err(error) = io::stdin().read_to_string(&mut input) {
        eprintln!("phase0-runner: failed to read stdin: {error}");
        std::process::exit(1);
    }

    match docbridge_rust_core_experiment::run_json(&input) {
        Ok(output) => {
            if let Err(error) = writeln!(io::stdout(), "{output}") {
                eprintln!("phase0-runner: failed to write stdout: {error}");
                std::process::exit(1);
            }
        }
        Err(error) => {
            eprintln!("phase0-runner: {error}");
            std::process::exit(1);
        }
    }
}
