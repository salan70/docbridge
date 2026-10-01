package dev.docbridge.javascanner.tests;

import com.sun.source.tree.ClassTree;
import com.sun.source.tree.MethodTree;
import com.sun.source.tree.Tree;
import dev.docbridge.javascanner.Json;
import dev.docbridge.javascanner.Parsing;
import dev.docbridge.javascanner.Positions;
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
 * conversion, signature printing, and the JSON codec, and exits 1 on any
 * failure.
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
