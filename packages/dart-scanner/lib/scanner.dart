import 'dart:convert';

import 'package:analyzer/dart/analysis/utilities.dart';
import 'package:analyzer/dart/ast/ast.dart';
import 'package:analyzer/dart/ast/token.dart';
import 'package:analyzer/source/line_info.dart';

import 'models.dart';

/// Scans Dart source files for SpecLink `@doc` annotations using the Dart
/// `analyzer` AST.
///
/// Dart has no method overloading, so member canonical IDs are type-qualified
/// names without parameter signatures (`AuthService.login`). Setters carry a
/// trailing `=` to stay distinct from a same-named getter or field, and the
/// unnamed constructor is `Type.new`.
class Scanner {
  String scan(String requestJson) {
    final request =
        WorkerRequest.fromJson(jsonDecode(requestJson) as Map<String, dynamic>);
    final files = request.files
        .map((file) => _scanFile(file, request.options.visibility))
        .toList();
    final response = WorkerResponse(
      schemaVersion: 1,
      requestId: request.requestId,
      language: 'dart',
      files: files,
    );
    return jsonEncode(response.toJson());
  }

  WorkerFileResponse _scanFile(WorkerFile file, List<String>? visibility) {
    final parsed = parseString(content: file.content, throwIfDiagnostics: false);
    if (parsed.errors.isNotEmpty) {
      return WorkerFileResponse(
        filePath: file.filePath,
        symbols: const [],
        undocumentedSymbols: const [],
        links: const [],
        diagnostics: [
          Diagnostic(
            code: 'code_parse_error',
            target: file.filePath,
            message: 'Dart analyzer reported syntax errors.',
            location: SourceLocation(filePath: file.filePath, line: 1, column: 1),
          ),
        ],
      );
    }

    final collector = _Collector(file.content, parsed.lineInfo);
    collector.visitUnit(parsed.unit);

    return _build(file.filePath, collector.declarations);
  }

  WorkerFileResponse _build(String filePath, List<_Declaration> declarations) {
    final symbols = <CodeSymbol>[];
    final undocumented = <CodeSymbol>[];
    final links = <DocLink>[];
    final diagnostics = <Diagnostic>[];
    final seenEndpoints = <String>{};
    final duplicateEndpoints = <String>{};

    for (final declaration in declarations) {
      if (declaration.unsupported) {
        diagnostics.add(
          Diagnostic(
            code: 'unsupported_declaration',
            target: filePath,
            message: 'Dart declaration annotated with @doc is not supported.',
            location: SourceLocation(
              filePath: filePath,
              line: declaration.line,
              column: declaration.column,
            ),
            range: declaration.nameRange,
          ),
        );
        continue;
      }

      if (!declaration.visible) continue;

      final symbol = declaration.toSymbol(filePath);
      if (declaration.docTargets.isEmpty) {
        if (!undocumented.any((s) => s.endpoint == symbol.endpoint)) {
          undocumented.add(symbol);
        }
        continue;
      }

      if (seenEndpoints.contains(symbol.endpoint)) {
        if (!duplicateEndpoints.contains(symbol.endpoint)) {
          diagnostics.add(
            Diagnostic(
              code: 'duplicate_code_symbol',
              target: symbol.endpoint,
              message: 'Duplicate Dart code symbol endpoint: ${symbol.endpoint}',
              location: SourceLocation(
                filePath: filePath,
                line: declaration.line,
                column: declaration.column,
              ),
              range: declaration.nameRange,
            ),
          );
          duplicateEndpoints.add(symbol.endpoint);
        }
        continue;
      }
      seenEndpoints.add(symbol.endpoint);
      symbols.add(symbol);

      final seenTargets = <String>{};
      for (final docTarget in declaration.docTargets) {
        if (seenTargets.contains(docTarget.target)) continue;
        seenTargets.add(docTarget.target);
        links.add(
          DocLink(
            source: symbol.endpoint,
            target: docTarget.target,
            location: SourceLocation(
              filePath: filePath,
              line: docTarget.line,
              column: docTarget.column,
            ),
            targetRange: docTarget.range,
          ),
        );
      }
    }

    return WorkerFileResponse(
      filePath: filePath,
      symbols: symbols,
      undocumentedSymbols: undocumented,
      links: links,
      diagnostics: diagnostics,
    );
  }
}

