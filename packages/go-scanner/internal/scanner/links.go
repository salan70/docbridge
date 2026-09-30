package scanner

import (
	"go/ast"
	"go/token"
	"strings"
)

// docTarget is one `@doc` annotation found in a doc comment, with the byte
// offsets of its target in the original content.
type docTarget struct {
	target string
	start  int
	end    int
}

// extractDocTargets finds every `@doc <target>` in a doc comment group.
//
// The comment body is taken from the original content rather than from
// ast.Comment.Text: go/scanner strips carriage returns from comment literals,
// which would shift offsets in CRLF files. The delimiters are excluded so a
// target directly followed by `*/` does not absorb it.
func extractDocTargets(group *ast.CommentGroup, file *token.File, converter *positionConverter) []docTarget {
	if group == nil {
		return nil
	}
	var targets []docTarget
	for _, comment := range group.List {
		bodyStart, bodyEnd := commentBody(converter.content, file.Offset(comment.Slash))
		body := converter.slice(bodyStart, bodyEnd)
		for _, match := range findDocTargets(body) {
			targets = append(targets, docTarget{
				target: match.target,
				start:  bodyStart + match.offset,
				end:    bodyStart + match.offset + len(match.target),
			})
		}
	}
	return targets
}

// commentBody returns the byte offsets of a comment's text without its
// delimiters, given the offset of its leading slash in content.
func commentBody(content string, slash int) (int, int) {
	start := slash + 2
	if start > len(content) {
		return len(content), len(content)
	}
	if strings.HasPrefix(content[slash:], "/*") {
		if end := strings.Index(content[start:], "*/"); end >= 0 {
			return start, start + end
		}
		return start, len(content)
	}
	end := strings.IndexByte(content[start:], '\n')
	if end < 0 {
		return start, len(content)
	}
	return start, start + end
}

type docMatch struct {
	target string
	offset int
}

// findDocTargets matches `@doc\s+(\S+)` over a comment body, returning byte
// offsets relative to the body.
func findDocTargets(body string) []docMatch {
	var matches []docMatch
	index := 0
	for index+4 <= len(body) {
		if !strings.HasPrefix(body[index:], "@doc") {
			index++
			continue
		}
		after := index + 4
		cursor := after
		for cursor < len(body) && isASCIISpace(body[cursor]) {
			cursor++
		}
		if cursor == after || cursor >= len(body) {
			index = after
			continue
		}
		start := cursor
		for cursor < len(body) && !isASCIISpace(body[cursor]) {
			cursor++
		}
		matches = append(matches, docMatch{target: body[start:cursor], offset: start})
		index = cursor
	}
	return matches
}

func isASCIISpace(b byte) bool {
	return b == ' ' || b == '\t' || b == '\n' || b == '\r' || b == '\f' || b == '\v'
}

// isValidLinkTarget mirrors the other workers' target validation: a
// project-root-relative `file#fragment` that is not the source file itself.
func isValidLinkTarget(target, sourceFilePath string) bool {
	filePath, fragment, found := strings.Cut(target, "#")
	if !found || filePath == "" || fragment == "" {
		return false
	}
	if strings.HasPrefix(filePath, "/") || strings.HasPrefix(filePath, "./") || strings.HasPrefix(filePath, "../") {
		return false
	}
	if strings.Contains(filePath, "\\") || strings.ContainsAny(filePath, " \t\r\n") || strings.ContainsAny(fragment, " \t\r\n") {
		return false
	}
	for _, segment := range strings.Split(filePath, "/") {
		if segment == ".." {
			return false
		}
	}
	return filePath != sourceFilePath
}
