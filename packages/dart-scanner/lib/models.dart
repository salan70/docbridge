/// Worker protocol data models for the SpecLink Dart scanner.
///
/// JSON shapes mirror the Swift scanner so the TypeScript core can validate and
/// consume both identically. Optional fields are omitted (not emitted as
/// `null`) to match the Swift `JSONEncoder` output the core already accepts.
library;

class WorkerRequest {
  WorkerRequest({
    required this.schemaVersion,
    required this.requestId,
    required this.language,
    required this.projectRoot,
    required this.files,
    required this.options,
  });

  final int schemaVersion;
  final String requestId;
  final String language;
  final String projectRoot;
  final List<WorkerFile> files;
  final WorkerOptions options;

  factory WorkerRequest.fromJson(Map<String, dynamic> json) {
    return WorkerRequest(
      schemaVersion: json['schemaVersion'] as int,
      requestId: json['requestId'] as String,
      language: json['language'] as String,
      projectRoot: json['projectRoot'] as String,
      files: (json['files'] as List<dynamic>)
          .map((e) => WorkerFile.fromJson(e as Map<String, dynamic>))
          .toList(),
      options: WorkerOptions.fromJson(
        (json['options'] as Map<String, dynamic>?) ?? const {},
      ),
    );
  }
}

class WorkerFile {
  WorkerFile({required this.filePath, required this.content});

  final String filePath;
  final String content;

  factory WorkerFile.fromJson(Map<String, dynamic> json) {
    return WorkerFile(
      filePath: json['filePath'] as String,
      content: json['content'] as String,
    );
  }
}

class WorkerOptions {
  WorkerOptions({this.visibility});

  final List<String>? visibility;

  factory WorkerOptions.fromJson(Map<String, dynamic> json) {
    final raw = json['visibility'] as List<dynamic>?;
    return WorkerOptions(
      visibility: raw?.map((e) => e as String).toList(),
    );
  }
}

class WorkerResponse {
  WorkerResponse({
    required this.schemaVersion,
    required this.requestId,
    required this.language,
    required this.files,
  });

  final int schemaVersion;
  final String requestId;
  final String language;
  final List<WorkerFileResponse> files;

  Map<String, dynamic> toJson() => {
        'schemaVersion': schemaVersion,
        'requestId': requestId,
        'language': language,
        'files': files.map((e) => e.toJson()).toList(),
      };
}

class WorkerFileResponse {
  WorkerFileResponse({
    required this.filePath,
    required this.symbols,
    required this.undocumentedSymbols,
    required this.links,
    required this.diagnostics,
  });

  final String filePath;
  final List<CodeSymbol> symbols;
  final List<CodeSymbol> undocumentedSymbols;
  final List<DocLink> links;
  final List<Diagnostic> diagnostics;

  Map<String, dynamic> toJson() => {
        'filePath': filePath,
        'symbols': symbols.map((e) => e.toJson()).toList(),
        'undocumentedSymbols':
            undocumentedSymbols.map((e) => e.toJson()).toList(),
        'links': links.map((e) => e.toJson()).toList(),
        'diagnostics': diagnostics.map((e) => e.toJson()).toList(),
      };
}

class CodeSymbol {
  CodeSymbol({
    required this.filePath,
    required this.symbolName,
    required this.canonicalId,
    required this.endpoint,
    required this.location,
    this.nameRange,
    this.declarationRange,
    this.signatureRange,
  });

  final String filePath;
  final String symbolName;
  final String canonicalId;
  final String endpoint;
  final SourceLocation location;
  final SourceRange? nameRange;
  final SourceRange? declarationRange;
  final SourceRange? signatureRange;

  Map<String, dynamic> toJson() => _pruneNulls({
        'kind': 'code',
        'language': 'dart',
        'filePath': filePath,
        'symbolName': symbolName,
        'canonicalId': canonicalId,
        'endpoint': endpoint,
        'location': location.toJson(),
        'nameRange': nameRange?.toJson(),
        'declarationRange': declarationRange?.toJson(),
        'signatureRange': signatureRange?.toJson(),
      });
}

class DocLink {
  DocLink({
    required this.source,
    required this.target,
    required this.location,
    this.targetRange,
  });

  final String source;
  final String target;
  final SourceLocation location;
  final SourceRange? targetRange;

  Map<String, dynamic> toJson() => _pruneNulls({
        'direction': 'code-to-doc',
        'source': source,
        'target': target,
        'location': location.toJson(),
        'targetRange': targetRange?.toJson(),
      });
}

class Diagnostic {
  Diagnostic({
    required this.code,
    required this.target,
    required this.message,
    this.location,
    this.range,
  });

  final String code;
  final String target;
  final String message;
  final SourceLocation? location;
  final SourceRange? range;

  Map<String, dynamic> toJson() => _pruneNulls({
        'severity': 'error',
        'code': code,
        'target': target,
        'language': 'dart',
        'message': message,
        'location': location?.toJson(),
        'range': range?.toJson(),
      });
}

class SourceLocation {
  SourceLocation(
      {required this.filePath, required this.line, required this.column});

  final String filePath;
  final int line;
  final int column;

  Map<String, dynamic> toJson() => {
        'filePath': filePath,
        'line': line,
        'column': column,
      };
}

class SourceRange {
  SourceRange({required this.start, required this.end});

  final Position start;
  final Position end;

  Map<String, dynamic> toJson() => {
        'start': start.toJson(),
        'end': end.toJson(),
      };
}

class Position {
  Position({required this.line, required this.column});

  final int line;
  final int column;

  Map<String, dynamic> toJson() => {'line': line, 'column': column};
}

Map<String, dynamic> _pruneNulls(Map<String, dynamic> map) {
  map.removeWhere((_, value) => value == null);
  return map;
}
