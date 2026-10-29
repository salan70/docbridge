use std::{
    io::Write,
    process::{Command, Stdio},
};
use zeroize::Zeroizing;

pub(super) struct Response {
    pub status: i32,
    pub stdout: Zeroizing<Vec<u8>>,
}

pub(super) trait Runner {
    fn run(
        &mut self,
        program: &str,
        args: &[String],
        secret: Option<&[u8]>,
    ) -> Result<Response, String>;
}

pub(super) struct SystemRunner;

impl Runner for SystemRunner {
    fn run(
        &mut self,
        program: &str,
        args: &[String],
        secret: Option<&[u8]>,
    ) -> Result<Response, String> {
        let mut command = Command::new(program);
        command.args(args).stdin(if secret.is_some() {
            Stdio::piped()
        } else {
            Stdio::null()
        });
        // Secret-consuming children may echo stdin, even on success. Do not capture
        // or forward either output stream; errors below contain no child output.
        if let Some(secret) = secret {
            let mut child = command
                .stdout(Stdio::null())
                .stderr(Stdio::null())
                .spawn()
                .map_err(|_| "could not start private secret upload")?;
            let write = child
                .stdin
                .take()
                .ok_or("private stdin unavailable")?
                .write_all(secret);
            let status = child
                .wait()
                .map_err(|_| "private secret upload wait failed")?;
            write.map_err(|_| "private secret upload stdin failed")?;
            return Ok(Response {
                status: status.code().unwrap_or(-1),
                stdout: Zeroizing::new(Vec::new()),
            });
        }
        let output = command
            .output()
            .map_err(|_| format!("could not spawn {program}"))?;
        // Only nonsecret commands reach this branch. Bound displayed diagnostics
        // while retaining the useful authentication/network/git failure detail.
        let diagnostic = &output.stderr[..output.stderr.len().min(4096)];
        std::io::stderr().write_all(diagnostic).ok();
        Ok(Response {
            status: output.status.code().unwrap_or(-1),
            stdout: Zeroizing::new(output.stdout),
        })
    }
}

pub(super) fn arguments(values: &[&str]) -> Vec<String> {
    values.iter().map(|s| (*s).to_string()).collect()
}

#[cfg(test)]
pub(super) mod fixture {
    use super::*;
    use std::collections::VecDeque;

    pub struct Fake {
        pub replies: VecDeque<(i32, String)>,
        pub calls: Vec<(String, Vec<String>, bool)>,
        pub uploaded: Zeroizing<Vec<u8>>,
    }
    impl Fake {
        pub fn new(replies: &[(i32, &str)]) -> Self {
            Self {
                replies: replies.iter().map(|(s, o)| (*s, o.to_string())).collect(),
                calls: Vec::new(),
                uploaded: Zeroizing::new(Vec::new()),
            }
        }
    }
    impl Runner for Fake {
        fn run(
            &mut self,
            program: &str,
            args: &[String],
            secret: Option<&[u8]>,
        ) -> Result<Response, String> {
            self.calls
                .push((program.to_string(), args.to_vec(), secret.is_some()));
            if let Some(secret) = secret {
                self.uploaded.extend_from_slice(secret);
            }
            let (status, mut stdout) = self
                .replies
                .pop_front()
                .expect("unexpected external command");
            if stdout == "<echo-secret>" {
                stdout = std::str::from_utf8(secret.expect("secret stdin required"))
                    .unwrap()
                    .to_string();
            }
            Ok(Response {
                status,
                stdout: Zeroizing::new(stdout.into_bytes()),
            })
        }
    }
}
