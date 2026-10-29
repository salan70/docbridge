//! The temporary project that the binary-level tests run `docbridge` in.

use serde_json::Value;
use std::{
    fs::{self, File},
    io::{Read, Seek},
    ops::Deref,
    path::Path,
    process::{Command, Output, Stdio},
    thread,
    time::{Duration, Instant},
};
use tempfile::TempDir;

/// An empty project directory, removed when the value is dropped. It
/// dereferences to its path.
pub struct Project(TempDir);

impl Project {
    pub fn new() -> Self {
        Self(tempfile::tempdir().unwrap())
    }

    /// Writes `text` to the project-relative `path`, creating its parents.
    pub fn write(&self, path: &str, text: &str) {
        let full = self.join(path);
        fs::create_dir_all(full.parent().unwrap()).unwrap();
        fs::write(full, text).unwrap();
    }

    /// Runs the binary in the project with no standard input, and fails the
    /// test instead of hanging when the binary does not terminate.
    pub fn run(&self, args: &[&str]) -> Output {
        // Files rather than pipes, so a large output cannot block the binary
        // while the test waits for it to exit.
        let mut stdout = tempfile::tempfile().unwrap();
        let mut stderr = tempfile::tempfile().unwrap();
        let mut child = Command::new(env!("CARGO_BIN_EXE_docbridge"))
            .current_dir(self.0.path())
            .args(args)
            .stdin(Stdio::null())
            .stdout(stdout.try_clone().unwrap())
            .stderr(stderr.try_clone().unwrap())
            .spawn()
            .unwrap();
        let deadline = Instant::now() + Duration::from_secs(30);
        let status = loop {
            if let Some(status) = child.try_wait().unwrap() {
                break status;
            }
            if Instant::now() > deadline {
                let _ = child.kill();
                let _ = child.wait();
                panic!("docbridge {args:?} did not terminate within 30 seconds");
            }
            thread::sleep(Duration::from_millis(10));
        };
        Output {
            status,
            stdout: read(&mut stdout),
            stderr: read(&mut stderr),
        }
    }

    /// Runs the binary and parses its standard output as JSON.
    pub fn json(&self, args: &[&str]) -> (Output, Value) {
        let output = self.run(args);
        let value = serde_json::from_slice(&output.stdout).unwrap_or_else(|_| {
            panic!(
                "stdout {:?}, stderr {:?}",
                String::from_utf8_lossy(&output.stdout),
                String::from_utf8_lossy(&output.stderr)
            )
        });
        (output, value)
    }
}

impl Deref for Project {
    type Target = Path;

    fn deref(&self) -> &Path {
        self.0.path()
    }
}

fn read(file: &mut File) -> Vec<u8> {
    let mut bytes = Vec::new();
    file.rewind().unwrap();
    file.read_to_end(&mut bytes).unwrap();
    bytes
}
