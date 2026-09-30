package scanner

import (
	"encoding/json"
	"fmt"
	"strings"
	"testing"
)

const filePath = "internal/auth/service.go"

func scan(t *testing.T, content string, visibility []string) FileResponse {
	t.Helper()
	return ScanFile(filePath, content, visibility)
}

func symbolIDs(symbols []CodeSymbol) []string {
	ids := make([]string, 0, len(symbols))
	for _, symbol := range symbols {
		ids = append(ids, symbol.CanonicalID)
	}
	return ids
}

func diagnosticCodes(diagnostics []Diagnostic) []string {
	codes := make([]string, 0, len(diagnostics))
	for _, diagnostic := range diagnostics {
		codes = append(codes, diagnostic.Code)
	}
	return codes
}

func assertEqual[T comparable](t *testing.T, label string, got, want T) {
	t.Helper()
	if got != want {
		t.Errorf("%s: got %v, want %v", label, got, want)
	}
}

func assertList(t *testing.T, label string, got, want []string) {
	t.Helper()
	if strings.Join(got, ",") != strings.Join(want, ",") {
		t.Errorf("%s: got %v, want %v", label, got, want)
	}
}

func TestCanonicalIDsAndVisibility(t *testing.T) {
	source := `package auth

// Login authenticates.
//
// @doc docs/auth.md#login
func Login() {}

// login is unexported.
//
// @doc docs/auth.md#login-internal
func login() {}

// @doc docs/auth.md#server
type Server struct{}

// @doc docs/auth.md#start
func (s *Server) Start() {}

// @doc docs/auth.md#stop
func (s Server) stop() {}

// @doc docs/auth.md#list
type List[T any] struct{}

// @doc docs/auth.md#push
func (l *List[T]) Push(v T) {}

// @doc docs/auth.md#pairs
func (p *Pairs[K, V]) Len() int { return 0 }

// @doc docs/auth.md#paren
func (s (*Server)) Paren() {}

// @doc docs/auth.md#reader
type Reader interface {
	// @doc docs/auth.md#read
	Read(p []byte) (int, error)
	// @doc docs/auth.md#close
	close()
}

// @doc docs/auth.md#hidden
type hidden struct{}

// @doc docs/auth.md#hidden-exported
func (h hidden) Exported() {}

// @doc docs/auth.md#max
const MaxRetries = 3

// @doc docs/auth.md#alias
type Alias = Server
`
	cases := []struct {
		name       string
		visibility []string
		want       []string
	}{
		{"default is exported", nil, []string{"Login", "Server", "Server.Start", "List", "List.Push", "Pairs.Len", "Server.Paren", "Reader", "Reader.Read", "MaxRetries", "Alias"}},
		{"explicit exported", []string{"exported"}, []string{"Login", "Server", "Server.Start", "List", "List.Push", "Pairs.Len", "Server.Paren", "Reader", "Reader.Read", "MaxRetries", "Alias"}},
		{"unexported only", []string{"unexported"}, []string{"login", "Server.stop", "Reader.close", "hidden", "hidden.Exported"}},
		{"both", []string{"exported", "unexported"}, []string{"Login", "login", "Server", "Server.Start", "Server.stop", "List", "List.Push", "Pairs.Len", "Server.Paren", "Reader", "Reader.Read", "Reader.close", "hidden", "hidden.Exported", "MaxRetries", "Alias"}},
		{"empty", []string{}, []string{}},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			result := scan(t, source, tc.visibility)
			assertList(t, "symbols", symbolIDs(result.Symbols), tc.want)
			assertList(t, "diagnostics", diagnosticCodes(result.Diagnostics), []string{})
			assertEqual(t, "links", len(result.Links), len(tc.want))
		})
	}
}

