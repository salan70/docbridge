use serde_json::Value;
use std::{
    fs,
    path::PathBuf,
    process::{Command, Output, Stdio},
    sync::atomic::{AtomicUsize, Ordering},
    time::{Duration, Instant},
};

struct Project(PathBuf);

impl Project {
    fn new(config: &str) -> Self {
        static NEXT: AtomicUsize = AtomicUsize::new(0);
        let path = std::env::temp_dir().join(format!(
            "docbridge-safety-{}-{}",
            std::process::id(),
            NEXT.fetch_add(1, Ordering::Relaxed)
        ));
        fs::create_dir_all(&path).unwrap();
        let project = Self(path);
        project.write("docbridge.config.json", config);
        project
    }

    fn write(&self, path: &str, text: &str) {
        let full = self.0.join(path);
        fs::create_dir_all(full.parent().unwrap()).unwrap();
        fs::write(full, text).unwrap();
    }

    /// Runs the binary and fails the test instead of hanging when it does not terminate.
    fn run(&self, args: &[&str]) -> Output {
        let mut child = Command::new(env!("CARGO_BIN_EXE_docbridge"))
            .current_dir(&self.0)
            .args(args)
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .spawn()
            .unwrap();
        let deadline = Instant::now() + Duration::from_secs(30);
        while child.try_wait().unwrap().is_none() {
            if Instant::now() > deadline {
                let _ = child.kill();
                panic!("docbridge {args:?} did not terminate within 30 seconds");
            }
            std::thread::sleep(Duration::from_millis(20));
        }
        child.wait_with_output().unwrap()
    }

    fn json(&self, args: &[&str]) -> (Output, Value) {
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

impl Drop for Project {
    fn drop(&mut self) {
        let _ = fs::remove_dir_all(&self.0);
    }
}

#[cfg(unix)]
fn codes(value: &Value) -> Vec<String> {
    value["diagnostics"]
        .as_array()
        .unwrap()
        .iter()
        .map(|d| d["code"].as_str().unwrap().to_owned())
        .collect()
}

#[cfg(unix)]
#[test]
fn symlink_cycle_in_managed_path_terminates_and_is_reported() {
    let project = Project::new(
        r#"{"include":{"code":{"paths":["src"],"extensions":[".rs"]},"docs":["docs"]}}"#,
    );
    project.write("src/a.rs", "a\n");
    project.write("docs/a.md", "<!-- @code src/a.rs -->\n# A\n");
    // A directory symlink pointing to an ancestor inside a managed path.
    std::os::unix::fs::symlink("..", project.0.join("docs/loop")).unwrap();
    std::os::unix::fs::symlink("../src", project.0.join("src/self")).unwrap();

    let (output, value) = project.json(&["validate", "--json"]);
    assert_eq!(output.status.code(), Some(1));
    assert_eq!(value["summary"]["complete"], false);
    assert!(codes(&value).contains(&"unsafe-path".to_owned()));

    let (output, value) = project.json(&["unlinked", "--json"]);
    assert_ne!(output.status.code(), Some(0));
    assert_eq!(value["complete"], false);
    assert!(codes(&value).contains(&"unsafe-path".to_owned()));
}

#[test]
fn include_docs_has_no_implicit_exclude() {
    let project = Project::new(
        r#"{"include":{"code":{"paths":["src"],"extensions":[".rs"]},"docs":["docs"]},"exclude":{"code":["**/internal/**","docs/**"]}}"#,
    );
    project.write("src/a.rs", "a\n");
    project.write(
        "docs/internal/guide.md",
        "<!-- @code src/a.rs -->\n# Guide\n",
    );

    let (output, value) = project.json(&["links", "docs/internal/guide.md", "--json"]);
    assert_eq!(output.status.code(), Some(0), "{value}");
    assert_eq!(value["complete"], true);
    let nodes = value["nodes"].as_array().unwrap();
    assert!(nodes.iter().any(|n| n["path"] == "docs/internal/guide.md"));
    assert!(nodes.iter().any(|n| n["path"] == "src/a.rs"));
}
