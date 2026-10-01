package dev.docbridge.javascanner.tests;

import com.sun.source.tree.ClassTree;
import com.sun.source.tree.MethodTree;
import com.sun.source.tree.Tree;
import dev.docbridge.javascanner.DocComments;
import dev.docbridge.javascanner.Json;
import dev.docbridge.javascanner.NameLocator;
import dev.docbridge.javascanner.Parsing;
import dev.docbridge.javascanner.Positions;
import dev.docbridge.javascanner.Scanner;
import dev.docbridge.javascanner.Signatures;
import dev.docbridge.javascanner.Worker;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.stream.Stream;

/**
 * A {@code main}-based assertion runner: the JDK ships no test framework and the
 * worker takes no third-party dependency. It runs every JSON case under the
 * directory given as the first argument ({@code {"request": ..., "response":
 * ...}}) through the in-process scanner, plus unit checks of position
 * conversion, signature printing, name location, and the JSON codec, and
 * scans compared through a one-line summary per symbol, link, and diagnostic,
 * and exits 1 on any failure.
 */
public final class TestMain {
  private static int passed;
  private static final List<String> failures = new ArrayList<>();

  private TestMain() {}

  public static void main(String[] args) throws IOException {
    if (args.length != 1) {
      System.err.println("usage: TestMain <cases-directory>");
      System.exit(2);
    }
    runCases(Path.of(args[0]));
    checkPositions();
    checkSignatures();
    checkJson();
    checkCStyleArrayNames();
    checkUnicodeNames();
    checkNameFallback();
    checkDocWhitespace();
    checkDuplicateCardinality();
    System.out.println(passed + " passed, " + failures.size() + " failed");
    if (!failures.isEmpty()) {
      System.exit(1);
    }
  }

  private static void runCases(Path directory) throws IOException {
    List<Path> files;
    try (Stream<Path> listing = Files.list(directory)) {
      files = listing.filter(path -> path.toString().endsWith(".json")).sorted().toList();
    }
    if (files.isEmpty()) {
      fail("cases", "no JSON cases under " + directory);
      return;
    }
    for (Path file : files) {
      String name = file.getFileName().toString();
      Object parsed = Json.parse(Files.readString(file, StandardCharsets.UTF_8));
      if (!(parsed instanceof Map<?, ?> testCase)) {
        fail(name, "case is not an object");
        continue;
      }
      Object request = testCase.get("request");
      Object expected = testCase.get("response");
      Object actual;
      try {
        actual = Worker.scanRequest(request);
      } catch (RuntimeException error) {
        fail(name, "scanner threw " + error);
        continue;
      }
      // Round-tripping through the codec normalizes numbers, so a case written
      // with integers compares equal to the worker's integer output.
      Object normalized = Json.parse(Json.write(actual));
      check(name, expected, normalized);
    }
  }

  private static void checkPositions() {
    // Columns count UTF-16 code units; lines split on '\n' only so CRLF files
    // keep their '\r' inside the line; a BOM is a code unit on line 1.
    Positions positions = new Positions("﻿a\r\nb😀c\n\te");
    check("positions: bom", "1:1", format(positions.position(0)));
    check("positions: after bom", "1:2", format(positions.position(1)));
    check("positions: before CR", "1:3", format(positions.position(2)));
    check("positions: CR is on its line", "1:4", format(positions.position(3)));
    check("positions: second line start", "2:1", format(positions.position(4)));
    check("positions: surrogate pair counts two", "2:4", format(positions.position(7)));
    check("positions: end of second line", "2:5", format(positions.position(8)));
    check("positions: tab counts one", "3:2", format(positions.position(10)));
    check("positions: end of content", "3:3", format(positions.position(11)));
    check("positions: clamped past end", "3:3", format(positions.position(99)));
    check("positions: clamped negative", "1:1", format(positions.position(-5)));
  }

  private static String format(Positions.Position position) {
    return position.line() + ":" + position.column();
  }

  private static void checkSignatures() {
    String source =
        "import java.util.Map;\n"
            + "class X<T> {\n"
            + "  <U> void m(@A final java.util.List<String> a, T[] b, Map.Entry<K, V> d,\n"
            + "      int @A [] e, @A int f, U g, Outer<A>.Inner h, char j[], long[][] k) {}\n"
            + "  void n(int... c) {}\n"
            + "  void o(String x, String[]... i) {}\n"
            + "  void p() {}\n"
            + "}\n";
    Parsing.Parsed parsed = Parsing.parse("X.java", source);
    check("signatures: parses", List.of(), parsed.errors());
    ClassTree type = (ClassTree) parsed.unit().getTypeDecls().get(0);
    List<String> printed = new ArrayList<>();
    for (Tree member : type.getMembers()) {
      if (member instanceof MethodTree method) {
        printed.add(Signatures.parameterList(method));
      }
    }
    check(
        "signatures: parameter types",
        List.of(
            "(java.util.List,T[],Map.Entry,int[],int,U,Outer.Inner,char[],long[][])",
            "(int[])",
            "(String,String[][])",
            "()"),
        printed);
  }

