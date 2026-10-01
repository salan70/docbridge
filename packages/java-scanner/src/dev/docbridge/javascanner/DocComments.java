package dev.docbridge.javascanner;

import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * Locates comments in the original source and extracts {@code @doc} targets
 * from Javadoc comments.
 *
 * <p>The {@code com.sun.source} API exposes a Javadoc comment only with its
 * formatting stripped, so the raw text and its offsets come from a small lexer
 * over the content that understands string, character, and text-block
 * literals. {@code //} and {@code /* *}{@code /} comments are located so the
 * search for a declaration's Javadoc can step over them, but they never carry
 * annotations.
 */
public final class DocComments {
  /** One comment: {@code [start, end)} offsets including the delimiters. */
  public record Comment(int start, int end, boolean javadoc) {}

  /** One {@code @doc} target with the {@code [start, end)} offsets of the target text. */
  public record Target(String target, int start, int end) {}

  /**
   * {@code @doc\s+(\S+)} over the ASCII whitespace set, spelled out so no
   * flag can widen it: space, tab, LF, CR, FF, and VT. A no-break space is
   * neither a separator nor whitespace inside a target.
   */
  private static final Pattern DOC = Pattern.compile("@doc[ \\t\\n\\r\\f\\x0B]+([^ \\t\\n\\r\\f\\x0B]+)");
  private static final Pattern LEADING_ASTERISKS = Pattern.compile("(?m)^[ \\t\\f]*(\\*+)");

  private final String content;
  private final List<Comment> comments;
  private final Map<Integer, Comment> byStart = new HashMap<>();
  private final Map<Integer, Comment> byEnd = new HashMap<>();

  public DocComments(String content) {
    this.content = content;
    this.comments = lex(content);
    for (Comment comment : comments) {
      byStart.put(comment.start(), comment);
      byEnd.put(comment.end(), comment);
    }
  }

  public String content() {
    return content;
  }

  /** Every comment in source order. */
  public List<Comment> comments() {
    return comments;
  }

  /**
   * The Javadoc that documents a declaration starting at {@code offset}: the
   * last {@code /**} comment before it, separated from it only by whitespace
   * and non-Javadoc comments, which is what javac associates.
   */
  public Comment javadocBefore(int offset) {
    int position = significantEndBefore(offset, true);
    Comment comment = byEnd.get(position);
    return comment != null && comment.javadoc() ? comment : null;
  }

  /**
   * The end of the last significant text before {@code offset}, skipping
   * whitespace and comments backwards. With {@code stopAtJavadoc}, a Javadoc
   * comment is significant and the returned offset is its end.
   */
  public int significantEndBefore(int offset, boolean stopAtJavadoc) {
    int position = offset;
    while (true) {
      while (position > 0 && isWhitespace(content.charAt(position - 1))) {
        position--;
      }
      Comment comment = byEnd.get(position);
      if (comment == null || (stopAtJavadoc && comment.javadoc())) {
        return position;
      }
      position = comment.start();
    }
  }

  /**
   * The offset of the first significant character at or after {@code offset},
   * skipping whitespace and comments; the content length at the end.
   */
  public int significantStartAfter(int offset) {
    int position = offset;
    while (position < content.length()) {
      char c = content.charAt(position);
      if (isWhitespace(c)) {
        position++;
        continue;
      }
      Comment comment = commentAt(position);
      if (comment == null) {
        return position;
      }
      position = comment.end();
    }
    return content.length();
  }

  /** The comment starting exactly at {@code offset}, if any. */
  public Comment commentAt(int offset) {
    return byStart.get(offset);
  }

  /**
   * Every {@code @doc\s+(\S+)} match in a Javadoc's body. The body excludes the
   * {@code /**} and {@code *}{@code /} delimiters, so a target directly followed
   * by the closing delimiter ends before it, and the asterisks that lead
   * continuation lines are treated as whitespace, so they are never part of a
   * target.
   */
  public List<Target> targets(Comment comment) {
    int bodyStart = comment.start() + 3;
    int bodyEnd = Math.max(bodyStart, comment.end() - 2);
    String body = content.substring(bodyStart, bodyEnd);
    Matcher asterisks = LEADING_ASTERISKS.matcher(body);
    StringBuilder masked = new StringBuilder(body);
    while (asterisks.find()) {
      for (int i = asterisks.start(1); i < asterisks.end(1); i++) {
        masked.setCharAt(i, ' ');
      }
    }
    List<Target> targets = new ArrayList<>();
    Matcher match = DOC.matcher(masked);
    while (match.find()) {
      targets.add(
          new Target(
              body.substring(match.start(1), match.end(1)),
              bodyStart + match.start(1),
              bodyStart + match.end(1)));
    }
    return targets;
  }

  public static boolean isWhitespace(char c) {
    return c == ' ' || c == '\t' || c == '\n' || c == '\r' || c == '\f';
  }

  private static List<Comment> lex(String content) {
    List<Comment> comments = new ArrayList<>();
    int length = content.length();
    int i = 0;
    while (i < length) {
      char c = content.charAt(i);
      if (c == '/' && i + 1 < length && content.charAt(i + 1) == '/') {
        int end = content.indexOf('\n', i);
        end = end < 0 ? length : end;
        comments.add(new Comment(i, end, false));
        i = end;
      } else if (c == '/' && i + 1 < length && content.charAt(i + 1) == '*') {
        int close = content.indexOf("*/", i + 2);
        int end = close < 0 ? length : close + 2;
        boolean javadoc =
            i + 2 < length && content.charAt(i + 2) == '*' && !(i + 3 < length && content.charAt(i + 3) == '/');
        comments.add(new Comment(i, end, javadoc));
        i = end;
      } else if (c == '"' && content.startsWith("\"\"\"", i)) {
        int close = content.indexOf("\"\"\"", i + 3);
        while (close >= 0 && escaped(content, close)) {
          close = content.indexOf("\"\"\"", close + 1);
        }
        i = close < 0 ? length : close + 3;
      } else if (c == '"' || c == '\'') {
        i = skipLiteral(content, i, c);
      } else {
        i++;
      }
    }
    return comments;
  }

  /** Skips a string or character literal; an unterminated one ends at the line end. */
  private static int skipLiteral(String content, int start, char quote) {
    int i = start + 1;
    while (i < content.length()) {
      char c = content.charAt(i);
      if (c == '\\') {
        i += 2;
      } else if (c == quote) {
        return i + 1;
      } else if (c == '\n') {
        return i;
      } else {
        i++;
      }
    }
    return content.length();
  }

  private static boolean escaped(String content, int index) {
    int backslashes = 0;
    for (int i = index - 1; i >= 0 && content.charAt(i) == '\\'; i--) {
      backslashes++;
    }
    return backslashes % 2 == 1;
  }
}
