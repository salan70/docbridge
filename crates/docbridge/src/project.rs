use crate::{
    config::{self, Config},
    markdown,
    model::Document,
    output::{Edge, Node, QueryDiagnostic},
    paths,
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

/// Read managed text under the canonical `root`. Links are rejected, and each
/// existing component must match its directory entry exactly.
pub fn read_text(root: &Path, relative: &str) -> Result<String, String> {
    let text =
        String::from_utf8(paths::read(root, relative)?).map_err(|e| format!("{relative}: {e}"))?;
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

pub(crate) fn slug(title: &str) -> String {
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

/// The configured kinds that manage `relative` as a file: code needs an
/// include scope, a configured extension, and no exclusion; docs need a `.md`
/// suffix under `include.docs`. Discovery walks broadly with `relevant` and
/// keeps only these files.
fn managed_kinds(config: &Config, relative: &str) -> (bool, bool) {
    let code = config
        .include
        .code
        .paths
        .iter()
        .any(|p| config::in_scope(p, relative))
        && config
            .include
            .code
            .extensions
            .iter()
            .any(|e| relative.ends_with(e))
        && !config
            .exclude
            .code
            .iter()
            .any(|p| config::in_scope(p, relative));
    let docs = relative.ends_with(".md")
        && config
            .include
            .docs
            .iter()
            .any(|p| config::in_scope(p, relative));
    (code, docs)
}

/// A configuration check that keeps `relative` out of the managed set.
#[derive(Debug)]
pub(crate) enum Unmanaged {
    OutsideCodePaths,
    ExtensionNotListed(String),
    NoExtension,
    Excluded(String),
    OutsideDocs,
}

impl Unmanaged {
    /// The reason phrased for a diagnostic message, naming the configuration
    /// key — and the pattern for an exclusion — that rejected the path.
    pub(crate) fn describe(&self) -> String {
        match self {
            Self::OutsideCodePaths => "outside every include.code.paths entry".into(),
            Self::ExtensionNotListed(extension) => {
                format!("extension {extension} is not in include.code.extensions")
            }
            Self::NoExtension => "file has no extension".into(),
            Self::Excluded(pattern) => {
                format!("matched by exclude.code pattern {pattern:?}")
            }
            Self::OutsideDocs => "outside every include.docs entry".into(),
        }
    }
}

/// The file name's last dotted suffix — the part `include.code.extensions`
/// matches against — when the name has one.
fn extension(relative: &str) -> Option<String> {
    let name = relative.rsplit('/').next().unwrap_or(relative);
    match name.rsplit_once('.') {
        Some((_, suffix)) if !suffix.is_empty() => Some(format!(".{suffix}")),
        _ => None,
    }
}

/// Every reason `relative` is not a managed file, mirroring `managed_kinds`;
/// the list is empty exactly when the configuration manages the path. A `.md`
/// path reports only the docs-side reason; any other path reports each failed
/// code-side check.
pub(crate) fn unmanaged_reasons(config: &Config, relative: &str) -> Vec<Unmanaged> {
    let (code, docs) = managed_kinds(config, relative);
    if code || docs {
        return Vec::new();
    }
    let mut reasons = Vec::new();
    if relative.ends_with(".md") {
        if !config
            .include
            .docs
            .iter()
            .any(|p| config::in_scope(p, relative))
        {
            reasons.push(Unmanaged::OutsideDocs);
        }
        return reasons;
    }
    if !config
        .include
        .code
        .paths
        .iter()
        .any(|p| config::in_scope(p, relative))
    {
        reasons.push(Unmanaged::OutsideCodePaths);
    }
    if !config
        .include
        .code
        .extensions
        .iter()
        .any(|e| relative.ends_with(e))
    {
        reasons.push(match extension(relative) {
            Some(extension) => Unmanaged::ExtensionNotListed(extension),
            None => Unmanaged::NoExtension,
        });
    }
    if let Some(pattern) = config
        .exclude
        .code
        .iter()
        .find(|p| config::in_scope(p, relative))
    {
        reasons.push(Unmanaged::Excluded(pattern.clone()));
    }
    reasons
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
        project.discover();
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

    /// Whether the configured include/exclude patterns manage `relative` as a
    /// file. The file may still be missing, unreadable, or unsafe on disk.
    pub(crate) fn manages(&self, relative: &str) -> bool {
        let (code, docs) = managed_kinds(&self.config, relative);
        code || docs
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

    fn discover(&mut self) {
        let found = match paths::walk(&self.root, &|p| self.relevant(p)) {
            Ok(found) => found,
            Err(e) => return self.error("read-directory", "", None, e),
        };
        for skipped in found.skipped {
            self.error(skipped.code, &skipped.path, None, skipped.reason);
        }
        for relative in found.files {
            let (code, docs) = managed_kinds(&self.config, &relative);
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
                        selected: false,
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
                        selected: false,
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
