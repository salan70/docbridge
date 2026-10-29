const GUIDES: &[(&str, &str, &str)] = &[
    (
        "getting-started",
        "Start using DocBridge",
        include_str!("../guides/getting-started.md"),
    ),
    (
        "configuration",
        "Configure managed files",
        include_str!("../guides/configuration.md"),
    ),
    (
        "linking",
        "Link sections to code",
        include_str!("../guides/linking.md"),
    ),
    (
        "commands",
        "Command reference",
        include_str!("../guides/commands.md"),
    ),
    (
        "troubleshooting",
        "Resolve diagnostics",
        include_str!("../guides/troubleshooting.md"),
    ),
    (
        "automation",
        "Automate structural checks",
        include_str!("../guides/automation.md"),
    ),
    (
        "migration",
        "Migrate an existing project",
        include_str!("../guides/migration.md"),
    ),
    (
        "deinit",
        "Remove project assets",
        include_str!("../guides/deinit.md"),
    ),
];

pub fn list() -> String {
    use std::fmt::Write;
    GUIDES
        .iter()
        .fold(String::new(), |mut out, (name, description, _)| {
            let _ = writeln!(out, "{name}: {description}");
            out
        })
}

pub fn show(name: &str) -> Option<&'static str> {
    GUIDES
        .iter()
        .find(|(id, _, _)| *id == name)
        .map(|(_, _, content)| *content)
}

pub fn overview() -> String {
    format!(
        "Start with docbridge init, then docbridge validate.\n\nGuides:\n{}",
        list()
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn guides_are_embedded_and_listed() {
        for name in [
            "getting-started",
            "configuration",
            "linking",
            "commands",
            "troubleshooting",
            "automation",
            "migration",
            "deinit",
        ] {
            assert!(!show(name).unwrap().trim().is_empty(), "{name}");
            assert!(list().contains(name), "{name}");
            assert!(overview().contains(name), "{name}");
        }
        assert!(show("unknown").is_none());
        assert!(overview().contains("init"));
    }
}
