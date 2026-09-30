package scanner

import (
	"go/ast"
	"go/token"
)

// declaration is one package-level declaration, spec, or method found in a
// file, in source order. An unsupported declaration is recorded only when its
// doc comment carries `@doc`, so it can be reported; supported declarations are
// recorded whether or not they are documented, so audit mode can list them.
type declaration struct {
	symbolName  string
	canonicalID string
	exported    bool
	unsupported bool
	nameStart   int
	nameEnd     int
	declStart   int
	declEnd     int
	sigStart    int
	sigEnd      int
	docTargets  []docTarget
}

type collector struct {
	file         *ast.File
	tokenFile    *token.File
	converter    *positionConverter
	declarations []declaration
}

func collectDeclarations(file *ast.File, tokenFile *token.File, converter *positionConverter) []declaration {
	c := &collector{file: file, tokenFile: tokenFile, converter: converter}
	c.unsupportedIfAnnotated(file.Doc, file.Name.Pos(), file.Name.End())
	for _, decl := range file.Decls {
		switch decl := decl.(type) {
		case *ast.FuncDecl:
			c.funcDecl(decl)
		case *ast.GenDecl:
			c.genDecl(decl)
		}
	}
	return c.declarations
}

func (c *collector) offset(pos token.Pos) int {
	return c.tokenFile.Offset(pos)
}

func (c *collector) targets(doc *ast.CommentGroup) []docTarget {
	return extractDocTargets(doc, c.tokenFile, c.converter)
}

// unsupportedIfAnnotated records an unsupported declaration when its doc
// comment carries `@doc`, located at the given name or start range.
func (c *collector) unsupportedIfAnnotated(doc *ast.CommentGroup, start, end token.Pos) {
	targets := c.targets(doc)
	if len(targets) == 0 {
		return
	}
	c.declarations = append(c.declarations, declaration{
		unsupported: true,
		nameStart:   c.offset(start),
		nameEnd:     c.offset(end),
		docTargets:  targets,
	})
}

func (c *collector) funcDecl(decl *ast.FuncDecl) {
	name := decl.Name
	docStart := decl.Pos()
	if decl.Doc != nil {
		docStart = decl.Doc.Pos()
	}
	if decl.Recv == nil {
		if name.Name == "_" || name.Name == "init" {
			c.unsupportedIfAnnotated(decl.Doc, name.Pos(), name.End())
			return
		}
		c.add(name.Name, name.Name, ast.IsExported(name.Name), name, docStart, decl.End(), decl.Type.End(), decl.Doc)
		return
	}

	receiver, ok := receiverTypeName(decl.Recv)
	if !ok || name.Name == "_" {
		c.unsupportedIfAnnotated(decl.Doc, name.Pos(), name.End())
		return
	}
	exported := ast.IsExported(receiver) && ast.IsExported(name.Name)
	c.add(name.Name, receiver+"."+name.Name, exported, name, docStart, decl.End(), decl.Type.End(), decl.Doc)
}

// receiverTypeName returns the base identifier of a method receiver after
// unwrapping pointers, parentheses, and type-parameter lists. It rejects
// receiver lists that do not name exactly one parameter and bases that are not
// plain identifiers, both of which go/parser accepts syntactically.
func receiverTypeName(recv *ast.FieldList) (string, bool) {
	if recv.NumFields() != 1 {
		return "", false
	}
	expr := recv.List[0].Type
	for {
		switch typed := expr.(type) {
		case *ast.ParenExpr:
			expr = typed.X
		case *ast.StarExpr:
			expr = typed.X
		case *ast.IndexExpr:
			expr = typed.X
		case *ast.IndexListExpr:
			expr = typed.X
		case *ast.Ident:
			return typed.Name, true
		default:
			return "", false
		}
	}
}

func (c *collector) genDecl(decl *ast.GenDecl) {
	grouped := decl.Lparen.IsValid()
	if grouped {
		// A group comment documents the group, which has no name.
		c.unsupportedIfAnnotated(decl.Doc, decl.Pos(), decl.Pos()+token.Pos(len(decl.Tok.String())))
	}
	for _, spec := range decl.Specs {
		var doc *ast.CommentGroup
		var start token.Pos
		if grouped {
			doc = specDoc(spec)
			start = spec.Pos()
			if doc != nil {
				start = doc.Pos()
			}
		} else {
			doc = decl.Doc
			start = decl.Pos()
			if doc != nil {
				start = doc.Pos()
			}
		}
		end := spec.End()
		if !grouped {
			end = decl.End()
		}
		switch spec := spec.(type) {
		case *ast.ImportSpec:
			c.unsupportedIfAnnotated(doc, spec.Path.Pos(), spec.Path.End())
		case *ast.ValueSpec:
			c.valueSpec(spec, doc, start, end)
		case *ast.TypeSpec:
			c.typeSpec(spec, doc, start, end)
		}
	}
}

