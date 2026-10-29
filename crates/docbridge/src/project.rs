use crate::{
    config::{self, Config},
    markdown,
    model::Document,
    output::{Edge, Node, QueryDiagnostic},
};
use std::{
    collections::{BTreeMap, BTreeSet},
    fs,
    path::{Path, PathBuf},
};

#[derive(Debug, Clone)]
pub struct SourceFile {
    pub text: String,
    pub document: Option<Document>,
}

#[derive(Debug)]
pub struct Project {
    pub root: PathBuf,
    pub config: Config,
    pub files: BTreeMap<String, SourceFile>,
    pub nodes: BTreeMap<String, Node>,
    pub edges: Vec<Edge>,
    pub diagnostics: Vec<QueryDiagnostic>,
    pub complete: bool,
}

pub fn is_symlink(metadata: &fs::Metadata) -> bool {
    #[cfg(windows)]
    {
        use std::os::windows::fs::MetadataExt;
        metadata.file_attributes() & 0x400 != 0
    }
    #[cfg(not(windows))]
    {
        metadata.file_type().is_symlink()
    }
}

/// The root must already be canonical. Every existing component is checked before reading.
pub fn safe_path(root: &Path, relative: &str) -> Result<PathBuf, String> {
    config::validate_path(relative, false)?;
    let mut path = root.to_path_buf();
    let mut segments = relative.split('/').peekable();
    while let Some(segment) = segments.next() {
        // Compare directory entries byte-for-byte even on case-folding filesystems.
        let entries = fs::read_dir(&path).map_err(|e| format!("{relative}: {e}"))?;
        let mut found = false;
        for entry in entries {
            let entry = entry.map_err(|e| format!("{relative}: {e}"))?;
            if entry.file_name() == segment {
                found = true;
                break;
            }
        }
        if !found {
            return Err(format!(
                "managed path does not exist with exact spelling: {relative}"
            ));
        }
        path.push(segment);
        let metadata = fs::symlink_metadata(&path).map_err(|e| format!("{relative}: {e}"))?;
        if is_symlink(&metadata) {
            return Err(format!("symlink/reparse point is not managed: {relative}"));
        }
        if segments.peek().is_some() && !metadata.is_dir() {
            return Err(format!("not a directory: {relative}"));
        }
        if segments.peek().is_none() && !metadata.is_file() {
            return Err(format!("not a regular file: {relative}"));
        }
    }
    Ok(path)
}

pub fn read_text(root: &Path, relative: &str) -> Result<String, String> {
    let path = safe_path(root, relative)?;
    let text = fs::read_to_string(path).map_err(|e| format!("{relative}: {e}"))?;
    if text.contains('\0') {
        return Err(format!("NUL-containing binary file: {relative}"));
    }
    Ok(text)
}

pub(crate) fn line_at(text: &str, offset: usize) -> usize {
    1 + text.as_bytes()[..offset]
        .iter()
        .filter(|&&b| b == b'\n')
        .count()
}

fn last_line(text: &str, start: usize, end: usize) -> usize {
    if end <= start {
        line_at(text, start)
    } else {
        line_at(text, end - 1)
    }
}

fn slug(title: &str) -> String {
    let mut result = String::new();
    let mut separator = false;
    for c in title.chars().flat_map(char::to_lowercase) {
        if c.is_alphanumeric() || c == '_' {
            if separator && !result.is_empty() {
                result.push('-');
            }
            result.push(c);
            separator = false;
        } else {
            separator = true;
        }
    }
    if result.is_empty() {
        "section".into()
    } else {
        result
    }
}

impl Project {
    pub fn load(root: &Path) -> Result<Self, String> {
        let root = fs::canonicalize(root).map_err(|e| format!("project root: {e}"))?;
        if !root.is_dir() {
            return Err("project root is not a directory".into());
        }
        let config = Config::load(&root)?;
        let mut project = Self {
            root,
            config,
            files: BTreeMap::new(),
            nodes: BTreeMap::new(),
            edges: Vec::new(),
            diagnostics: Vec::new(),
            complete: true,
        };
        project.discover("");
        project.build_nodes();
        project.resolve();
        project.diagnostics.sort_by(|a, b| {
            (&a.path, a.line, &a.code, &a.message).cmp(&(&b.path, b.line, &b.code, &b.message))
        });
        project.complete = project.diagnostics.is_empty();
        Ok(project)
    }

    fn error(&mut self, code: &str, path: &str, line: Option<usize>, message: impl Into<String>) {
        self.diagnostics
            .push(QueryDiagnostic::new(code, path, line, message));
    }

    fn relevant(&self, path: &str) -> bool {
        let code_excluded = self
            .config
            .exclude
            .code
            .iter()
            .any(|p| config::in_scope(p, path));
        (!code_excluded
            && self
                .config
                .include
                .code
                .paths
                .iter()
                .any(|p| config::may_contain(p, path)))
            || self
                .config
                .include
                .docs
                .iter()
                .any(|p| config::may_contain(p, path))
    }