class _Declaration {
  _Declaration({
    required this.symbolName,
    required this.canonicalId,
    required this.line,
    required this.column,
    required this.visible,
    required this.unsupported,
    required this.docTargets,
    this.nameRange,
    this.declarationRange,
    this.signatureRange,
  });

  final String symbolName;
  final String canonicalId;
  final int line;
  final int column;
  final bool visible;
  final bool unsupported;
  final List<_DocTarget> docTargets;
  final SourceRange? nameRange;
  final SourceRange? declarationRange;
  final SourceRange? signatureRange;

  CodeSymbol toSymbol(String filePath) => CodeSymbol(
        filePath: filePath,
        symbolName: symbolName,
        canonicalId: canonicalId,
        endpoint: '$filePath#$canonicalId',
        location: SourceLocation(filePath: filePath, line: line, column: column),
        nameRange: nameRange,
        declarationRange: declarationRange,
        signatureRange: signatureRange,
      );
}

class _DocTarget {
  _DocTarget({
    required this.target,
    required this.line,
    required this.column,
    required this.range,
  });

  final String target;
  final int line;
  final int column;
  final SourceRange range;
}

class _Collector {
  _Collector(this.content, this.lineInfo);

  final String content;
  final LineInfo lineInfo;
  final List<_Declaration> declarations = [];

  void visitUnit(CompilationUnit unit) {
    for (final declaration in unit.declarations) {
      _handleTopLevel(declaration);
    }
  }

  void _handleTopLevel(CompilationUnitMember declaration) {
    if (declaration is FunctionDeclaration) {
      final name = declaration.name.lexeme;
      _record(
        nameToken: declaration.name,
        node: declaration,
        symbolName: name,
        canonicalId: declaration.isSetter ? '$name=' : name,
        signatureEnd: declaration.functionExpression.body.offset,
      );
      return;
    }

    if (declaration is TopLevelVariableDeclaration) {
      for (final variable in declaration.variables.variables) {
        _record(
          nameToken: variable.name,
          node: declaration,
          symbolName: variable.name.lexeme,
          canonicalId: variable.name.lexeme,
          signatureEnd: declaration.end,
        );
      }
      return;
    }

    if (declaration is ClassDeclaration) {
      _recordType(declaration.name, declaration, declaration.leftBracket);
      _handleMembers(declaration.members, declaration.name.lexeme);
      return;
    }

    if (declaration is EnumDeclaration) {
      _recordType(declaration.name, declaration, declaration.leftBracket);
      _handleMembers(declaration.members, declaration.name.lexeme);
      return;
    }

    if (declaration is MixinDeclaration) {
      _recordType(declaration.name, declaration, declaration.leftBracket);
      _handleMembers(declaration.members, declaration.name.lexeme);
      return;
    }

    if (declaration is ExtensionDeclaration) {
      // Extensions produce no symbol; their members canonicalize against the
      // extended type. A `@doc` on the extension itself is ignored.
      final qualifier = _extendedTypeName(declaration);
      if (qualifier.isNotEmpty) {
        _handleMembers(declaration.members, qualifier);
      }
      return;
    }

    _markUnsupportedIfAnnotated(declaration);
  }