  private static void checkJson() {
    String text = "{\"a\":[1,-2.5,true,false,null,\"\\u00e9\\ud83d\\ude00\\n\\\"\"],\"b\":{}}";
    Object parsed = Json.parse(text);
    check("json: round trip", text.replace("\\u00e9\\ud83d\\ude00", "é😀"), Json.write(parsed));
    check("json: integer", 1L, ((List<?>) ((Map<?, ?>) parsed).get("a")).get(0));
    check("json: control characters escaped", "\"\\u0001\\t\"", Json.write("\u0001\t"));
    check("json: 1e2 is a number", 100.0, Json.parse("1e2"));
    try {
      Json.parse("{\"a\":}");
      fail("json: rejects malformed", "no exception");
    } catch (IllegalArgumentException expected) {
      passed++;
    }
  }

  private static void checkCStyleArrayNames() {
    // Dimensions written after a name belong to javac's type tree, so the
    // type tree ends after the name it surrounds.
    checkScan(
        "names: c-style array dimensions",
        "public class A {\n"
            + "  public int xs[];\n"
            + "  public int[] ys[];\n"
            + "  public int legacy()[] { return null; }\n"
            + "  public int @T [] g @U [];\n"
            + "  public Foo Foo;\n"
            + "  public Foo Foo()[] { return null; }\n"
            + "}\n",
        ALL,
        List.of(
            "undocumented A|A|1:14-1:15",
            "undocumented xs|A.xs|2:14-2:16",
            "undocumented ys|A.ys|3:16-3:18",
            "undocumented legacy|A.legacy()|4:14-4:20",
            "undocumented g|A.g|5:20-5:21",
            "undocumented Foo|A.Foo|6:14-6:17",
            "undocumented Foo|A.Foo()|7:14-7:17"));
    // `int a[], b;` gives each name its own type tree around one shared
    // element type; the statement is still one group with one Javadoc.
    checkScan(
        "names: c-style array dimensions in a field group",
        "public class G {\n"
            + "  /** @doc d.md#a */\n"
            + "  public int a[], b;\n"
            + "  /** @doc d.md#c */\n"
            + "  public int c, d[];\n"
            + "}\n",
        ALL,
        List.of(
            "undocumented G|G|1:14-1:15",
            "undocumented a|G.a|3:14-3:15",
            "undocumented b|G.b|3:19-3:20",
            "undocumented c|G.c|5:14-5:15",
            "undocumented d|G.d|5:17-5:18",
            "diagnostic unsupported_declaration|Input.java|3:14-3:15",
            "diagnostic unsupported_declaration|Input.java|5:14-5:15"));
    checkScan(
        "names: c-style array field outside the visibility filter",
        "public class H {\n  private int xs[];\n}\n",
        null,
        List.of("undocumented H|H|1:14-1:15"));
  }

  private static void checkUnicodeNames() {
    checkScan(
        "names: supplementary code points",
        "public class \uD801\uDC00 {\n  /** @doc d.md#a */\n  public void \uD801\uDC01() {}\n}\n",
        ALL,
        List.of(
            "symbol \uD801\uDC01|\uD801\uDC00.\uD801\uDC01()|3:15-3:17",
            "undocumented \uD801\uDC00|\uD801\uDC00|1:14-1:16",
            "link Input.java#\uD801\uDC00.\uD801\uDC01()|d.md#a"));
    // The ID uses javac's decoded name; the ranges cover the raw spelling.
    // javac drops identifier-ignorable characters such as U+200B from a name.
    checkScan(
        "names: unicode escapes",
        "public class \\u0046oo {\n"
            + "  /** @doc d.md#a */\n"
            + "  public void \\u006d(\\u0046oo f, \\u0046oo... more) {}\n"
            + "  public \\u0046oo() {}\n"
            + "  public int \\uD801\\uDC00;\n"
            + "  public int b\\u200Bar;\n"
            + "}\n",
        ALL,
        List.of(
            "symbol m|Foo.m(Foo,Foo[])|3:15-3:21",
            "undocumented Foo|Foo|1:14-1:22",
            "undocumented Foo|Foo.Foo()|4:10-4:18",
            "undocumented \uD801\uDC00|Foo.\uD801\uDC00|5:14-5:26",
            "undocumented bar|Foo.bar|6:14-6:23",
            "link Input.java#Foo.m(Foo,Foo[])|d.md#a"));
  }

  private static void checkNameFallback() {
    String content = "class A {}\n";
    NameLocator locator = new NameLocator(new DocComments(content));
    check("names: located name", new NameLocator.Span(6, 7), locator.locate(0, "A", null, List.of(), 0));
    check(
        "names: unlocatable name falls back to an empty span",
        new NameLocator.Span(3, 3),
        locator.locate(0, "Missing", null, List.of(), 3));
    // javac reads `/\u002A ( \u002A/` as a comment, but the comment lexer
    // reads raw source, so the name search stops at the `(`: the symbol stays,
    // located at the declaration start, and the scan continues.
    checkScan(
        "names: unlocatable name keeps the symbol",
        "public class /\\u002A ( \\u002A/ Foo {\n  public int x;\n}\n",
        ALL,
        List.of("undocumented Foo|Foo|1:1-1:1", "undocumented x|Foo.x|2:14-2:15"));
  }

