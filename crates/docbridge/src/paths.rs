//! Path safety shared by project discovery and lifecycle changes: symlinks and
//! reparse points are never followed, and every existing component must match
//! its directory entry exactly.
use std::{
    fs,
    io::ErrorKind,
    path::{Path, PathBuf},
};

pub(crate) fn is_link(metadata: &fs::Metadata) -> bool {
    #[cfg(windows)]
    {
        use std::os::windows::fs::MetadataExt;
        if metadata.file_attributes() & 0x400 != 0 {
            return true;
        }
    }
    metadata.file_type().is_symlink()
}

/// Resolve `relative` under the canonical `root`. Existing components must not
/// be links and must be spelled exactly as their directory entries, even on
/// case-folding file systems; trailing components may be missing.
pub(crate) fn resolve(root: &Path, relative: &str) -> Result<PathBuf, String> {
    crate::config::validate_path(relative, false)?;
    let root_metadata =
        fs::symlink_metadata(root).map_err(|e| format!("{}: {e}", root.display()))?;
    if is_link(&root_metadata) || !root_metadata.is_dir() {
        return Err(format!("unsafe project root: {}", root.display()));
    }
    let mut path = root.to_path_buf();
    let mut parent_is_dir = true;
    for (index, segment) in relative.split('/').enumerate() {
        if !parent_is_dir {
            return Err(format!("not a directory: {relative}"));
        }
        let exact = fs::read_dir(&path)
            .and_then(|entries| entries.collect::<Result<Vec<_>, _>>())
            .map_err(|e| format!("{relative}: {e}"))?
            .iter()
            .any(|entry| entry.file_name() == segment);
        path.push(segment);
        match fs::symlink_metadata(&path) {
            Ok(_) if !exact => {
                return Err(format!(
                    "path spelling does not match directory entry: {relative}"
                ))
            }
            Ok(metadata) if is_link(&metadata) => {
                return Err(format!("symlink/reparse point is not managed: {relative}"))
            }
            Ok(metadata) => parent_is_dir = metadata.is_dir(),
            Err(e) if e.kind() == ErrorKind::NotFound => {
                // The remaining components cannot exist either.
                path.extend(relative.split('/').skip(index + 1));
                return Ok(path);
            }
            Err(e) => return Err(format!("{relative}: {e}")),
        }
    }
    Ok(path)
}

/// Read the regular file at `relative` under `root`; see [`resolve`].
pub(crate) fn read(root: &Path, relative: &str) -> Result<Vec<u8>, String> {
    let path = resolve(root, relative)?;
    match fs::symlink_metadata(&path) {
        Ok(metadata) if metadata.is_file() => {
            fs::read(&path).map_err(|e| format!("{relative}: {e}"))
        }
        Ok(_) => Err(format!("not a regular file: {relative}")),
        Err(e) => Err(format!("{relative}: {e}")),
    }
}

/// An entry the walk did not inspect, with its diagnostic code.
pub(crate) struct Skipped {
    pub path: String,
    pub code: &'static str,
    pub reason: String,
}

/// Non-directory entries found by a walk, plus entries that were not
/// inspected. [`read`] rejects entries that are not regular files.
#[derive(Default)]
pub(crate) struct Walk {
    pub files: Vec<String>,
    pub skipped: Vec<Skipped>,
}

/// Walk `root` in name order without following links, skipping Git metadata
/// and entries for which `relevant` is false. Only an unreadable root is an
/// error; other problems are recorded in `skipped`.
pub(crate) fn walk(root: &Path, relevant: &dyn Fn(&str) -> bool) -> Result<Walk, String> {
    let mut out = Walk::default();
    visit(root, "", &mut out, relevant)?;
    Ok(out)
}

fn visit(
    root: &Path,
    directory: &str,
    out: &mut Walk,
    relevant: &dyn Fn(&str) -> bool,
) -> Result<(), String> {
    let path = if directory.is_empty() {
        root.to_path_buf()
    } else {
        root.join(directory)
    };
    let entries = match fs::symlink_metadata(&path) {
        Ok(m) if !is_link(&m) && m.is_dir() => fs::read_dir(&path)
            .and_then(|entries| entries.collect::<Result<Vec<_>, _>>())
            .map_err(|e| format!("unreadable: {e}")),
        Ok(_) => Err("changed during discovery; not inspected".into()),
        Err(e) => Err(format!("unreadable: {e}")),
    };
    let mut entries = match entries {
        Ok(entries) => entries,
        Err(e) if directory.is_empty() => return Err(format!("{}: {e}", path.display())),
        Err(reason) => {
            out.skipped.push(Skipped {
                path: directory.into(),
                code: "read-directory",
                reason,
            });
            return Ok(());
        }
    };
    entries.sort_by_key(|e| e.file_name());
    for entry in entries {
        let raw = entry.file_name();
        if raw == ".git" {
            continue;
        }
        let name = raw.to_string_lossy();
        let rel = if directory.is_empty() {
            name.into_owned()
        } else {
            format!("{directory}/{name}")
        };
        if !relevant(&rel) {
            continue;
        }
        let (code, reason) = if raw.to_str().is_none() {
            ("invalid-path", "non-UTF-8 name; not inspected".into())
        } else {
            match fs::symlink_metadata(entry.path()) {
                Err(e) => ("read-metadata", format!("unreadable: {e}")),
                Ok(m) if is_link(&m) => {
                    ("unsafe-path", "symlink/reparse point; not followed".into())
                }
                Ok(m) if m.is_dir() => {
                    visit(root, &rel, out, relevant)?;
                    continue;
                }
                Ok(_) => {
                    out.files.push(rel);
                    continue;
                }
            }
        };
        out.skipped.push(Skipped {
            path: rel,
            code,
            reason,
        });
    }
    Ok(())
}