func specDoc(spec ast.Spec) *ast.CommentGroup {
	switch spec := spec.(type) {
	case *ast.ImportSpec:
		return spec.Doc
	case *ast.ValueSpec:
		return spec.Doc
	case *ast.TypeSpec:
		return spec.Doc
	}
	return nil
}

func (c *collector) valueSpec(spec *ast.ValueSpec, doc *ast.CommentGroup, start, end token.Pos) {
	if len(spec.Names) > 1 {
		// The annotation cannot say which name it documents.
		c.unsupportedIfAnnotated(doc, spec.Names[0].Pos(), spec.Names[0].End())
		for _, name := range spec.Names {
			if name.Name != "_" {
				c.add(name.Name, name.Name, ast.IsExported(name.Name), name, start, end, end, nil)
			}
		}
		return
	}
	name := spec.Names[0]
	if name.Name == "_" {
		c.unsupportedIfAnnotated(doc, name.Pos(), name.End())
		return
	}
	c.add(name.Name, name.Name, ast.IsExported(name.Name), name, start, end, end, doc)
}

func (c *collector) typeSpec(spec *ast.TypeSpec, doc *ast.CommentGroup, start, end token.Pos) {
	name := spec.Name
	if name.Name == "_" {
		c.unsupportedIfAnnotated(doc, name.Pos(), name.End())
		return
	}
	c.add(name.Name, name.Name, ast.IsExported(name.Name), name, start, end, end, doc)

	switch underlying := unparen(spec.Type).(type) {
	case *ast.StructType:
		c.structFields(underlying)
	case *ast.InterfaceType:
		c.interfaceElements(name.Name, underlying)
	}
}

func unparen(expr ast.Expr) ast.Expr {
	for {
		paren, ok := expr.(*ast.ParenExpr)
		if !ok {
			return expr
		}
		expr = paren.X
	}
}

func (c *collector) structFields(structType *ast.StructType) {
	if structType.Fields == nil {
		return
	}
	for _, field := range structType.Fields.List {
		start, end := fieldNameSpan(field)
		c.unsupportedIfAnnotated(field.Doc, start, end)
	}
}

func (c *collector) interfaceElements(typeName string, interfaceType *ast.InterfaceType) {
	if interfaceType.Methods == nil {
		return
	}
	previousEnd := interfaceType.Methods.Opening
	for _, field := range interfaceType.Methods.List {
		doc := field.Doc
		if doc == nil && len(field.Names) == 0 {
			// go/parser attaches a doc only to elements that start with an
			// identifier; recover the lead comment of `~T` and similar forms.
			doc = c.leadComment(previousEnd, field.Pos())
		}
		previousEnd = field.End()
		if len(field.Names) != 1 {
			c.unsupportedIfAnnotated(doc, field.Pos(), field.End())
			continue
		}
		name := field.Names[0]
		if name.Name == "_" {
			c.unsupportedIfAnnotated(doc, name.Pos(), name.End())
			continue
		}
		start := field.Pos()
		if doc != nil {
			start = doc.Pos()
		}
		exported := ast.IsExported(typeName) && ast.IsExported(name.Name)
		c.add(name.Name, typeName+"."+name.Name, exported, name, start, field.End(), field.End(), doc)
	}
}

// leadComment finds the comment group that immediately precedes pos, ending on
// the line before it and starting after prev, the way go/parser assigns doc
// comments.
func (c *collector) leadComment(prev, pos token.Pos) *ast.CommentGroup {
	var lead *ast.CommentGroup
	for _, group := range c.file.Comments {
		if group.Pos() <= prev || group.End() >= pos {
			continue
		}
		if c.tokenFile.Line(group.End())+1 == c.tokenFile.Line(pos) {
			lead = group
		}
	}
	return lead
}

// fieldNameSpan is the field's first name, or its type for an embedded field.
func fieldNameSpan(field *ast.Field) (token.Pos, token.Pos) {
	if len(field.Names) > 0 {
		return field.Names[0].Pos(), field.Names[0].End()
	}
	return field.Type.Pos(), field.Type.End()
}

func (c *collector) add(symbolName, canonicalID string, exported bool, name *ast.Ident, start, end, sigEnd token.Pos, doc *ast.CommentGroup) {
	c.declarations = append(c.declarations, declaration{
		symbolName:  symbolName,
		canonicalID: canonicalID,
		exported:    exported,
		nameStart:   c.offset(name.Pos()),
		nameEnd:     c.offset(name.End()),
		declStart:   c.offset(start),
		declEnd:     c.offset(end),
		sigStart:    c.offset(start),
		sigEnd:      c.offset(sigEnd),
		docTargets:  c.targets(doc),
	})
}
