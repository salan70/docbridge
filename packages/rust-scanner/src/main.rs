//! DocBridge Rust scanner worker CLI.
//!
//! Reads one schemaVersion 1 request from stdin and writes the response JSON
//! plus a trailing newline to stdout.

use std::io::{self, Read, Write};

fn main() {
    let mut input = String::new();
    if let Err(error) = io::stdin().read_to_string(&mut input) {
        eprintln!("docbridge-rust-scanner: failed to read stdin: {error}");
        std::process::exit(1);
    }

    match docbridge_rust_scanner::scan_request_json(&input) {
        Ok(output) => {
            if let Err(error) = writeln!(io::stdout(), "{output}") {
                eprintln!("docbridge-rust-scanner: failed to write stdout: {error}");
                std::process::exit(1);
            }
        }
        Err(error) => {
            eprintln!("docbridge-rust-scanner: {error}");
            std::process::exit(1);
        }
    }
}
