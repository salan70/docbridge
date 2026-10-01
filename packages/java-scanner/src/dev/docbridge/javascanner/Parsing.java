package dev.docbridge.javascanner;

import com.sun.source.tree.CompilationUnitTree;
import com.sun.source.tree.Tree;
import com.sun.source.util.DocTrees;
import com.sun.source.util.JavacTask;
import com.sun.source.util.SourcePositions;
import com.sun.source.util.TreePath;
import com.sun.source.util.Trees;
import java.io.IOException;
import java.net.URI;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.List;
import java.util.Locale;
import javax.tools.Diagnostic;
import javax.tools.DiagnosticCollector;
import javax.tools.JavaCompiler;
import javax.tools.JavaFileObject;
import javax.tools.SimpleJavaFileObject;
import javax.tools.StandardJavaFileManager;
import javax.tools.ToolProvider;

/**
 * Parses one Java source with the public {@code com.sun.source} API of
 * {@code jdk.compiler}: {@link JavacTask#parse()} only, never {@code analyze()},
 * with annotation processing off, no classpath, and no implicit compilation.
 * The internal {@code com.sun.tools.javac} packages are never touched.
 */
public final class Parsing {
  /** One parse error: javac's message and its UTF-16 offset in the content ({@code -1} if unknown). */
  public record Error(int offset, String message) {}

  /** The parse result of one file; {@code errors} holds every {@code ERROR} diagnostic in report order. */
  public record Parsed(
      CompilationUnitTree unit,
      SourcePositions sourcePositions,
      DocTrees docTrees,
      List<Error> errors,
      int offsetShift) {
    /** The declaration-start offset in the original content, {@code -1} when javac has none. */
    public int start(Tree tree) {
      return shift(sourcePositions.getStartPosition(unit, tree));
    }

    /** The end-exclusive offset in the original content, {@code -1} when javac has none. */
    public int end(Tree tree) {
      return shift(sourcePositions.getEndPosition(unit, tree));
    }

    public boolean hasDocComment(TreePath path) {
      return docTrees.getDocComment(path) != null;
    }

    private int shift(long offset) {
      return offset < 0 ? -1 : (int) offset + offsetShift;
    }
  }

  private static final List<String> OPTIONS = List.of("-proc:none", "-implicit:none", "-Xlint:none");

  private static final JavaCompiler COMPILER = ToolProvider.getSystemJavaCompiler();
  private static StandardJavaFileManager fileManager;

  private Parsing() {}

  /** Whether the running JDK provides {@code jdk.compiler}. */
  public static boolean available() {
    return COMPILER != null;
  }

  /**
   * Parses {@code content} as the file {@code filePath}. A leading BOM is
   * removed before parsing, because javac rejects it, and every reported offset
   * is shifted back so it indexes the original content.
   */
  public static Parsed parse(String filePath, String content) {
    Locale.setDefault(Locale.ENGLISH);
    int shift = content.startsWith("﻿") ? 1 : 0;
    String source = content.substring(shift);
    DiagnosticCollector<JavaFileObject> diagnostics = new DiagnosticCollector<>();
    JavaFileObject file =
        new SimpleJavaFileObject(URI.create("memory:///" + fileName(filePath)), JavaFileObject.Kind.SOURCE) {
          @Override
          public CharSequence getCharContent(boolean ignoreEncodingErrors) {
            return source;
          }
        };
    JavacTask task =
        (JavacTask)
            COMPILER.getTask(null, fileManager(diagnostics), diagnostics, OPTIONS, null, List.of(file));
    CompilationUnitTree unit;
    try {
      unit = task.parse().iterator().next();
    } catch (IOException | RuntimeException failure) {
      throw new IllegalStateException("javac failed to parse " + filePath + ": " + failure, failure);
    }
    List<Error> errors = new ArrayList<>();
    for (Diagnostic<? extends JavaFileObject> diagnostic : diagnostics.getDiagnostics()) {
      if (diagnostic.getKind() != Diagnostic.Kind.ERROR) {
        continue;
      }
      long offset = diagnostic.getStartPosition();
      if (offset == Diagnostic.NOPOS) {
        offset = diagnostic.getPosition();
      }
      errors.add(
          new Error(
              offset == Diagnostic.NOPOS ? -1 : (int) offset + shift,
              diagnostic.getMessage(Locale.ENGLISH)));
    }
    return new Parsed(
        unit, Trees.instance(task).getSourcePositions(), DocTrees.instance(task), errors, shift);
  }

  private static synchronized StandardJavaFileManager fileManager(
      DiagnosticCollector<JavaFileObject> diagnostics) {
    if (fileManager == null) {
      fileManager = COMPILER.getStandardFileManager(diagnostics, Locale.ENGLISH, StandardCharsets.UTF_8);
    }
    return fileManager;
  }

  /**
   * The last path segment, restricted to URI-safe characters, with the
   * {@code .java} suffix javac requires of a source. The name only labels the
   * in-memory file; nothing at parse time depends on it.
   */
  private static String fileName(String filePath) {
    int slash = Math.max(filePath.lastIndexOf('/'), filePath.lastIndexOf('\\'));
    String name = filePath.substring(slash + 1).replaceAll("[^A-Za-z0-9._-]", "_");
    return name.endsWith(".java") ? name : name + ".java";
  }
}
