fn main() {
    use std::io::{IsTerminal, Read, Write};
    let args: Vec<String> = std::env::args().skip(1).collect();
    let cwd = match std::env::current_dir() {
        Ok(cwd) => cwd,
        Err(e) => {
            eprintln!("current directory: {e}");
            std::process::exit(1);
        }
    };
    let invocation = match docbridge::cli::Invocation::parse(&args, &cwd) {
        Ok(invocation) => invocation,
        Err(response) => {
            print!("{}", response.stdout);
            eprint!("{}", response.stderr);
            std::process::exit(response.exit_code);
        }
    };
    let mut stdin = String::new();
    if invocation.stdin {
        if let Err(e) = std::io::stdin().read_to_string(&mut stdin) {
            eprintln!("stdin: {e}");
            std::process::exit(1);
        }
    }
    let response = docbridge::cli::dispatch_with_confirmation(invocation, &stdin, |plan| {
        if !std::io::stdin().is_terminal() || !std::io::stderr().is_terminal() {
            return false;
        }
        eprint!("{plan}\nProceed? [y/N] ");
        if std::io::stderr().flush().is_err() {
            return false;
        }
        let mut answer = String::new();
        std::io::stdin().read_line(&mut answer).is_ok()
            && matches!(answer.trim().to_ascii_lowercase().as_str(), "y" | "yes")
    });
    if let Err(e) = std::io::stdout().write_all(response.stdout.as_bytes()) {
        eprintln!("stdout: {e}");
        std::process::exit(1);
    }
    eprint!("{}", response.stderr);
    std::process::exit(response.exit_code);
}
