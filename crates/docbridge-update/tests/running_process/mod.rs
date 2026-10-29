use std::{
    io::{BufRead, BufReader, Write},
    path::Path,
    process::{Child, ChildStdin, Command, Stdio},
    sync::mpsc::{self, Receiver},
    time::Duration,
};

const HELPER_ENV: &str = "DOCBRIDGE_UPDATE_NATIVE_TEST_CHILD";
const PREFIX: &str = "DOCBRIDGE_NATIVE:";

#[test]
fn native_process_helper() {
    let Ok(identity) = std::env::var(HELPER_ENV) else {
        return;
    };
    let mut output = std::io::stdout().lock();
    writeln!(output, "{PREFIX}ready:{identity}").unwrap();
    output.flush().unwrap();
    for line in std::io::stdin().lock().lines() {
        let command = line.unwrap();
        let response = match command.as_str() {
            "ping" => "pong",
            "exit" => "bye",
            _ => panic!("unexpected helper command: {command}"),
        };
        writeln!(output, "{PREFIX}{response}:{identity}").unwrap();
        output.flush().unwrap();
        if command == "exit" {
            return;
        }
    }
    panic!("helper stdin closed without an exit command");
}

pub struct RunningProcess {
    child: ChildGuard,
    input: ChildStdin,
    messages: Receiver<String>,
    identity: String,
}

impl RunningProcess {
    pub fn start(executable: &Path, identity: &str) -> Self {
        let mut child = ChildGuard(
            Command::new(executable)
                .args([
                    "--exact",
                    "running_process::native_process_helper",
                    "--nocapture",
                    "--test-threads=1",
                ])
                .env(HELPER_ENV, identity)
                .stdin(Stdio::piped())
                .stdout(Stdio::piped())
                .stderr(Stdio::inherit())
                .spawn()
                .unwrap_or_else(|error| panic!("launch {}: {error}", executable.display())),
        );
        let input = child.0.stdin.take().unwrap();
        let output = child.0.stdout.take().unwrap();
        let (sender, messages) = mpsc::channel();
        std::thread::spawn(move || {
            for line in BufReader::new(output).lines() {
                let line = line.expect("read native helper stdout");
                // libtest can prefix the first uncaptured line with the test name.
                if let Some((_, message)) = line.split_once(PREFIX) {
                    if sender.send(message.to_owned()).is_err() {
                        return;
                    }
                }
            }
        });
        let process = Self {
            child,
            input,
            messages,
            identity: identity.into(),
        };
        process.expect("ready");
        process
    }

    fn expect(&self, message: &str) {
        let received = self.messages.recv_timeout(Duration::from_secs(30));
        assert_eq!(
            received.expect("native helper response within 30 seconds"),
            format!("{message}:{}", self.identity)
        );
    }

    pub fn ping(&mut self) {
        assert!(self.child.0.try_wait().unwrap().is_none());
        writeln!(self.input, "ping").unwrap();
        self.input.flush().unwrap();
        self.expect("pong");
    }

    pub fn finish(&mut self) {
        writeln!(self.input, "exit").unwrap();
        self.input.flush().unwrap();
        self.expect("bye");
        assert!(self.child.0.wait().unwrap().success());
    }
}

struct ChildGuard(Child);

impl Drop for ChildGuard {
    fn drop(&mut self) {
        let _ = self.0.kill();
        let _ = self.0.wait();
    }
}
