package dev.docbridge.javascanner;

import java.util.ArrayList;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;

/**
 * Scans one file into the worker protocol's {@code responseFile} object:
 * symbols, undocumented symbols, links, and diagnostics in the same shape as
 * the Go worker, so the core consumes both identically. The rules match Go's
 * except that an endpoint a kept declaration documents is never also listed as
 * undocumented.
 */
public final class Scanner {
  public static final String LANGUAGE = "java";

  private final String filePath;
  private final Positions positions;
  private final List<Object> symbols = new ArrayList<>();
  private final List<Object> undocumentedSymbols = new ArrayList<>();
  private final List<Object> links = new ArrayList<>();
  private final List<Object> diagnostics = new ArrayList<>();

  private Scanner(String filePath, String content) {
    this.filePath = filePath;
    this.positions = new Positions(content);
  }

  /**
   * Scans one file. A {@code null} visibility list means the default,
   * public-only set; an empty list includes nothing.
   */
  public static Map<String, Object> scanFile(String filePath, String content, List<String> visibility) {
    Scanner scanner = new Scanner(filePath, content);
    Parsing.Parsed parsed = Parsing.parse(filePath, content);
    if (!parsed.errors().isEmpty()) {
      scanner.parseError(parsed.errors());
      return scanner.response();
    }
    Set<String> visible = new HashSet<>(visibility == null ? List.of("public") : visibility);
    DocComments comments = new DocComments(content);
    scanner.build(Declarations.collect(parsed, comments), visible);
    return scanner.response();
  }

  /** Reports the error with the smallest offset; an error without one falls back to line 1, column 1. */
  private void parseError(List<Parsing.Error> errors) {
    Parsing.Error first = errors.get(0);
    for (Parsing.Error error : errors) {
      if (Math.max(error.offset(), 0) < Math.max(first.offset(), 0)) {
        first = error;
      }
    }
    String message = first.message().endsWith(".") ? first.message() : first.message() + ".";
    Map<String, Object> diagnostic = diagnostic("error", "code_parse_error", filePath, null, "Java parse error: " + message);
    diagnostic.put("location", positions.location(filePath, Math.max(first.offset(), 0)));
    diagnostics.add(diagnostic);
  }

  private void build(List<Declarations.Declaration> declarations, Set<String> visible) {
    Set<String> seenEndpoints = new HashSet<>();
    Set<String> duplicateEndpoints = new HashSet<>();
    Set<String> undocumentedEndpoints = new HashSet<>();
    // An endpoint that any kept declaration documents is never also
    // undocumented, whichever declaration comes first in the file.
    Set<String> documentedEndpoints = new HashSet<>();
    for (Declarations.Declaration declaration : declarations) {
      if (kept(declaration, visible) && !declaration.targets().isEmpty()) {
        documentedEndpoints.add(filePath + "#" + declaration.canonicalId());
      }
    }
    for (Declarations.Declaration declaration : declarations) {
      if (!kept(declaration, visible)) {
        if (!declaration.targets().isEmpty()) {
          Map<String, Object> diagnostic =
              diagnostic(
                  "warning",
                  "unsupported_declaration",
                  filePath,
                  null,
                  "Java declaration annotated with @doc is not supported.");
          diagnostic.put("location", positions.location(filePath, declaration.nameStart()));
          diagnostic.put("range", positions.range(declaration.nameStart(), declaration.nameEnd()));
          diagnostics.add(diagnostic);
        }
        continue;
      }

      Map<String, Object> symbol = symbol(declaration);
      String endpoint = filePath + "#" + declaration.canonicalId();
      if (declaration.targets().isEmpty()) {
        if (!documentedEndpoints.contains(endpoint) && undocumentedEndpoints.add(endpoint)) {
          undocumentedSymbols.add(symbol);
        }
        continue;
      }
      if (!seenEndpoints.add(endpoint)) {
        if (duplicateEndpoints.add(endpoint)) {
          Map<String, Object> diagnostic =
              diagnostic(
                  "error", "duplicate_code_symbol", endpoint, null, "Duplicate Java code symbol endpoint: " + endpoint);
          diagnostic.put("location", positions.location(filePath, declaration.nameStart()));
          diagnostic.put("range", positions.range(declaration.nameStart(), declaration.nameEnd()));
          diagnostics.add(diagnostic);
        }
        continue;
      }
      symbols.add(symbol);

      Set<String> seenTargets = new HashSet<>();
      for (DocComments.Target target : declaration.targets()) {
        Map<String, Object> location = positions.location(filePath, target.start());
        Map<String, Object> range = positions.range(target.start(), target.end());
        if (!LinkTargets.isValid(target.target(), filePath)) {
          Map<String, Object> diagnostic =
              diagnostic(
                  "error",
                  "invalid_link_target",
                  target.target(),
                  endpoint,
                  "Link target must be a project-root-relative file path and fragment in file#fragment form.");
          diagnostic.put("location", location);
          diagnostic.put("range", range);
          diagnostics.add(diagnostic);
          continue;
        }
        if (!seenTargets.add(target.target())) {
          Map<String, Object> diagnostic =
              diagnostic(
                  "warning",
                  "duplicate_link",
                  target.target(),
                  endpoint,
                  "Duplicate @doc link from " + endpoint + " to " + target.target() + ".");
          diagnostic.put("location", location);
          diagnostic.put("range", range);
          diagnostics.add(diagnostic);
          continue;
        }
        Map<String, Object> link = new LinkedHashMap<>();
        link.put("source", endpoint);
        link.put("target", target.target());
        link.put("location", location);
        link.put("targetRange", range);
        links.add(link);
      }
    }
  }

  /** A supported declaration inside the configured visibility classes; only these become symbols. */
  private static boolean kept(Declarations.Declaration declaration, Set<String> visible) {
    return !declaration.unsupported() && visible.contains(declaration.visibility());
  }

  private Map<String, Object> symbol(Declarations.Declaration declaration) {
    Map<String, Object> symbol = new LinkedHashMap<>();
    symbol.put("kind", "code");
    symbol.put("language", LANGUAGE);
    symbol.put("filePath", filePath);
    symbol.put("symbolName", declaration.symbolName());
    symbol.put("canonicalId", declaration.canonicalId());
    symbol.put("endpoint", filePath + "#" + declaration.canonicalId());
    symbol.put("location", positions.location(filePath, declaration.nameStart()));
    symbol.put("nameRange", positions.range(declaration.nameStart(), declaration.nameEnd()));
    symbol.put("declarationRange", positions.range(declaration.declStart(), declaration.declEnd()));
    symbol.put("signatureRange", positions.range(declaration.sigStart(), declaration.sigEnd()));
    return symbol;
  }

  private static Map<String, Object> diagnostic(
      String severity, String code, String target, String source, String message) {
    Map<String, Object> diagnostic = new LinkedHashMap<>();
    diagnostic.put("severity", severity);
    diagnostic.put("code", code);
    diagnostic.put("target", target);
    diagnostic.put("language", LANGUAGE);
    if (source != null) {
      diagnostic.put("source", source);
    }
    diagnostic.put("message", message);
    return diagnostic;
  }

  private Map<String, Object> response() {
    Map<String, Object> response = new LinkedHashMap<>();
    response.put("filePath", filePath);
    response.put("symbols", symbols);
    response.put("undocumentedSymbols", undocumentedSymbols);
    response.put("links", links);
    response.put("diagnostics", diagnostics);
    return response;
  }
}
