use std::ops::Range;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Annotation {
    pub target: String,
    pub line: usize,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Section {
    pub title: String,
    pub level: u8,
    /// Indices into `Document.sections`, ordered from root to immediate parent.
    pub ancestors: Vec<usize>,
    pub line: usize,
    /// Byte range including the heading and all descendant content.
    pub source: Range<usize>,
    pub annotations: Vec<Annotation>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum DiagnosticKind {
    InterruptedAnnotation,
    DanglingAnnotation,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Diagnostic {
    pub kind: DiagnosticKind,
    pub annotation: Annotation,
}

#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct Document {
    pub sections: Vec<Section>,
    pub diagnostics: Vec<Diagnostic>,
}
