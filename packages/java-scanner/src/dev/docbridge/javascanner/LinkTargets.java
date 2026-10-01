package dev.docbridge.javascanner;

/**
 * Mirrors the other workers' target validation: a project-root-relative
 * {@code file#fragment} that is not the source file itself.
 */
public final class LinkTargets {
  private LinkTargets() {}

  public static boolean isValid(String target, String sourceFilePath) {
    int hash = target.indexOf('#');
    if (hash < 0) {
      return false;
    }
    String filePath = target.substring(0, hash);
    String fragment = target.substring(hash + 1);
    if (filePath.isEmpty() || fragment.isEmpty()) {
      return false;
    }
    if (filePath.startsWith("/") || filePath.startsWith("./") || filePath.startsWith("../")) {
      return false;
    }
    if (filePath.contains("\\") || containsAny(filePath, " \t\r\n") || containsAny(fragment, " \t\r\n")) {
      return false;
    }
    for (String segment : filePath.split("/", -1)) {
      if (segment.equals("..")) {
        return false;
      }
    }
    return !filePath.equals(sourceFilePath);
  }

  private static boolean containsAny(String text, String characters) {
    for (int i = 0; i < characters.length(); i++) {
      if (text.indexOf(characters.charAt(i)) >= 0) {
        return true;
      }
    }
    return false;
  }
}
