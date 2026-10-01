package dev.docbridge.javascanner;

import java.util.List;

/**
 * Finds a declaration's name in the raw source. javac reports where a
 * declaration starts and ends but not where its name is, so the name is found
 * by stepping through the header's tokens and reading identifiers the way javac
 * reads them: by code point, with Unicode escapes (JLS 3.3) decoded and
 * identifier-ignorable characters dropped from the name. javac's decoded name
 * then matches its raw spelling, and the span covers that raw spelling.
 */
public final class NameLocator {
  /** A {@code [start, end)} span of offsets into the raw content. */
  public record Span(int start, int end) {
    boolean contains(int offset) {
      return start <= offset && offset < end;
    }
  }

  /** One decoded character: its code point and the raw offset after its spelling. */
  private record Decoded(int codePoint, int end) {}

  /** One identifier: javac's name for it and the raw offset after its spelling. */
  private record Identifier(String name, int end) {}

  private final DocComments comments;
  private final String content;

  public NameLocator(DocComments comments) {
    this.comments = comments;
    this.content = comments.content();
  }

  /**
   * The span of {@code name} as {@link #find} locates it, or an empty span at
   * {@code fallback} when the name cannot be located, so an unusual header
   * costs the name's position but never the declaration or the scan.
   */
  public Span locate(int from, String name, String followedBy, List<Span> skipped, int fallback) {
    Span found = find(from, name, followedBy, skipped);
    return found != null ? found : new Span(fallback, fallback);
  }

  /**
   * Finds the identifier {@code name} at or after {@code from}, stepping over
   * whitespace, comments, the {@code skipped} spans (type and annotation trees
   * that can spell the same identifier), other identifiers and keywords, and
   * punctuation such as {@code >}, {@code )}, {@code ,}, {@code [}, {@code @},
   * and the hyphen of {@code non-sealed}. With {@code followedBy}, the
   * identifier must be followed (after whitespace and comments) by one of
   * those characters. Stops at the first character that opens a body,
   * parameter list, or initializer, returning {@code null}.
   */
  private Span find(int from, String name, String followedBy, List<Span> skipped) {
    int position = Math.max(from, 0);
    while (true) {
      position = comments.significantStartAfter(position);
      if (position >= content.length()) {
        return null;
      }
      Span skip = spanAt(skipped, position);
      if (skip != null) {
        position = skip.end();
        continue;
      }
      Identifier identifier = identifierAt(position);
      if (identifier != null) {
        if (identifier.name().equals(name) && isFollowedBy(identifier.end(), followedBy)) {
          return new Span(position, identifier.end());
        }
        position = identifier.end();
        continue;
      }
      Decoded character = decode(position);
      int c = character.codePoint();
      if (c == '(' || c == '{' || c == ';' || c == '=') {
        return null;
      }
      position = character.end();
    }
  }

  private static Span spanAt(List<Span> spans, int offset) {
    for (Span span : spans) {
      if (span.contains(offset)) {
        return span;
      }
    }
    return null;
  }

  private boolean isFollowedBy(int end, String characters) {
    if (characters == null) {
      return true;
    }
    int next = comments.significantStartAfter(end);
    return next < content.length() && characters.indexOf(decode(next).codePoint()) >= 0;
  }

  /** The identifier starting at {@code position}, or {@code null} when none starts there. */
  private Identifier identifierAt(int position) {
    Decoded first = decode(position);
    if (!Character.isJavaIdentifierStart(first.codePoint())) {
      return null;
    }
    StringBuilder name = new StringBuilder().appendCodePoint(first.codePoint());
    int end = first.end();
    while (end < content.length()) {
      Decoded next = decode(end);
      if (!Character.isJavaIdentifierPart(next.codePoint())) {
        break;
      }
      if (!Character.isIdentifierIgnorable(next.codePoint())) {
        name.appendCodePoint(next.codePoint());
      }
      end = next.end();
    }
    return new Identifier(name.toString(), end);
  }

  /** The code point at {@code position}; a surrogate pair may mix raw and escaped halves. */
  private Decoded decode(int position) {
    Decoded unit = decodeUnit(position);
    if (Character.isHighSurrogate((char) unit.codePoint()) && unit.end() < content.length()) {
      Decoded low = decodeUnit(unit.end());
      if (Character.isLowSurrogate((char) low.codePoint())) {
        return new Decoded(Character.toCodePoint((char) unit.codePoint(), (char) low.codePoint()), low.end());
      }
    }
    return unit;
  }

  /**
   * The UTF-16 unit at {@code position}: a raw character, or a Unicode escape
   * ({@code \}, one or more {@code u}, four hex digits) when the backslash is
   * preceded by an even number of backslashes.
   */
  private Decoded decodeUnit(int position) {
    char c = content.charAt(position);
    if (c == '\\' && precedingBackslashes(position) % 2 == 0) {
      int digits = position + 1;
      while (digits < content.length() && content.charAt(digits) == 'u') {
        digits++;
      }
      if (digits > position + 1 && digits + 4 <= content.length()) {
        int value = 0;
        for (int i = digits; i < digits + 4 && value >= 0; i++) {
          int digit = hexDigit(content.charAt(i));
          value = digit < 0 ? -1 : value * 16 + digit;
        }
        if (value >= 0) {
          return new Decoded(value, digits + 4);
        }
      }
    }
    return new Decoded(c, position + 1);
  }

  private int precedingBackslashes(int position) {
    int count = 0;
    for (int i = position - 1; i >= 0 && content.charAt(i) == '\\'; i--) {
      count++;
    }
    return count;
  }

  private static int hexDigit(char c) {
    if (c >= '0' && c <= '9') {
      return c - '0';
    }
    if (c >= 'a' && c <= 'f') {
      return c - 'a' + 10;
    }
    if (c >= 'A' && c <= 'F') {
      return c - 'A' + 10;
    }
    return -1;
  }
}