  private static void checkDocWhitespace() {
    // `@doc\s+(\S+)` uses the ASCII whitespace set: space, tab, LF, CR, FF,
    // and VT. A no-break space is neither a separator nor part of a target.
    checkScan(
        "doc: ascii whitespace only",
        "public class W {\n"
            + "  /** @doc\u00A0d.md#a */\n"
            + "  public void nbsp() {}\n"
            + "  /** @doc\u000Bd.md#b @doc\fd.md#c */\n"
            + "  public void ascii() {}\n"
            + "}\n",
        ALL,
        List.of(
            "symbol ascii|W.ascii()|5:15-5:20",
            "undocumented W|W|1:14-1:15",
            "undocumented nbsp|W.nbsp()|3:15-3:19",
            "link Input.java#W.ascii()|d.md#b",
            "link Input.java#W.ascii()|d.md#c"));
  }

  private static void checkDuplicateCardinality() {
    // The first declaration keeps the endpoint; one diagnostic per endpoint,
    // at the first repeat, and later repeats are dropped silently.
    checkScan(
        "duplicates: one diagnostic per endpoint",
        "public class D {\n"
            + "  /** @doc d.md#a */\n"
            + "  public void m(int x) {}\n"
            + "  /** @doc d.md#b */\n"
            + "  public void m(int y) {}\n"
            + "  /** @doc d.md#c */\n"
            + "  public void m(int z) {}\n"
            + "}\n",
        ALL,
        List.of(
            "symbol m|D.m(int)|3:15-3:16",
            "undocumented D|D|1:14-1:15",
            "link Input.java#D.m(int)|d.md#a",
            "diagnostic duplicate_code_symbol|Input.java#D.m(int)|5:15-5:16"));
  }

  private static final List<String> ALL = List.of("public", "protected", "package", "private");

  /**
   * Scans {@code content} as {@code Input.java} and compares a one-line
   * summary per symbol, link, and diagnostic: names, IDs, targets, and the
   * name or diagnostic range.
   */
  private static void checkScan(String name, String content, List<String> visibility, List<String> expected) {
    Map<String, Object> file;
    try {
      file = Scanner.scanFile("Input.java", content, visibility);
    } catch (RuntimeException error) {
      fail(name, "scanner threw " + error);
      return;
    }
    List<String> actual = new ArrayList<>();
    for (Object symbol : (List<?>) file.get("symbols")) {
      actual.add("symbol " + symbolSummary((Map<?, ?>) symbol));
    }
    for (Object symbol : (List<?>) file.get("undocumentedSymbols")) {
      actual.add("undocumented " + symbolSummary((Map<?, ?>) symbol));
    }
    for (Object item : (List<?>) file.get("links")) {
      Map<?, ?> link = (Map<?, ?>) item;
      actual.add("link " + link.get("source") + "|" + link.get("target"));
    }
    for (Object item : (List<?>) file.get("diagnostics")) {
      Map<?, ?> diagnostic = (Map<?, ?>) item;
      actual.add(
          "diagnostic "
              + diagnostic.get("code")
              + "|"
              + diagnostic.get("target")
              + "|"
              + rangeSummary((Map<?, ?>) diagnostic.get("range")));
    }
    check(name, expected, actual);
  }

  private static String symbolSummary(Map<?, ?> symbol) {
    return symbol.get("symbolName")
        + "|"
        + symbol.get("canonicalId")
        + "|"
        + rangeSummary((Map<?, ?>) symbol.get("nameRange"));
  }

  private static String rangeSummary(Map<?, ?> range) {
    if (range == null) {
      return "-";
    }
    Map<?, ?> start = (Map<?, ?>) range.get("start");
    Map<?, ?> end = (Map<?, ?>) range.get("end");
    return start.get("line") + ":" + start.get("column") + "-" + end.get("line") + ":" + end.get("column");
  }

  private static void check(String name, Object expected, Object actual) {
    if (expected == null ? actual == null : expected.equals(actual)) {
      passed++;
      return;
    }
    fail(
        name,
        "expected " + render(expected) + " (" + className(expected) + ")\n  actual   " + render(actual) + " (" + className(actual) + ")");
  }

  private static String className(Object value) {
    return value == null ? "null" : value.getClass().getSimpleName();
  }

  private static String render(Object value) {
    if (value instanceof String text) {
      return text;
    }
    try {
      return Json.write(value);
    } catch (IllegalArgumentException notJson) {
      return String.valueOf(value);
    }
  }

  private static void fail(String name, String detail) {
    failures.add(name);
    System.err.println("FAIL " + name + ": " + detail);
  }
}
