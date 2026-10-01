package dev.docbridge.javascanner;

import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * The worker protocol: one schemaVersion 1 request read from stdin, one
 * response written to stdout as a single line, files in request order. Stderr
 * carries only error text.
 */
public final class Worker {
  private Worker() {}

  /** Entry point for the scan mode; returns the process exit status. */
  public static int run(InputStream in, OutputStream out, OutputStream err) {
    try {
      String input = new String(in.readAllBytes(), StandardCharsets.UTF_8);
      Object request = Json.parse(input);
      Map<String, Object> response = scanRequest(request);
      out.write((Json.write(response) + "\n").getBytes(StandardCharsets.UTF_8));
      out.flush();
      return 0;
    } catch (IOException | RuntimeException failure) {
      try {
        err.write(("docbridge-java-scanner: " + failure + "\n").getBytes(StandardCharsets.UTF_8));
        err.flush();
      } catch (IOException ignored) {
        // Nothing else can report the failure; the exit status still does.
      }
      return 1;
    }
  }

  /** The {@code --probe} answer: one JSON line, {@code ok: false} without {@code jdk.compiler}. */
  public static String probe() {
    Map<String, Object> result = new LinkedHashMap<>();
    if (Parsing.available()) {
      result.put("ok", Boolean.TRUE);
      result.put("runtime", "jdk");
      result.put("version", System.getProperty("java.version"));
    } else {
      result.put("ok", Boolean.FALSE);
      result.put(
          "reason",
          "the Java runtime at "
              + System.getProperty("java.home")
              + " has no jdk.compiler module (ToolProvider.getSystemJavaCompiler() returned null); a JDK is required");
    }
    return Json.write(result);
  }

  /** Scans a parsed request object; every file is scanned independently, in request order. */
  public static Map<String, Object> scanRequest(Object request) {
    if (!(request instanceof Map<?, ?> object)) {
      throw new IllegalArgumentException("request must be a JSON object");
    }
    Object schemaVersion = object.get("schemaVersion");
    if (!(schemaVersion instanceof Number version) || version.longValue() != 1) {
      throw new IllegalArgumentException("unsupported schemaVersion: " + schemaVersion);
    }
    if (!(object.get("files") instanceof List<?> files)) {
      throw new IllegalArgumentException("request.files must be an array");
    }
    List<String> visibility = null;
    if (object.get("options") instanceof Map<?, ?> options
        && options.get("visibility") instanceof List<?> classes) {
      visibility = new ArrayList<>();
      for (Object item : classes) {
        visibility.add(String.valueOf(item));
      }
    }
    List<Object> results = new ArrayList<>();
    for (Object file : files) {
      if (!(file instanceof Map<?, ?> entry)
          || !(entry.get("filePath") instanceof String filePath)
          || !(entry.get("content") instanceof String content)) {
        throw new IllegalArgumentException("request.files entries need filePath and content strings");
      }
      results.add(Scanner.scanFile(filePath, content, visibility));
    }
    Map<String, Object> response = new LinkedHashMap<>();
    response.put("schemaVersion", 1L);
    response.put("requestId", object.get("requestId"));
    response.put("language", Scanner.LANGUAGE);
    response.put("files", results);
    return response;
  }
}
