package dev.docbridge.javascanner;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * A minimal JSON reader and writer, because the JDK ships none and the worker
 * takes no third-party dependency.
 *
 * <p>Values map to {@code LinkedHashMap<String, Object>} (key order preserved),
 * {@code ArrayList<Object>}, {@code String}, {@code Long} for integral numbers,
 * {@code Double} otherwise, {@code Boolean}, and {@code null}. The writer emits
 * the same types plus any {@link Number}, with no insignificant whitespace, and
 * escapes only what RFC 8259 requires so non-ASCII text stays readable.
 */
public final class Json {
  private final String text;
  private int index;

  private Json(String text) {
    this.text = text;
  }

  /** Parses one JSON document; trailing whitespace is allowed, anything else is not. */
  public static Object parse(String text) {
    Json parser = new Json(text);
    Object value = parser.readValue();
    parser.skipWhitespace();
    if (parser.index != text.length()) {
      throw parser.error("unexpected trailing content");
    }
    return value;
  }

  /** Serializes a value produced by {@link #parse} or built from the same types. */
  public static String write(Object value) {
    StringBuilder out = new StringBuilder();
    writeValue(out, value);
    return out.toString();
  }

  private Object readValue() {
    skipWhitespace();
    if (index >= text.length()) {
      throw error("unexpected end of input");
    }
    char c = text.charAt(index);
    switch (c) {
      case '{':
        return readObject();
      case '[':
        return readArray();
      case '"':
        return readString();
      case 't':
        expectWord("true");
        return Boolean.TRUE;
      case 'f':
        expectWord("false");
        return Boolean.FALSE;
      case 'n':
        expectWord("null");
        return null;
      default:
        if (c == '-' || (c >= '0' && c <= '9')) {
          return readNumber();
        }
        throw error("unexpected character '" + c + "'");
    }
  }

  private Map<String, Object> readObject() {
    Map<String, Object> object = new LinkedHashMap<>();
    index++;
    skipWhitespace();
    if (peek() == '}') {
      index++;
      return object;
    }
    while (true) {
      skipWhitespace();
      if (peek() != '"') {
        throw error("expected a string key");
      }
      String key = readString();
      skipWhitespace();
      expect(':');
      object.put(key, readValue());
      skipWhitespace();
      char next = peek();
      index++;
      if (next == '}') {
        return object;
      }
      if (next != ',') {
        throw error("expected ',' or '}'");
      }
    }
  }

  private List<Object> readArray() {
    List<Object> array = new ArrayList<>();
    index++;
    skipWhitespace();
    if (peek() == ']') {
      index++;
      return array;
    }
    while (true) {
      array.add(readValue());
      skipWhitespace();
      char next = peek();
      index++;
      if (next == ']') {
        return array;
      }
      if (next != ',') {
        throw error("expected ',' or ']'");
      }
    }
  }

  private String readString() {
    index++;
    StringBuilder out = new StringBuilder();
    while (true) {
      if (index >= text.length()) {
        throw error("unterminated string");
      }
      char c = text.charAt(index++);
      if (c == '"') {
        return out.toString();
      }
      if (c < 0x20) {
        throw error("control character in string");
      }
      if (c != '\\') {
        out.append(c);
        continue;
      }
      if (index >= text.length()) {
        throw error("unterminated escape");
      }
      char escape = text.charAt(index++);
      switch (escape) {
        case '"':
        case '\\':
        case '/':
          out.append(escape);
          break;
        case 'b':
          out.append('\b');
          break;
        case 'f':
          out.append('\f');
          break;
        case 'n':
          out.append('\n');
          break;
        case 'r':
          out.append('\r');
          break;
        case 't':
          out.append('\t');
          break;
        case 'u':
          if (index + 4 > text.length()) {
            throw error("truncated unicode escape");
          }
          try {
            out.append((char) Integer.parseInt(text.substring(index, index + 4), 16));
          } catch (NumberFormatException invalid) {
            throw error("invalid unicode escape");
          }
          index += 4;
          break;
        default:
          throw error("invalid escape '\\" + escape + "'");
      }
    }
  }

  private Number readNumber() {
    int start = index;
    if (peek() == '-') {
      index++;
    }
    boolean integral = true;
    while (index < text.length()) {
      char c = text.charAt(index);
      if (c >= '0' && c <= '9') {
        index++;
      } else if (c == '.' || c == 'e' || c == 'E' || c == '+' || c == '-') {
        integral = false;
        index++;
      } else {
        break;
      }
    }
    String literal = text.substring(start, index);
    try {
      // Not a conditional expression: mixing Long and Double there would
      // promote both to double.
      if (integral) {
        return Long.valueOf(literal);
      }
      return Double.valueOf(literal);
    } catch (NumberFormatException invalid) {
      throw error("invalid number '" + literal + "'");
    }
  }

  private void expectWord(String word) {
    if (!text.startsWith(word, index)) {
      throw error("expected '" + word + "'");
    }
    index += word.length();
  }

  private void expect(char c) {
    if (peek() != c) {
      throw error("expected '" + c + "'");
    }
    index++;
  }

  private char peek() {
    if (index >= text.length()) {
      throw error("unexpected end of input");
    }
    return text.charAt(index);
  }

  private void skipWhitespace() {
    while (index < text.length()) {
      char c = text.charAt(index);
      if (c != ' ' && c != '\t' && c != '\n' && c != '\r') {
        return;
      }
      index++;
    }
  }

  private IllegalArgumentException error(String message) {
    return new IllegalArgumentException("invalid JSON at offset " + index + ": " + message);
  }

  private static void writeValue(StringBuilder out, Object value) {
    if (value == null) {
      out.append("null");
    } else if (value instanceof String text) {
      writeString(out, text);
    } else if (value instanceof Boolean || value instanceof Long || value instanceof Integer) {
      out.append(value);
    } else if (value instanceof Number number) {
      double d = number.doubleValue();
      if (d == Math.rint(d) && !Double.isInfinite(d) && Math.abs(d) < 1e15) {
        out.append((long) d);
      } else {
        out.append(d);
      }
    } else if (value instanceof Map<?, ?> map) {
      out.append('{');
      boolean first = true;
      for (Map.Entry<?, ?> entry : map.entrySet()) {
        if (!first) {
          out.append(',');
        }
        first = false;
        writeString(out, String.valueOf(entry.getKey()));
        out.append(':');
        writeValue(out, entry.getValue());
      }
      out.append('}');
    } else if (value instanceof Iterable<?> list) {
      out.append('[');
      boolean first = true;
      for (Object item : list) {
        if (!first) {
          out.append(',');
        }
        first = false;
        writeValue(out, item);
      }
      out.append(']');
    } else {
      throw new IllegalArgumentException("cannot serialize " + value.getClass().getName());
    }
  }

  private static void writeString(StringBuilder out, String text) {
    out.append('"');
    for (int i = 0; i < text.length(); i++) {
      char c = text.charAt(i);
      switch (c) {
        case '"':
          out.append("\\\"");
          break;
        case '\\':
          out.append("\\\\");
          break;
        case '\n':
          out.append("\\n");
          break;
        case '\r':
          out.append("\\r");
          break;
        case '\t':
          out.append("\\t");
          break;
        default:
          if (c < 0x20) {
            out.append(String.format("\\u%04x", (int) c));
          } else {
            out.append(c);
          }
      }
    }
    out.append('"');
  }
}