  void _handleMembers(List<ClassMember> members, String qualifier) {
    for (final member in members) {
      if (member is MethodDeclaration) {
        if (member.isOperator) continue;
        final name = member.name.lexeme;
        _record(
          nameToken: member.name,
          node: member,
          symbolName: name,
          canonicalId: member.isSetter ? '$qualifier.$name=' : '$qualifier.$name',
          signatureEnd: member.body.offset,
        );
      } else if (member is FieldDeclaration) {
        for (final variable in member.fields.variables) {
          _record(
            nameToken: variable.name,
            node: member,
            symbolName: variable.name.lexeme,
            canonicalId: '$qualifier.${variable.name.lexeme}',
            signatureEnd: member.end,
          );
        }
      } else if (member is ConstructorDeclaration) {
        final ctorName = member.name?.lexeme;
        final nameToken = member.name ?? member.returnType.beginToken;
        _record(
          nameToken: nameToken,
          node: member,
          symbolName: ctorName ?? 'new',
          canonicalId:
              ctorName != null ? '$qualifier.$ctorName' : '$qualifier.new',
          signatureEnd: member.body.offset,
        );
      }
    }
  }

  void _recordType(Token nameToken, AnnotatedNode node, Token leftBracket) {
    _record(
      nameToken: nameToken,
      node: node,
      symbolName: nameToken.lexeme,
      canonicalId: nameToken.lexeme,
      signatureEnd: leftBracket.offset,
    );
  }

  void _record({
    required Token nameToken,
    required AnnotatedNode node,
    required String symbolName,
    required String canonicalId,
    required int signatureEnd,
  }) {
    final visible = !symbolName.startsWith('_');
    final declStart = _declarationStart(node);
    final location = lineInfo.getLocation(nameToken.offset);
    declarations.add(
      _Declaration(
        symbolName: symbolName,
        canonicalId: canonicalId,
        line: location.lineNumber,
        column: location.columnNumber,
        visible: visible,
        unsupported: false,
        nameRange: _range(nameToken.offset, nameToken.end),
        declarationRange: _range(declStart, node.end),
        signatureRange: _range(declStart, signatureEnd),
        docTargets: _docTargets(node),
      ),
    );
  }

  void _markUnsupportedIfAnnotated(AnnotatedNode node) {
    final targets = _docTargets(node);
    if (targets.isEmpty) return;
    final start = node.firstTokenAfterCommentAndMetadata.offset;
    final location = lineInfo.getLocation(start);
    declarations.add(
      _Declaration(
        symbolName: '',
        canonicalId: '',
        line: location.lineNumber,
        column: location.columnNumber,
        visible: true,
        unsupported: true,
        docTargets: targets,
      ),
    );
  }

  String _extendedTypeName(ExtensionDeclaration extension) {
    final onType = extension.onClause?.extendedType;
    if (onType == null) return '';
    return onType.toSource().split('<').first.trim();
  }

  int _declarationStart(AnnotatedNode node) {
    final comment = node.documentationComment;
    if (comment != null) return comment.offset;
    return node.firstTokenAfterCommentAndMetadata.offset;
  }

  List<_DocTarget> _docTargets(AnnotatedNode node) {
    final comment = node.documentationComment;
    if (comment == null) return const [];
    final text = content.substring(comment.offset, comment.end);
    final targets = <_DocTarget>[];
    for (final match in RegExp(r'@doc\s+(\S+)').allMatches(text)) {
      final target = match.group(1)!;
      final targetStartInText = match.start + (match.group(0)!.length - target.length);
      final location = lineInfo.getLocation(comment.offset + targetStartInText);
      targets.add(
        _DocTarget(
          target: target,
          line: location.lineNumber,
          column: location.columnNumber,
          range: SourceRange(
            start: Position(line: location.lineNumber, column: location.columnNumber),
            end: Position(
              line: location.lineNumber,
              column: location.columnNumber + target.length,
            ),
          ),
        ),
      );
    }
    return targets;
  }

  Position _position(int offset) {
    final location = lineInfo.getLocation(offset);
    return Position(line: location.lineNumber, column: location.columnNumber);
  }

  SourceRange _range(int start, int end) =>
      SourceRange(start: _position(start), end: _position(end));
}
