use std::{
    fs::{self, File, OpenOptions},
    path::Path,
};

fn checked_metadata(path: &Path, directory: bool) -> Result<fs::Metadata, String> {
    let metadata =
        fs::symlink_metadata(path).map_err(|e| format!("inspect {}: {e}", path.display()))?;
    if metadata.file_type().is_symlink()
        || (directory && !metadata.is_dir())
        || (!directory && !metadata.is_file())
    {
        return Err(format!(
            "{} must be a nonsymlink {}",
            path.display(),
            if directory {
                "directory"
            } else {
                "regular file"
            }
        ));
    }
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        if metadata.permissions().mode() & 0o022 != 0 {
            return Err(format!(
                "{} must not be writable by group or others",
                path.display()
            ));
        }
    }
    Ok(metadata)
}

pub(super) fn open_keys(root: &Path, relative: &str, append: bool) -> Result<File, String> {
    checked_directory_ancestors(root)?;
    checked_metadata(root, true)?;
    let mut path = root.to_path_buf();
    let components: Vec<_> = Path::new(relative).components().collect();
    for component in &components[..components.len() - 1] {
        path.push(component);
        checked_metadata(&path, true)?;
    }
    path.push(components.last().ok_or("empty trusted-keys path")?);
    let before = checked_metadata(&path, false)?;
    let file = OpenOptions::new()
        .read(true)
        .append(append)
        .open(&path)
        .map_err(|e| format!("open trusted keys: {e}"))?;
    let after = file.metadata().map_err(|e| e.to_string())?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::MetadataExt;
        if before.dev() != after.dev() || before.ino() != after.ino() {
            return Err("trusted-keys file changed while opening; nothing changed".into());
        }
    }
    #[cfg(not(unix))]
    let _ = (before, after);
    Ok(file)
}

fn checked_directory_ancestors(path: &Path) -> Result<(), String> {
    let absolute = if path.is_absolute() {
        path.to_path_buf()
    } else {
        std::env::current_dir()
            .map_err(|e| e.to_string())?
            .join(path)
    };
    if absolute
        .components()
        .any(|c| matches!(c, std::path::Component::ParentDir))
    {
        return Err("key operation paths must not contain parent traversal".into());
    }
    let mut prefix = std::path::PathBuf::new();
    for component in absolute.components() {
        prefix.push(component);
        if matches!(component, std::path::Component::Prefix(_)) {
            continue;
        }
        let metadata = fs::symlink_metadata(&prefix).map_err(|e| e.to_string())?;
        if metadata.file_type().is_symlink() || !metadata.is_dir() {
            return Err("key operation paths must contain only nonsymlink directories".into());
        }
    }
    Ok(())
}

#[cfg(unix)]
pub(super) fn create_backup(path: &Path) -> Result<File, String> {
    use std::os::unix::fs::{OpenOptionsExt, PermissionsExt};
    let absolute = if path.is_absolute() {
        path.to_path_buf()
    } else {
        std::env::current_dir()
            .map_err(|e| e.to_string())?
            .join(path)
    };
    let parent = absolute
        .parent()
        .ok_or("backup needs a private parent directory")?;
    // Resolve neither symlinks nor parent traversal into a supposedly private
    // directory. Ancestors can be public (e.g. /tmp); the immediate parent must
    // deny all group/other access. The operator controls its owner account.
    checked_directory_ancestors(parent)?;
    if absolute
        .components()
        .any(|c| matches!(c, std::path::Component::ParentDir))
    {
        return Err("backup path must not contain parent traversal".into());
    }
    if fs::metadata(parent)
        .map_err(|e| e.to_string())?
        .permissions()
        .mode()
        & 0o077
        != 0
    {
        return Err("backup parent directory must be private (mode 0700)".into());
    }
    OpenOptions::new()
        .write(true)
        .create_new(true)
        .mode(0o600)
        .open(&absolute)
        .map_err(|e| format!("create private backup exclusively (never overwrite): {e}"))
}

#[cfg(not(unix))]
pub(super) fn create_backup(_path: &Path) -> Result<File, String> {
    Err("private backup export is unavailable: Windows ACL privacy is not implemented; use a Unix host with a private directory".into())
}
