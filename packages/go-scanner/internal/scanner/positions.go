package scanner

import (
	"sort"
	"unicode/utf16"
)

// positionConverter turns byte offsets into 1-based lines and UTF-16 columns.
// Lines are split on '\n' only, so a CRLF file keeps its '\r' inside the line
// and columns stay byte-derived from the original content, never from
// go/token positions, which honor `//line` directives.
type positionConverter struct {
	content    string
	lineStarts []int
}

func newPositionConverter(content string) *positionConverter {
	lineStarts := []int{0}
	for index := 0; index < len(content); index++ {
		if content[index] == '\n' {
			lineStarts = append(lineStarts, index+1)
		}
	}
	return &positionConverter{content: content, lineStarts: lineStarts}
}

func (c *positionConverter) position(offset int) Position {
	if offset < 0 {
		offset = 0
	}
	if offset > len(c.content) {
		offset = len(c.content)
	}
	lineIndex := sort.Search(len(c.lineStarts), func(index int) bool {
		return c.lineStarts[index] > offset
	}) - 1
	lineStart := c.lineStarts[lineIndex]
	column := 1
	for _, r := range c.content[lineStart:offset] {
		column += utf16.RuneLen(r)
	}
	return Position{Line: lineIndex + 1, Column: column}
}

func (c *positionConverter) location(filePath string, offset int) *SourceLocation {
	position := c.position(offset)
	return &SourceLocation{FilePath: filePath, Line: position.Line, Column: position.Column}
}

func (c *positionConverter) rangeOf(start, end int) *SourceRange {
	return &SourceRange{Start: c.position(start), End: c.position(end)}
}

// slice returns the content between two byte offsets, clamped to the content.
func (c *positionConverter) slice(start, end int) string {
	if start < 0 {
		start = 0
	}
	if end > len(c.content) {
		end = len(c.content)
	}
	if start >= end {
		return ""
	}
	return c.content[start:end]
}
