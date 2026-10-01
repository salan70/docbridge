package dev.docbridge.javascanner;

import java.io.IOException;
import java.io.UnsupportedEncodingException;

/**
 * The JAR entry point. This class alone is compiled for Java 8 so that a JVM
 * older than the 17 floor can still load it and answer {@code --probe} with
 * {@code ok: false} instead of dying on an unsupported class version; every
 * other class targets 17 and is only touched after the version check.
 */
public final class Main {
  private static final int MINIMUM_FEATURE_VERSION = 17;

  private Main() {}

  public static void main(String[] args) {
    int feature = featureVersion(System.getProperty("java.specification.version"));
    boolean probe = args.length == 1 && "--probe".equals(args[0]);
    if (feature < MINIMUM_FEATURE_VERSION) {
      String version = System.getProperty("java.version");
      if (probe) {
        writeLine(
            "{\"ok\":false,\"reason\":\"Java "
                + MINIMUM_FEATURE_VERSION
                + " or newer is required; found "
                + escape(version)
                + "\"}");
        System.exit(0);
      }
      System.err.println("docbridge-java-scanner: Java " + MINIMUM_FEATURE_VERSION + " or newer is required; found " + version);
      System.exit(1);
    }
    if (probe) {
      writeLine(Worker.probe());
      System.exit(0);
    }
    if (args.length != 0) {
      System.err.println("usage: java -jar docbridge-java-scanner.jar [--probe] < request.json");
      System.exit(2);
    }
    System.exit(Worker.run(System.in, System.out, System.err));
  }

  /** {@code "1.8"} is 8; {@code "17"} is 17; anything unparsable is 0. */
  static int featureVersion(String specification) {
    if (specification == null) {
      return 0;
    }
    String text = specification.startsWith("1.") ? specification.substring(2) : specification;
    int end = 0;
    while (end < text.length() && Character.isDigit(text.charAt(end))) {
      end++;
    }
    return end == 0 ? 0 : Integer.parseInt(text.substring(0, end));
  }

  /** Writes one UTF-8 line to stdout regardless of the platform encoding. */
  private static void writeLine(String line) {
    try {
      System.out.write((line + "\n").getBytes("UTF-8"));
      System.out.flush();
    } catch (UnsupportedEncodingException impossible) {
      throw new IllegalStateException(impossible);
    } catch (IOException failure) {
      System.exit(1);
    }
  }

  private static String escape(String text) {
    return text == null ? "" : text.replace("\\", "\\\\").replace("\"", "\\\"");
  }
}