    fn discover(&mut self, directory: &str) {
        let entries = match fs::read_dir(self.root.join(directory)) {
            Ok(entries) => entries,
            Err(e) => {
                self.error("read-directory", directory, None, e.to_string());
                return;
            }
        };
        let mut paths = Vec::new();
        for entry in entries {
            match entry {
                Ok(entry) => paths.push(entry),
                Err(e) => self.error("read-directory", directory, None, e.to_string()),
            }
        }
        paths.sort_by_key(|entry| entry.file_name());
        for entry in paths {
            let name = entry.file_name();
            if name == ".git" {
                continue;
            }
            let display_name = name.to_string_lossy();
            let relative = if directory.is_empty() {
                display_name.to_string()
            } else {
                format!("{directory}/{display_name}")
            };
            if !self.relevant(&relative) {
                continue;
            }
            if name.to_str().is_none() {
                self.error(
                    "invalid-path",
                    directory,
                    None,
                    "non-UTF-8 directory entry in managed scope",
                );
                continue;
            }
            let metadata = match fs::symlink_metadata(entry.path()) {
                Ok(m) => m,
                Err(e) => {
                    self.error("read-metadata", &relative, None, e.to_string());
                    continue;
                }
            };
            if is_symlink(&metadata) {
                // A symlink directory might hide managed descendants; never inspect its target.
                self.error(
                    "unsafe-path",
                    &relative,
                    None,
                    "symlink/reparse point is not managed",
                );
                continue;
            }
            if metadata.is_dir() {
                self.discover(&relative);
                continue;
            }
            let code = self
                .config
                .include
                .code
                .paths
                .iter()
                .any(|p| config::in_scope(p, &relative))
                && self
                    .config
                    .include
                    .code
                    .extensions
                    .iter()
                    .any(|e| relative.ends_with(e))
                && !self
                    .config
                    .exclude
                    .code
                    .iter()
                    .any(|p| config::in_scope(p, &relative));
            let docs = relative.ends_with(".md")
                && self
                    .config
                    .include
                    .docs
                    .iter()
                    .any(|p| config::in_scope(p, &relative));
            if !code && !docs {
                continue;
            }
            match read_text(&self.root, &relative) {
                Ok(text) => {
                    let document = docs.then(|| markdown::parse(&text));
                    self.files.insert(relative, SourceFile { text, document });
                }
                Err(e) => self.error("read-file", &relative, None, e),
            }
        }
    }

    fn build_nodes(&mut self) {
        for (path, file) in &self.files {
            if let Some(document) = &file.document {
                let mut ids: Vec<String> = Vec::new();
                let mut used: BTreeMap<String, BTreeSet<String>> = BTreeMap::new();
                for section in &document.sections {
                    let parent = section
                        .ancestors
                        .last()
                        .map(|&i| ids[i].clone())
                        .unwrap_or_else(|| format!("{path}#"));
                    let siblings = used.entry(parent.clone()).or_default();
                    let base = slug(&section.title);
                    let mut component = base.clone();
                    let mut suffix = 2;
                    while siblings.contains(&component) {
                        component = format!("{base}-{suffix}");
                        suffix += 1;
                    }
                    siblings.insert(component.clone());
                    let id = format!(
                        "{parent}{}{component}",
                        if parent.ends_with('#') { "" } else { "/" }
                    );
                    let node = Node {
                        id: id.clone(),
                        kind: "section".into(),
                        path: path.clone(),
                        title: Some(section.title.clone()),
                        level: Some(section.level),
                        parents: section.ancestors.iter().map(|&i| ids[i].clone()).collect(),
                        line: section.line,
                        end_line: last_line(&file.text, section.source.start, section.source.end),
                        content: None,
                        children: Vec::new(),
                        regions: Vec::new(),
                        start: section.source.start,
                        end: section.source.end,
                    };
                    self.nodes.insert(id.clone(), node);
                    ids.push(id);
                }
            } else {
                self.nodes.insert(
                    path.clone(),
                    Node {
                        id: path.clone(),
                        kind: "code".into(),
                        path: path.clone(),
                        title: None,
                        level: None,
                        parents: Vec::new(),
                        line: 1,
                        end_line: last_line(&file.text, 0, file.text.len()),
                        content: None,
                        children: Vec::new(),
                        regions: Vec::new(),
                        start: 0,
                        end: file.text.len(),
                    },
                );
            }
        }
    }

    fn resolve(&mut self) {
        let mut diagnostics = Vec::new();
        let mut edges = BTreeSet::new();
        for (path, file) in &self.files {
            let Some(document) = &file.document else {
                continue;
            };
            for d in &document.diagnostics {
                diagnostics.push(QueryDiagnostic::new(
                    "annotation",
                    path,
                    Some(d.annotation.line),
                    format!("{:?}: {}", d.kind, d.annotation.target),
                ));
            }
            for section in &document.sections {
                let source = self
                    .nodes
                    .values()
                    .find(|n| n.path == *path && n.kind == "section" && n.line == section.line)
                    .expect("section node");
                let mut seen = BTreeSet::new();
                for annotation in &section.annotations {
                    let target = &annotation.target;
                    let error = if let Err(e) = config::validate_path(target, false) {
                        Some(e)
                    } else if !seen.insert(target) {
                        Some(format!("duplicate link: {target}"))
                    } else if self.nodes.get(target).is_none_or(|n| n.kind != "code") {
                        Some(format!("target is not a discovered code file: {target}"))
                    } else {
                        None
                    };
                    if let Some(message) = error {
                        diagnostics.push(QueryDiagnostic::new(
                            "link",
                            path,
                            Some(annotation.line),
                            message,
                        ));
                    } else {
                        edges.insert(Edge {
                            source: source.id.clone(),
                            target: target.clone(),
                        });
                    }
                }
            }
        }
        self.edges = edges.into_iter().collect();
        self.diagnostics.extend(diagnostics);
    }
}