func TestSymbolShapeAndRanges(t *testing.T) {
	source := "package auth\n\n// Login authenticates.\n//\n// @doc docs/auth.md#login\nfunc Login(name string) error {\n\treturn nil\n}\n\nfunc Logout() {}\n"
	result := scan(t, source, nil)
	if len(result.Symbols) != 1 {
		t.Fatalf("symbols: %v", symbolIDs(result.Symbols))
	}
	symbol := result.Symbols[0]
	assertEqual(t, "kind", symbol.Kind, "code")
	assertEqual(t, "language", symbol.Language, "go")
	assertEqual(t, "endpoint", symbol.Endpoint, filePath+"#Login")
	assertEqual(t, "symbolName", symbol.SymbolName, "Login")
	assertEqual(t, "location", *symbol.Location, SourceLocation{FilePath: filePath, Line: 6, Column: 6})
	assertEqual(t, "nameRange", *symbol.NameRange, SourceRange{Start: Position{6, 6}, End: Position{6, 11}})
	assertEqual(t, "declarationRange", *symbol.DeclarationRange, SourceRange{Start: Position{3, 1}, End: Position{8, 2}})
	assertEqual(t, "signatureRange", *symbol.SignatureRange, SourceRange{Start: Position{3, 1}, End: Position{6, 30}})

	assertList(t, "undocumented", symbolIDs(result.UndocumentedSymbols), []string{"Logout"})
	assertEqual(t, "undocumented location", *result.UndocumentedSymbols[0].Location, SourceLocation{FilePath: filePath, Line: 10, Column: 6})

	if len(result.Links) != 1 {
		t.Fatalf("links: %v", result.Links)
	}
	link := result.Links[0]
	assertEqual(t, "link source", link.Source, filePath+"#Login")
	assertEqual(t, "link target", link.Target, "docs/auth.md#login")
	assertEqual(t, "link location", link.Location, SourceLocation{FilePath: filePath, Line: 5, Column: 9})
	assertEqual(t, "link targetRange", *link.TargetRange, SourceRange{Start: Position{5, 9}, End: Position{5, 27}})
}

func TestInterfaceMethodRangesIncludeDoc(t *testing.T) {
	source := "package auth\n\ntype Reader interface {\n\t// Read reads.\n\t// @doc docs/io.md#read\n\tRead(p []byte) (int, error)\n}\n"
	result := scan(t, source, nil)
	assertList(t, "symbols", symbolIDs(result.Symbols), []string{"Reader.Read"})
	method := result.Symbols[0]
	assertEqual(t, "declarationRange", *method.DeclarationRange, SourceRange{Start: Position{4, 2}, End: Position{6, 29}})
	assertEqual(t, "signatureRange", *method.SignatureRange, SourceRange{Start: Position{4, 2}, End: Position{6, 29}})
	assertList(t, "undocumented", symbolIDs(result.UndocumentedSymbols), []string{"Reader"})
}

func TestBlockCommentDocForms(t *testing.T) {
	cases := []struct {
		name   string
		source string
		column int
		line   int
	}{
		{"block comment", "package auth\n\n/*\n * Login authenticates.\n * @doc docs/auth.md#login\n */\nfunc Login() {}\n", 9, 5},
		{"target adjacent to closing delimiter", "package auth\n\n/* @doc docs/auth.md#login*/\nfunc Login() {}\n", 9, 3},
		{"crlf block comment", "package auth\r\n\r\n/*\r\n@doc docs/auth.md#login\r\n*/\r\nfunc Login() {}\r\n", 6, 4},
		{"crlf line comment", "package auth\r\n\r\n// @doc docs/auth.md#login\r\nfunc Login() {}\r\n", 9, 3},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			result := scan(t, tc.source, nil)
			assertList(t, "symbols", symbolIDs(result.Symbols), []string{"Login"})
			if len(result.Links) != 1 {
				t.Fatalf("links: %v", result.Links)
			}
			assertEqual(t, "target", result.Links[0].Target, "docs/auth.md#login")
			assertEqual(t, "location", result.Links[0].Location, SourceLocation{FilePath: filePath, Line: tc.line, Column: tc.column})
			assertEqual(t, "range end", result.Links[0].TargetRange.End, Position{tc.line, tc.column + len("docs/auth.md#login")})
		})
	}
}

func TestNonASCIIColumnsCountUTF16(t *testing.T) {
	source := "package auth\n\n// ログイン 😀\n// @doc docs/ログイン😀.md#login\nfunc Login() string { return \"😀\" }\n"
	result := scan(t, source, nil)
	assertEqual(t, "target", result.Links[0].Target, "docs/ログイン😀.md#login")
	assertEqual(t, "location", result.Links[0].Location, SourceLocation{FilePath: filePath, Line: 4, Column: 9})
	assertEqual(t, "range", *result.Links[0].TargetRange, SourceRange{Start: Position{4, 9}, End: Position{4, 29}})
	assertEqual(t, "symbol location", *result.Symbols[0].Location, SourceLocation{FilePath: filePath, Line: 5, Column: 6})
}

