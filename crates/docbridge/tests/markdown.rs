use docbridge::{model::DiagnosticKind, parse};

#[test]
fn tracks_another_comment_after_a_multiline_comment_closes() {
    let doc = parse("<!-- start\n--> <!-- next\n# Hidden\n-->\n# Visible\n");
    assert_eq!(doc.sections.len(), 1);
    assert_eq!(doc.sections[0].title, "Visible");
}

#[test]
fn accepts_surrounding_annotation_whitespace_and_preserves_raw_target() {
    let doc = parse("  <!-- @code ./日本語 file.rs --> \t\n# A");
    assert_eq!(doc.sections[0].annotations.len(), 1);
    assert_eq!(doc.sections[0].annotations[0].target, "./日本語 file.rs");
    assert!(doc.diagnostics.is_empty());
}

#[test]
fn only_matching_long_enough_fence_without_trailing_text_closes() {
    let doc = parse("````\n```\n# hidden\n~~~~\n# hidden\n```` text\n# hidden\n`````\n# visible\n");
    assert_eq!(doc.sections.len(), 1);
    assert_eq!(doc.sections[0].title, "visible");
}

#[test]
fn inline_and_multiline_comments_cannot_define_annotations() {
    let doc = parse("text <!--\n# hidden\n<!-- @code fake -->\n<!-- ordinary --> <!-- @code fake -->\n<!--\n@code fake\n-->\n# visible\n");
    assert_eq!(doc.sections.len(), 1);
    assert!(doc.sections[0].annotations.is_empty());
    assert!(doc.diagnostics.is_empty());
}

#[test]
fn retains_actual_ancestors_and_nested_source_ranges() {
    let source = "intro\n# Root\nbody\n### Child\nchild\n## Peer\n# Root\n";
    let doc = parse(source);
    assert_eq!(doc.sections.len(), 4);
    assert_eq!(doc.sections[0].title, "Root");
    assert_eq!(doc.sections[1].ancestors, vec![0]);
    assert_eq!(doc.sections[2].ancestors, vec![0]);
    assert!(doc.sections[3].ancestors.is_empty());
    assert_eq!(doc.sections[1].line, 4);
    assert_eq!(
        &source[doc.sections[0].source.clone()],
        "# Root\nbody\n### Child\nchild\n## Peer\n"
    );
    assert_eq!(
        &source[doc.sections[1].source.clone()],
        "### Child\nchild\n"
    );
}

#[test]
fn attaches_multiple_annotations_across_blank_lines_without_deduplicating() {
    let doc = parse("<!-- @code a.rs -->\n\n<!-- @code a.rs -->\n<!-- @code b.rs -->\n# A\n<!-- @code a.rs -->\n## B");
    assert_eq!(
        doc.sections[0]
            .annotations
            .iter()
            .map(|a| a.target.as_str())
            .collect::<Vec<_>>(),
        vec!["a.rs", "a.rs", "b.rs"]
    );
    assert_eq!(doc.sections[0].annotations[1].line, 3);
    assert_eq!(doc.sections[1].annotations[0].target, "a.rs");
    assert!(doc.diagnostics.is_empty());
}

#[test]
fn reports_interruption_and_end_of_input_for_each_annotation() {
    let doc = parse(
        "<!-- @code a -->\ntext\n# A\n<!-- @code b -->\n<!-- ordinary -->\n<!-- @code c -->\n",
    );
    assert_eq!(
        doc.diagnostics.iter().map(|d| d.kind).collect::<Vec<_>>(),
        vec![
            DiagnosticKind::InterruptedAnnotation,
            DiagnosticKind::InterruptedAnnotation,
            DiagnosticKind::DanglingAnnotation
        ]
    );
    assert_eq!(doc.diagnostics[2].annotation.line, 6);
    assert!(doc.sections[0].annotations.is_empty());
}

#[test]
fn suppresses_fences_and_other_comments_including_nested_examples() {
    let doc = parse("```md\n# Fake\n<!-- @code fake -->\n````\n~~~\n# Fake\n~~~\n<!-- outer\n<!-- @code fake -->\n# Real\n<!-- ordinary --> # Hidden\n# Last\n");
    assert_eq!(
        doc.sections
            .iter()
            .map(|s| s.title.as_str())
            .collect::<Vec<_>>(),
        vec!["Real", "Last"]
    );
    assert!(doc.diagnostics.is_empty());
}

#[test]
fn preserves_all_atx_levels_and_empty_nodes_but_excludes_setext() {
    let doc = parse("Setext\n===\n# A ###\n## B\n### C\n#### D\n##### E\n###### F\n#\n####### nope\n#nope\n    # indented\n");
    assert_eq!(
        doc.sections.iter().map(|s| s.level).collect::<Vec<_>>(),
        vec![1, 2, 3, 4, 5, 6, 1]
    );
    assert_eq!(doc.sections[0].title, "A");
    assert_eq!(doc.sections[5].ancestors, vec![0, 1, 2, 3, 4]);
    assert_eq!(doc.sections[6].title, "");
}

#[test]
fn keeps_unicode_crlf_and_unclosed_fence_ranges_in_source_bytes() {
    let source = "# 日本語\r\ntext\r\n~~~\r\n# hidden";
    let doc = parse(source);
    assert_eq!(doc.sections.len(), 1);
    assert_eq!(doc.sections[0].title, "日本語");
    assert_eq!(&source[doc.sections[0].source.clone()], source);
}
