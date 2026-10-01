package dev.docbridge.javascanner;

import java.util.Arrays;
import java.util.LinkedHashMap;
import java.util.Map;

/**
 * Converts UTF-16 code unit offsets into the 1-based line and column positions
 * of the worker protocol.
 *
 * <p>Lines are split on {@code '\n'} only, so a CRLF file keeps its {@code '\r'}
 * inside the line, and a BOM is an ordinary code unit on line 1. Columns are
 * derived from the content itself, never from javac's {@code LineMap}, which
 * expands tabs.
 */
public final class Positions {
  /** A 1-based line and UTF-16 column. */
  public record Position(int line, int column) {}

  private final String content;
  private final int[] lineStarts;

  public Positions(String content) {
    this.content = content;
    int count = 1;
    for (int i = 0; i < content.length(); i++) {
      if (content.charAt(i) == '\n') {
        count++;
      }
    }
    int[] starts = new int[count];
    int next = 1;
    for (int i = 0; i < content.length(); i++) {
      if (content.charAt(i) == '\n') {
        starts[next++] = i + 1;
      }
    }
    this.lineStarts = starts;
  }

  public String content() {
    return content;
  }

  public Position position(int offset) {
    int clamped = Math.max(0, Math.min(offset, content.length()));
    int found = Arrays.binarySearch(lineStarts, clamped);
    int lineIndex = found >= 0 ? found : -found - 2;
    return new Position(lineIndex + 1, clamped - lineStarts[lineIndex] + 1);
  }

  /** The protocol's location object for an offset. */
  public Map<String, Object> location(String filePath, int offset) {
    Position position = position(offset);
    Map<String, Object> location = new LinkedHashMap<>();
    location.put("filePath", filePath);
    location.put("line", position.line());
    location.put("column", position.column());
    return location;
  }

  /** The protocol's end-exclusive range object for two offsets. */
  public Map<String, Object> range(int start, int end) {
    Map<String, Object> range = new LinkedHashMap<>();
    range.put("start", positionObject(start));
    range.put("end", positionObject(end));
    return range;
  }

  private Map<String, Object> positionObject(int offset) {
    Position position = position(offset);
    Map<String, Object> object = new LinkedHashMap<>();
    object.put("line", position.line());
    object.put("column", position.column());
    return object;
  }
}