func TestGroupedDeclarations(t *testing.T) {
	source := `package auth

// Group doc.
//
// @doc docs/auth.md#group
const (
	// @doc docs/auth.md#first
	First = iota
	Second
)

// Single-spec group doc.
//
// @doc docs/auth.md#single
var (
	Single = 1
)

// @doc docs/auth.md#pair
var A, B int

var _ Reader = (*Server)(nil)

type (
	// @doc docs/auth.md#server
	Server struct{}
	Client struct{}
)
`
	result := scan(t, source, nil)
	assertList(t, "symbols", symbolIDs(result.Symbols), []string{"First", "Server"})
	assertList(t, "undocumented", symbolIDs(result.UndocumentedSymbols), []string{"Second", "Single", "A", "B", "Client"})
	assertList(t, "diagnostics", diagnosticCodes(result.Diagnostics), []string{"unsupported_declaration", "unsupported_declaration", "unsupported_declaration"})
	assertEqual(t, "group doc location", *result.Diagnostics[0].Location, SourceLocation{FilePath: filePath, Line: 6, Column: 1})
	assertEqual(t, "single-spec group location", *result.Diagnostics[1].Location, SourceLocation{FilePath: filePath, Line: 15, Column: 1})
	assertEqual(t, "multi-name location", *result.Diagnostics[2].Location, SourceLocation{FilePath: filePath, Line: 20, Column: 5})

	first := result.Symbols[0]
	assertEqual(t, "spec declarationRange", *first.DeclarationRange, SourceRange{Start: Position{7, 2}, End: Position{8, 14}})
	assertEqual(t, "spec signatureRange", *first.SignatureRange, SourceRange{Start: Position{7, 2}, End: Position{8, 14}})
}

func TestUnsupportedDeclarations(t *testing.T) {
	source := `// Package auth handles auth.
//
// @doc docs/auth.md#package
package auth

// @doc docs/auth.md#import
import "fmt"

// @doc docs/auth.md#server
type Server struct {
	// @doc docs/auth.md#field
	Name string
	// @doc docs/auth.md#embedded
	fmt.Stringer
}

type Number interface {
	// @doc docs/auth.md#union
	int | float64
	// @doc docs/auth.md#approx
	~string
	// @doc docs/auth.md#embedded-iface
	fmt.Stringer
}

// @doc docs/auth.md#init
func init() {}

// @doc docs/auth.md#blank
func _() {}

// @doc docs/auth.md#multi
func (a, b Server) Multi() {}

// @doc docs/auth.md#cgo
func (c *C.thing) Cgo() {}

func Body() {
	// @doc docs/auth.md#body
	_ = 1
}

// func Old() {}
// @doc docs/auth.md#commented-out
`
	result := scan(t, source, nil)
	assertList(t, "symbols", symbolIDs(result.Symbols), []string{"Server"})
	assertList(t, "undocumented", symbolIDs(result.UndocumentedSymbols), []string{"Number", "Body"})
	want := []string{"unsupported_declaration", "unsupported_declaration", "unsupported_declaration", "unsupported_declaration", "unsupported_declaration", "unsupported_declaration", "unsupported_declaration", "unsupported_declaration", "unsupported_declaration", "unsupported_declaration", "unsupported_declaration"}
	assertList(t, "diagnostics", diagnosticCodes(result.Diagnostics), want)
	locations := []SourceLocation{
		{filePath, 4, 9},   // package name
		{filePath, 7, 8},   // import path
		{filePath, 12, 2},  // struct field name
		{filePath, 14, 2},  // embedded field
		{filePath, 19, 2},  // union element
		{filePath, 21, 2},  // approximation element
		{filePath, 23, 2},  // embedded interface
		{filePath, 27, 6},  // init
		{filePath, 30, 6},  // blank func
		{filePath, 33, 20}, // multi receiver
		{filePath, 36, 19}, // cgo receiver
	}
	for index, location := range locations {
		if index >= len(result.Diagnostics) {
			break
		}
		assertEqual(t, fmt.Sprintf("location %d", index), *result.Diagnostics[index].Location, location)
		assertEqual(t, "message", result.Diagnostics[index].Message, "Go declaration annotated with @doc is not supported.")
		assertEqual(t, "severity", result.Diagnostics[index].Severity, "warning")
	}
}

