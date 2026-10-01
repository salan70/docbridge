package dev.docbridge.javascanner;

import com.sun.source.tree.AnnotatedTypeTree;
import com.sun.source.tree.ArrayTypeTree;
import com.sun.source.tree.IdentifierTree;
import com.sun.source.tree.MemberSelectTree;
import com.sun.source.tree.MethodTree;
import com.sun.source.tree.ParameterizedTypeTree;
import com.sun.source.tree.PrimitiveTypeTree;
import com.sun.source.tree.Tree;
import com.sun.source.tree.VariableTree;
import java.util.Locale;
import java.util.StringJoiner;

/**
 * Prints the parameter-type part of a method or constructor ID from the
 * syntax tree alone: annotations and type arguments removed, qualified names
 * and type variables as written, arrays and varargs as {@code T[]}, no
 * whitespace and no parameter names.
 */
public final class Signatures {
  private Signatures() {}

  /** {@code (int,String)} for {@code m(int a, String... b)}; {@code ()} for no parameters. */
  public static String parameterList(MethodTree method) {
    StringJoiner joiner = new StringJoiner(",", "(", ")");
    for (VariableTree parameter : method.getParameters()) {
      joiner.add(print(parameter.getType()));
    }
    return joiner.toString();
  }

  /** Prints one type tree; a varargs parameter already carries an array type tree. */
  public static String print(Tree type) {
    if (type instanceof PrimitiveTypeTree primitive) {
      return primitive.getPrimitiveTypeKind().name().toLowerCase(Locale.ROOT);
    }
    if (type instanceof IdentifierTree identifier) {
      return identifier.getName().toString();
    }
    if (type instanceof MemberSelectTree select) {
      return print(select.getExpression()) + "." + select.getIdentifier();
    }
    if (type instanceof ParameterizedTypeTree parameterized) {
      return print(parameterized.getType());
    }
    if (type instanceof AnnotatedTypeTree annotated) {
      return print(annotated.getUnderlyingType());
    }
    if (type instanceof ArrayTypeTree array) {
      return print(array.getType()) + "[]";
    }
    // Only the forms above can appear as a parameter type in syntactically
    // valid Java; anything else is kept verbatim rather than dropped.
    return type.toString().replaceAll("\\s+", "");
  }
}
