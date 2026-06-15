import 'dart:convert';

import 'package:speclink_dart_scanner/scanner.dart';
import 'package:test/test.dart';

Map<String, dynamic> scan(String source, {List<String>? visibility}) {
  final request = {
    'schemaVersion': 1,
    'requestId': 'test',
    'language': 'dart',
    'projectRoot': '/project',
    'files': [
      {'filePath': 'lib/auth.dart', 'content': source},
    ],
    'options': {if (visibility != null) 'visibility': visibility},
  };
  final response =
      jsonDecode(Scanner().scan(jsonEncode(request))) as Map<String, dynamic>;
  return (response['files'] as List).first as Map<String, dynamic>;
}

List<String> canonicalIds(Map<String, dynamic> file) =>
    (file['symbols'] as List)
        .map((s) => (s as Map<String, dynamic>)['canonicalId'] as String)
        .toList();

List<String> codes(List<dynamic> diagnostics) => diagnostics
    .map((d) => (d as Map<String, dynamic>)['code'] as String)
    .toList();

void main() {
  test('scans supported top-level declarations', () {
    final file = scan('''
/// @doc docs/auth.md#login
void login(String email) {}

/// @doc docs/auth.md#service
class AuthService {}

/// @doc docs/auth.md#role
enum Role { admin, user }
''');

    expect(canonicalIds(file), ['login', 'AuthService', 'Role']);
    expect(
      (file['links'] as List).map((l) => (l as Map)['target']).toList(),
      ['docs/auth.md#login', 'docs/auth.md#service', 'docs/auth.md#role'],
    );
  });

  test('canonicalizes class members, getters, setters, and constructors', () {
    final file = scan('''
class AuthService {
  /// @doc docs/auth.md#id
  final String id;

  /// @doc docs/auth.md#ctor
  AuthService(this.id);

  /// @doc docs/auth.md#named
  AuthService.guest() : id = 'guest';

  /// @doc docs/auth.md#login
  void login(String email) {}

  /// @doc docs/auth.md#token
  String get token => id;

  /// @doc docs/auth.md#set-token
  set token(String value) {}
}
''');

    expect(canonicalIds(file), [
      'AuthService.id',
      'AuthService.new',
      'AuthService.guest',
      'AuthService.login',
      'AuthService.token',
      'AuthService.token=',
    ]);
  });

  test('canonicalizes extension members as members of the extended type', () {
    final file = scan('''
extension on AuthService {
  /// @doc docs/auth.md#logout
  void logout() {}
}
''');

    expect(canonicalIds(file), ['AuthService.logout']);
  });

  test('reports duplicate canonical endpoints', () {
    final file = scan('''
extension on AuthService {
  /// @doc docs/auth.md#logout
  void logout() {}
}

extension on AuthService {
  /// @doc docs/auth.md#logout-again
  void logout() {}
}
''');

    expect(canonicalIds(file), ['AuthService.logout']);
    expect(codes(file['diagnostics'] as List), ['duplicate_code_symbol']);
  });

  test('reports unsupported annotated declarations', () {
    final file = scan('''
/// @doc docs/auth.md#callback
typedef Callback = void Function();
''');

    expect(file['symbols'], isEmpty);
    expect(codes(file['diagnostics'] as List), ['unsupported_declaration']);
    expect(
      ((file['diagnostics'] as List).first as Map)['language'],
      'dart',
    );
  });

  test('reports dart parse errors', () {
    final file = scan('class Broken {');

    expect(file['symbols'], isEmpty);
    expect(codes(file['diagnostics'] as List), ['code_parse_error']);
    expect(
      ((file['diagnostics'] as List).first as Map)['language'],
      'dart',
    );
  });

  test('honors dart public naming for documented and undocumented symbols', () {
    final file = scan('''
/// @doc docs/auth.md#secret
void _secret() {}

void publicUndocumented() {}
''');

    expect(file['symbols'], isEmpty);
    expect(
      (file['undocumentedSymbols'] as List)
          .map((s) => (s as Map)['canonicalId'])
          .toList(),
      ['publicUndocumented'],
    );
  });

  test('excludes members of a library-private type', () {
    final file = scan('''
class _Secret {
  /// @doc docs/a.md#login
  void login() {}

  /// @doc docs/a.md#ctor
  _Secret();
}
''');

    expect(file['symbols'], isEmpty);
    expect(file['undocumentedSymbols'], isEmpty);
    expect(file['links'], isEmpty);
    expect(file['diagnostics'], isEmpty);
  });

  test('excludes members added by an extension on a private type', () {
    final file = scan('''
extension on _Secret {
  /// @doc docs/a.md#logout
  void logout() {}
}
''');

    expect(file['symbols'], isEmpty);
    expect(file['links'], isEmpty);
  });

  test('uses utf16 one-based end-exclusive ranges', () {
    final file = scan('''
/// @doc docs/auth.md#smile
void smile([String value = '😀']) {}
''');

    final symbol = (file['symbols'] as List).first as Map<String, dynamic>;
    final location = symbol['location'] as Map<String, dynamic>;
    final nameRange = symbol['nameRange'] as Map<String, dynamic>;
    final declarationRange = symbol['declarationRange'] as Map<String, dynamic>;

    expect(location['line'], 2);
    expect(location['column'], 6);
    expect((nameRange['start'] as Map)['column'], 6);
    expect((nameRange['end'] as Map)['column'], 11);
    expect((declarationRange['start'] as Map)['line'], 1);
    expect((declarationRange['start'] as Map)['column'], 1);
    expect((declarationRange['end'] as Map)['line'], 2);
  });
}