func TestDuplicateEndpointsAndLinks(t *testing.T) {
	source := `package auth

// @doc docs/auth.md#t
type T interface {
	// @doc docs/auth.md#read
	M()
}

// @doc docs/auth.md#read-again
func (T) M() {}

// @doc docs/auth.md#n
// @doc docs/auth.md#n
func (t T) N() {}

// @doc bad-target
// @doc /abs/path.md#x
// @doc internal/auth/service.go#self
func Invalid() {}
`
	result := scan(t, source, nil)
	assertList(t, "symbols", symbolIDs(result.Symbols), []string{"T", "T.M", "T.N", "Invalid"})
	codes := diagnosticCodes(result.Diagnostics)
	assertList(t, "codes", codes, []string{"duplicate_code_symbol", "duplicate_link", "invalid_link_target", "invalid_link_target", "invalid_link_target"})
	assertEqual(t, "duplicate target", result.Diagnostics[0].Target, filePath+"#T.M")
	assertEqual(t, "duplicate severity", result.Diagnostics[0].Severity, "error")
	assertEqual(t, "duplicate location", *result.Diagnostics[0].Location, SourceLocation{FilePath: filePath, Line: 10, Column: 10})
	assertEqual(t, "duplicate link source", *result.Diagnostics[1].Source, filePath+"#T.N")
	assertEqual(t, "duplicate link severity", result.Diagnostics[1].Severity, "warning")
	assertEqual(t, "duplicate link location", *result.Diagnostics[1].Location, SourceLocation{FilePath: filePath, Line: 13, Column: 9})
	assertEqual(t, "invalid severity", result.Diagnostics[2].Severity, "error")
	assertEqual(t, "links", len(result.Links), 3)
}

func TestParseErrorUsesEarliestPhysicalOffset(t *testing.T) {
	cases := []struct {
		name    string
		source  string
		line    int
		column  int
		message string
	}{
		{"trailing garbage", "package auth\n\n// @doc docs/auth.md#login\nfunc Login() {}\n  /* 😀 */ )\n", 5, 12, "Go parse error: expected declaration, found ')'."},
		{"line directive does not move the location", "package auth\n\n//line other.go:100\nfunc Login( {}\n", 4, 13, "Go parse error: expected ')', found '{'."},
		{"missing package clause", "func Login() {}\n", 1, 1, "Go parse error: expected 'package', found 'func'."},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			result := scan(t, tc.source, nil)
			assertEqual(t, "symbols", len(result.Symbols), 0)
			assertEqual(t, "undocumented", len(result.UndocumentedSymbols), 0)
			assertEqual(t, "links", len(result.Links), 0)
			if len(result.Diagnostics) != 1 {
				t.Fatalf("diagnostics: %v", result.Diagnostics)
			}
			diagnostic := result.Diagnostics[0]
			assertEqual(t, "code", diagnostic.Code, "code_parse_error")
			assertEqual(t, "severity", diagnostic.Severity, "error")
			assertEqual(t, "target", diagnostic.Target, filePath)
			assertEqual(t, "message", diagnostic.Message, tc.message)
			assertEqual(t, "location", *diagnostic.Location, SourceLocation{FilePath: filePath, Line: tc.line, Column: tc.column})
		})
	}
}

func TestBOMIsAccepted(t *testing.T) {
	source := "\uFEFFpackage auth\n\n// @doc docs/auth.md#login\nfunc Login() {}\n"
	result := scan(t, source, nil)
	assertList(t, "diagnostics", diagnosticCodes(result.Diagnostics), []string{})
	assertList(t, "symbols", symbolIDs(result.Symbols), []string{"Login"})
	assertEqual(t, "location", *result.Symbols[0].Location, SourceLocation{FilePath: filePath, Line: 4, Column: 6})
}

func TestScanRequestJSON(t *testing.T) {
	request := `{"schemaVersion":1,"requestId":"req-1","language":"go","projectRoot":"/tmp/project","files":[{"filePath":"a.go","content":"package a\n\n// @doc docs/a.md#x\nfunc X() {}\n"},{"filePath":"b.go","content":"package b\n"}],"options":{"visibility":["exported"]}}`
	output, err := ScanRequestJSON([]byte(request))
	if err != nil {
		t.Fatal(err)
	}
	var response map[string]any
	if err := json.Unmarshal(output, &response); err != nil {
		t.Fatal(err)
	}
	assertEqual[any](t, "schemaVersion", response["schemaVersion"], float64(1))
	assertEqual[any](t, "requestId", response["requestId"], "req-1")
	assertEqual[any](t, "language", response["language"], "go")
	files := response["files"].([]any)
	assertEqual(t, "file count", len(files), 2)
	first := files[0].(map[string]any)
	assertEqual[any](t, "first path", first["filePath"], "a.go")
	assertEqual(t, "first symbols", len(first["symbols"].([]any)), 1)
	second := files[1].(map[string]any)
	for _, key := range []string{"symbols", "undocumentedSymbols", "links", "diagnostics"} {
		if _, ok := second[key].([]any); !ok {
			t.Errorf("%s must serialize as an array, got %v", key, second[key])
		}
	}
	if strings.Contains(string(output), "null") {
		t.Errorf("optional fields must be omitted, not null: %s", output)
	}
}

func TestScanRequestJSONRejectsMalformedInput(t *testing.T) {
	if _, err := ScanRequestJSON([]byte("{")); err == nil {
		t.Error("expected an error for malformed JSON")
	}
}
