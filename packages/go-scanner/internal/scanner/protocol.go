// Package scanner implements the DocBridge Go scanner worker: go/parser-based
// `@doc` extraction for schemaVersion 1 of the shared worker protocol.
//
// JSON shapes mirror the Swift, Dart, and Rust scanners so the TypeScript core
// can validate and consume them identically. Optional fields are omitted, never
// emitted as null, and list fields always serialize as arrays.
package scanner

// Request is one worker request read from stdin.
type Request struct {
	SchemaVersion int           `json:"schemaVersion"`
	RequestID     string        `json:"requestId"`
	Language      string        `json:"language"`
	ProjectRoot   string        `json:"projectRoot"`
	Files         []RequestFile `json:"files"`
	Options       Options       `json:"options"`
}

// RequestFile is one file path/content pair to scan.
type RequestFile struct {
	FilePath string `json:"filePath"`
	Content  string `json:"content"`
}

// Options carries the language options; only visibility exists for Go.
type Options struct {
	Visibility []string `json:"visibility"`
}

// Response is the worker response written to stdout.
type Response struct {
	SchemaVersion int            `json:"schemaVersion"`
	RequestID     string         `json:"requestId"`
	Language      string         `json:"language"`
	Files         []FileResponse `json:"files"`
}

// FileResponse is the scan result of one requested file.
type FileResponse struct {
	FilePath            string       `json:"filePath"`
	Symbols             []CodeSymbol `json:"symbols"`
	UndocumentedSymbols []CodeSymbol `json:"undocumentedSymbols"`
	Links               []DocLink    `json:"links"`
	Diagnostics         []Diagnostic `json:"diagnostics"`
}

// CodeSymbol is a supported declaration exposed as a `file#canonicalId` endpoint.
type CodeSymbol struct {
	Kind             string          `json:"kind"`
	Language         string          `json:"language"`
	FilePath         string          `json:"filePath"`
	SymbolName       string          `json:"symbolName"`
	CanonicalID      string          `json:"canonicalId"`
	Endpoint         string          `json:"endpoint"`
	Location         *SourceLocation `json:"location"`
	NameRange        *SourceRange    `json:"nameRange,omitempty"`
	DeclarationRange *SourceRange    `json:"declarationRange,omitempty"`
	SignatureRange   *SourceRange    `json:"signatureRange,omitempty"`
}

// DocLink is one `@doc` annotation resolved to its source endpoint.
type DocLink struct {
	Source      string         `json:"source"`
	Target      string         `json:"target"`
	Location    SourceLocation `json:"location"`
	TargetRange *SourceRange   `json:"targetRange,omitempty"`
}

// Diagnostic is a scanner diagnostic in the shared diagnostic shape.
type Diagnostic struct {
	Severity string          `json:"severity"`
	Code     string          `json:"code"`
	Target   string          `json:"target"`
	Language string          `json:"language,omitempty"`
	Source   *string         `json:"source,omitempty"`
	Message  string          `json:"message"`
	Location *SourceLocation `json:"location,omitempty"`
	Range    *SourceRange    `json:"range,omitempty"`
}

// SourceLocation is a 1-based line and UTF-16 column in a file.
type SourceLocation struct {
	FilePath string `json:"filePath"`
	Line     int    `json:"line"`
	Column   int    `json:"column"`
}

// SourceRange is an end-exclusive range of positions.
type SourceRange struct {
	Start Position `json:"start"`
	End   Position `json:"end"`
}

// Position is a 1-based line and UTF-16 column.
type Position struct {
	Line   int `json:"line"`
	Column int `json:"column"`
}
