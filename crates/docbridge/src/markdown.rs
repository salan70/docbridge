use crate::model::{Annotation, Diagnostic, DiagnosticKind, Document, Section};

/// Parse syntax only; targets and section identities remain uninterpreted.
pub fn parse(source: &str) -> Document {
    let mut document = Document::default();
    let mut pending = Vec::new();
    let mut ancestors: Vec<usize> = Vec::new();
    let mut fence: Option<(u8, usize)> = None;
    let mut comment = false;
    let mut offset = 0;

    for (index, raw) in source.split_inclusive('\n').enumerate() {
        let line = raw.trim_end_matches(['\n', '\r']);
        let trimmed = line.trim_start_matches(' ');
        let indentation = line.len() - trimmed.len();
        let line_number = index + 1;

        if let Some((marker, length)) = fence {
            if indentation <= 3 && closes_fence(trimmed, marker, length) {
                fence = None;
            }
        } else if comment {
            if let Some(end) = line.find("-->") {
                comment = false;
                update_comment_state(&line[end + 3..], &mut comment);
            }
        } else if let Some(opening) = (indentation <= 3).then(|| opening_fence(trimmed)).flatten() {
            interrupt(
                &mut document,
                &mut pending,
                DiagnosticKind::InterruptedAnnotation,
            );
            fence = Some(opening);
        } else if let Some(target) = (indentation <= 3).then(|| annotation(trimmed)).flatten() {
            pending.push(Annotation {
                target: target.to_owned(),
                line: line_number,
            });
        } else if let Some((level, title)) = (indentation <= 3).then(|| heading(trimmed)).flatten()
        {
            while let Some(&parent) = ancestors.last() {
                if document.sections[parent].level < level {
                    break;
                }
                document.sections[parent].source.end = offset;
                ancestors.pop();
            }
            let section = Section {
                title: title.to_owned(),
                level,
                ancestors: ancestors.clone(),
                line: line_number,
                source: offset..source.len(),
                annotations: std::mem::take(&mut pending),
            };
            ancestors.push(document.sections.len());
            document.sections.push(section);
            update_comment_state(line, &mut comment);
        } else if !line.trim().is_empty() {
            interrupt(
                &mut document,
                &mut pending,
                DiagnosticKind::InterruptedAnnotation,
            );
            update_comment_state(line, &mut comment);
        }
        offset += raw.len();
    }
    interrupt(
        &mut document,
        &mut pending,
        DiagnosticKind::DanglingAnnotation,
    );
    document
}

fn interrupt(document: &mut Document, pending: &mut Vec<Annotation>, kind: DiagnosticKind) {
    document.diagnostics.extend(
        pending
            .drain(..)
            .map(|annotation| Diagnostic { kind, annotation }),
    );
}

fn annotation(line: &str) -> Option<&str> {
    let line = line.trim_end_matches([' ', '\t']);
    let content = line.strip_prefix("<!--")?.strip_suffix("-->")?.trim();
    let target = content.strip_prefix("@code")?;
    if !target.starts_with(char::is_whitespace) {
        return None;
    }
    let target = target.trim();
    if target.is_empty() || target.contains("<!--") || target.contains("-->") {
        return None;
    }
    Some(target)
}

fn heading(line: &str) -> Option<(u8, &str)> {
    let count = line.bytes().take_while(|&byte| byte == b'#').count();
    if !(1..=6).contains(&count) {
        return None;
    }
    let rest = &line[count..];
    if !rest.is_empty() && !rest.starts_with([' ', '\t']) {
        return None;
    }
    let title = rest.trim_matches([' ', '\t']);
    let without_hashes = title.trim_end_matches('#');
    let title = if without_hashes.is_empty() || without_hashes.ends_with([' ', '\t']) {
        without_hashes.trim_end_matches([' ', '\t'])
    } else {
        title
    };
    Some((count as u8, title))
}

fn opening_fence(line: &str) -> Option<(u8, usize)> {
    let marker = *line.as_bytes().first()?;
    if marker != b'`' && marker != b'~' {
        return None;
    }
    let count = line.bytes().take_while(|&byte| byte == marker).count();
    if count < 3 || (marker == b'`' && line[count..].contains('`')) {
        return None;
    }
    Some((marker, count))
}

fn closes_fence(line: &str, marker: u8, length: usize) -> bool {
    let count = line.bytes().take_while(|&byte| byte == marker).count();
    count >= length && line[count..].trim_matches([' ', '\t']).is_empty()
}

fn update_comment_state(mut line: &str, comment: &mut bool) {
    while let Some(start) = line.find("<!--") {
        line = &line[start + 4..];
        if let Some(end) = line.find("-->") {
            line = &line[end + 3..];
        } else {
            *comment = true;
            break;
        }
    }
}
