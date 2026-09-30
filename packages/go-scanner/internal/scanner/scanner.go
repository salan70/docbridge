package scanner

import (
	"encoding/json"
	"go/parser"
	"go/scanner"
	"go/token"
	"strings"
)

const language = "go"

// ScanRequestJSON scans one worker request payload and returns the response
// payload.
func ScanRequestJSON(requestJSON []byte) ([]byte, error) {
	var request Request
	if err := json.Unmarshal(requestJSON, &request); err != nil {
		return nil, err
	}
	return json.Marshal(ScanRequest(&request))
}

// ScanRequest scans every requested file in request order.
func ScanRequest(request *Request) Response {
	files := make([]FileResponse, 0, len(request.Files))
	for _, file := range request.Files {
		files = append(files, ScanFile(file.FilePath, file.Content, request.Options.Visibility))
	}
	return Response{
		SchemaVersion: 1,
		RequestID:     request.RequestID,
		Language:      language,
		Files:         files,
	}
}

// ScanFile scans one file. A nil visibility means the default, exported-only
// set; an empty slice includes nothing.
func ScanFile(filePath, content string, visibility []string) FileResponse {
	converter := newPositionConverter(content)
	fileSet := token.NewFileSet()
	parsed, err := parser.ParseFile(fileSet, filePath, content, parser.ParseComments|parser.SkipObjectResolution)
	if err != nil {
		return parseErrorResponse(filePath, err, converter)
	}

	visible := map[string]bool{}
	if visibility == nil {
		visible["exported"] = true
	}
	for _, value := range visibility {
		visible[value] = true
	}

	declarations := collectDeclarations(parsed, fileSet.File(parsed.Pos()), converter)
	return buildResponse(filePath, declarations, visible, converter)
}

// parseErrorResponse reports the error with the smallest byte offset. The
// scanner.ErrorList is sorted by `//line`-adjusted positions with byte
// columns, so neither its order nor its Position fields are used directly.
func parseErrorResponse(filePath string, err error, converter *positionConverter) FileResponse {
	message := err.Error()
	offset := 0
	if list, ok := err.(scanner.ErrorList); ok && len(list) > 0 {
		first := list[0]
		for _, entry := range list[1:] {
			if entry.Pos.Offset < first.Pos.Offset {
				first = entry
			}
		}
		message = first.Msg
		offset = first.Pos.Offset
	}
	return FileResponse{
		FilePath:            filePath,
		Symbols:             []CodeSymbol{},
		UndocumentedSymbols: []CodeSymbol{},
		Links:               []DocLink{},
		Diagnostics: []Diagnostic{{
			Severity: "error",
			Code:     "code_parse_error",
			Target:   filePath,
			Language: language,
			Message:  "Go parse error: " + sentence(message),
			Location: converter.location(filePath, offset),
		}},
	}
}

// sentence ends a parser message with a period, as the other scanners do.
func sentence(message string) string {
	if strings.HasSuffix(message, ".") {
		return message
	}
	return message + "."
}

func buildResponse(filePath string, declarations []declaration, visible map[string]bool, converter *positionConverter) FileResponse {
	response := FileResponse{
		FilePath:            filePath,
		Symbols:             []CodeSymbol{},
		UndocumentedSymbols: []CodeSymbol{},
		Links:               []DocLink{},
		Diagnostics:         []Diagnostic{},
	}
	seenEndpoints := map[string]bool{}
	duplicateEndpoints := map[string]bool{}
	undocumentedEndpoints := map[string]bool{}

	for _, decl := range declarations {
		if decl.unsupported {
			response.Diagnostics = append(response.Diagnostics, Diagnostic{
				Severity: "warning",
				Code:     "unsupported_declaration",
				Target:   filePath,
				Language: language,
				Message:  "Go declaration annotated with @doc is not supported.",
				Location: converter.location(filePath, decl.nameStart),
				Range:    converter.rangeOf(decl.nameStart, decl.nameEnd),
			})
			continue
		}

		class := "unexported"
		if decl.exported {
			class = "exported"
		}
		if !visible[class] {
			continue
		}

		symbol := makeSymbol(filePath, decl, converter)
		if len(decl.docTargets) == 0 {
			if !undocumentedEndpoints[symbol.Endpoint] {
				undocumentedEndpoints[symbol.Endpoint] = true
				response.UndocumentedSymbols = append(response.UndocumentedSymbols, symbol)
			}
			continue
		}

		if seenEndpoints[symbol.Endpoint] {
			if !duplicateEndpoints[symbol.Endpoint] {
				duplicateEndpoints[symbol.Endpoint] = true
				response.Diagnostics = append(response.Diagnostics, Diagnostic{
					Severity: "error",
					Code:     "duplicate_code_symbol",
					Target:   symbol.Endpoint,
					Language: language,
					Message:  "Duplicate Go code symbol endpoint: " + symbol.Endpoint,
					Location: converter.location(filePath, decl.nameStart),
					Range:    symbol.NameRange,
				})
			}
			continue
		}
		seenEndpoints[symbol.Endpoint] = true
		response.Symbols = append(response.Symbols, symbol)

		seenTargets := map[string]bool{}
		for _, target := range decl.docTargets {
			location := converter.location(filePath, target.start)
			targetRange := converter.rangeOf(target.start, target.end)
			if !isValidLinkTarget(target.target, filePath) {
				source := symbol.Endpoint
				response.Diagnostics = append(response.Diagnostics, Diagnostic{
					Severity: "error",
					Code:     "invalid_link_target",
					Target:   target.target,
					Language: language,
					Source:   &source,
					Message:  "Link target must be a project-root-relative file path and fragment in file#fragment form.",
					Location: location,
					Range:    targetRange,
				})
				continue
			}
			if seenTargets[target.target] {
				source := symbol.Endpoint
				response.Diagnostics = append(response.Diagnostics, Diagnostic{
					Severity: "warning",
					Code:     "duplicate_link",
					Target:   target.target,
					Language: language,
					Source:   &source,
					Message:  "Duplicate @doc link from " + symbol.Endpoint + " to " + target.target + ".",
					Location: location,
					Range:    targetRange,
				})
				continue
			}
			seenTargets[target.target] = true
			response.Links = append(response.Links, DocLink{
				Source:      symbol.Endpoint,
				Target:      target.target,
				Location:    *location,
				TargetRange: targetRange,
			})
		}
	}
	return response
}

func makeSymbol(filePath string, decl declaration, converter *positionConverter) CodeSymbol {
	return CodeSymbol{
		Kind:             "code",
		Language:         language,
		FilePath:         filePath,
		SymbolName:       decl.symbolName,
		CanonicalID:      decl.canonicalID,
		Endpoint:         filePath + "#" + decl.canonicalID,
		Location:         converter.location(filePath, decl.nameStart),
		NameRange:        converter.rangeOf(decl.nameStart, decl.nameEnd),
		DeclarationRange: converter.rangeOf(decl.declStart, decl.declEnd),
		SignatureRange:   converter.rangeOf(decl.sigStart, decl.sigEnd),
	}
}
