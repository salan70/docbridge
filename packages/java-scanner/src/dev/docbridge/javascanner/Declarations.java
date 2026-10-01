package dev.docbridge.javascanner;

import com.sun.source.tree.AnnotatedTypeTree;
import com.sun.source.tree.AnnotationTree;
import com.sun.source.tree.ArrayTypeTree;
import com.sun.source.tree.BlockTree;
import com.sun.source.tree.ClassTree;
import com.sun.source.tree.CompilationUnitTree;
import com.sun.source.tree.ImportTree;
import com.sun.source.tree.MethodTree;
import com.sun.source.tree.ModifiersTree;
import com.sun.source.tree.Tree;
import com.sun.source.tree.VariableTree;
import com.sun.source.util.TreePath;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.HashSet;
import java.util.List;
import java.util.Set;
import javax.lang.model.element.Modifier;

/**
 * Collects the supported declarations of one parsed file in source order:
 * every {@code ClassTree} (class, interface, enum, record, annotation type)
 * at top level and as a member type, methods and constructors, fields and
 * enum constants. Local and anonymous classes, initializer blocks, lambdas,
 * and everything inside method bodies are never walked.
 *
 * <p>An annotated Javadoc that javac attaches to nothing walkable, or to a
 * package declaration, an import, an initializer block, or nothing at all
 * (dangling at the file end), becomes an unsupported entry so the annotation
 * is reported rather than dropped.
 */
public final class Declarations {
  /** Visibility classes in rank order: a lower index is more visible. */
  public static final List<String> VISIBILITY = List.of("public", "protected", "package", "private");

  /**
   * One declaration or unsupported annotation site. {@code sortKey} orders
   * entries by where they start in the source, Javadoc included.
   */
  public record Declaration(
      String symbolName,
      String canonicalId,
      int visibilityRank,
      boolean unsupported,
      int nameStart,
      int nameEnd,
      int declStart,
      int declEnd,
      int sigStart,
      int sigEnd,
      List<DocComments.Target> targets,
      int sortKey) {
    public String visibility() {
      return VISIBILITY.get(visibilityRank);
    }
  }

  private final Parsing.Parsed parsed;
  private final DocComments comments;
  private final String content;
  private final List<Declaration> declarations = new ArrayList<>();
  private final Set<Integer> consumedJavadocs = new HashSet<>();
  private final List<BlockTree> initializers = new ArrayList<>();
  private final NameLocator names;

  private Declarations(Parsing.Parsed parsed, DocComments comments) {
    this.parsed = parsed;
    this.comments = comments;
    this.content = comments.content();
    this.names = new NameLocator(comments);
  }

  public static List<Declaration> collect(Parsing.Parsed parsed, DocComments comments) {
    Declarations collector = new Declarations(parsed, comments);
    CompilationUnitTree unit = parsed.unit();
    TreePath unitPath = new TreePath(unit);
    for (Tree type : unit.getTypeDecls()) {
      if (type instanceof ClassTree classTree) {
        collector.visitClass(new TreePath(unitPath, classTree), "", 0, false);
      }
    }
    collector.reportUnassociatedJavadocs();
    collector.declarations.sort(Comparator.comparingInt(Declaration::sortKey));
    return collector.declarations;
  }

  private void visitClass(TreePath path, String qualifier, int enclosingRank, boolean implicitlyPublic) {
    ClassTree type = (ClassTree) path.getLeaf();
    String name = type.getSimpleName().toString();
    if (name.isEmpty()) {
      return;
    }
    boolean interfaceLike =
        type.getKind() == Tree.Kind.INTERFACE || type.getKind() == Tree.Kind.ANNOTATION_TYPE;
    int treeStart = parsed.start(type);
    int rank = Math.max(enclosingRank, ownRank(type.getModifiers(), implicitlyPublic));
    int modifiersEnd = end(type.getModifiers());
    NameLocator.Span nameSpan =
        names.locate(modifiersEnd >= 0 ? modifiersEnd : treeStart, name, null, List.of(), treeStart);
    int headerEnd = Math.max(nameSpan.end(), modifiersEnd);
    for (Tree tree : type.getTypeParameters()) {
      headerEnd = Math.max(headerEnd, parsed.end(tree));
    }
    if (type.getExtendsClause() != null) {
      headerEnd = Math.max(headerEnd, parsed.end(type.getExtendsClause()));
    }
    for (Tree tree : type.getImplementsClause()) {
      headerEnd = Math.max(headerEnd, parsed.end(tree));
    }
    for (Tree tree : type.getPermitsClause()) {
      headerEnd = Math.max(headerEnd, parsed.end(tree));
    }
    if (type.getKind() == Tree.Kind.RECORD) {
      // A record cannot declare instance fields, so its non-static variable
      // members are exactly the components javac lifts from the header.
      for (Tree member : type.getMembers()) {
        if (member instanceof VariableTree variable
            && !variable.getModifiers().getFlags().contains(Modifier.STATIC)) {
          headerEnd = Math.max(headerEnd, parsed.end(variable));
        }
      }
    }
    int brace = content.indexOf('{', comments.significantStartAfter(headerEnd));
    while (brace >= 0 && comments.commentAt(brace) != null) {
      brace = content.indexOf('{', comments.commentAt(brace).end());
    }
    int sigEnd = brace < 0 ? parsed.end(type) : comments.significantEndBefore(brace, false);
    String id = qualifier + name;
    add(path, name, id, rank, nameSpan, treeStart, parsed.end(type), sigEnd);

    List<? extends Tree> members = type.getMembers();
    for (int i = 0; i < members.size(); i++) {
      Tree member = members.get(i);
      if (member instanceof ClassTree nested) {
        visitClass(new TreePath(path, nested), id + ".", rank, interfaceLike);
      } else if (member instanceof MethodTree method) {
        visitMethod(new TreePath(path, method), name, id, rank, interfaceLike, type.getKind() == Tree.Kind.ENUM);
      } else if (member instanceof VariableTree variable) {
        int groupEnd = i + 1;
        while (groupEnd < members.size()
            && members.get(groupEnd) instanceof VariableTree next
            && elementType(next.getType()) == elementType(variable.getType())) {
          groupEnd++;
        }
        visitFieldGroup(path, members.subList(i, groupEnd), id, rank, interfaceLike);
        i = groupEnd - 1;
      } else if (member instanceof BlockTree block) {
        initializers.add(block);
      }
    }
  }

  private void visitMethod(
      TreePath path, String ownerName, String ownerId, int ownerRank, boolean interfaceLike, boolean inEnum) {
    MethodTree method = (MethodTree) path.getLeaf();
    boolean constructor = method.getName().contentEquals("<init>");
    String name = constructor ? ownerName : method.getName().toString();
    int treeStart = parsed.start(method);
    // An enum constructor is implicitly private (JLS 8.9.2); javac's parse
    // tree does not carry that flag.
    int ownVisibility = constructor && inEnum ? VISIBILITY.indexOf("private") : ownRank(method.getModifiers(), interfaceLike);
    int rank = Math.max(ownerRank, ownVisibility);
    int scanFrom = treeStart;
    int modifiersEnd = end(method.getModifiers());
    if (modifiersEnd >= 0) {
      scanFrom = modifiersEnd;
    }
    for (Tree tree : method.getTypeParameters()) {
      scanFrom = Math.max(scanFrom, parsed.end(tree));
    }
    List<NameLocator.Span> skipped =
        method.getReturnType() == null ? List.of() : typeSpans(method.getReturnType());
    NameLocator.Span nameSpan = names.locate(scanFrom, name, "({", skipped, treeStart);
    int treeEnd = parsed.end(method);
    int sigEnd =
        method.getBody() == null ? treeEnd : comments.significantEndBefore(parsed.start(method.getBody()), false);
    String id = ownerId + "." + name + Signatures.parameterList(method);
    add(path, name, id, rank, nameSpan, treeStart, treeEnd, sigEnd);
  }

  /**
   * Fields declared together ({@code int a, b;}) share one element type tree
   * and one Javadoc. Every name is a symbol, but an annotation on the group is
   * unsupported at the first name because it cannot say which name it
   * documents, as the Go worker reports a multi-name spec.
   */
  private void visitFieldGroup(
      TreePath ownerPath, List<? extends Tree> group, String ownerId, int ownerRank, boolean interfaceLike) {
    VariableTree first = (VariableTree) group.get(0);
    TreePath firstPath = new TreePath(ownerPath, first);
    int groupStart = parsed.start(first);
    DocComments.Comment javadoc = parsed.hasDocComment(firstPath) ? comments.javadocBefore(groupStart) : null;
    List<DocComments.Target> targets = javadoc == null ? List.of() : comments.targets(javadoc);
    if (javadoc != null) {
      consumedJavadocs.add(javadoc.start());
    }
    int declStart = javadoc == null ? groupStart : javadoc.start();
    int previousEnd = -1;
    boolean multiple = group.size() > 1;
    for (Tree tree : group) {
      VariableTree variable = (VariableTree) tree;
      String name = variable.getName().toString();
      int rank = Math.max(ownerRank, ownRank(variable.getModifiers(), interfaceLike || isEnumConstant(variable)));
      int treeStart = parsed.start(variable);
      int scanFrom = previousEnd;
      if (scanFrom < 0) {
        int modifiersEnd = end(variable.getModifiers());
        scanFrom = modifiersEnd >= 0 ? modifiersEnd : treeStart;
      }
      List<NameLocator.Span> skipped = variable.getType() == null ? List.of() : typeSpans(variable.getType());
      NameLocator.Span nameSpan = names.locate(scanFrom, name, null, skipped, treeStart);
      int nameStart = nameSpan.start();
      int nameEnd = nameSpan.end();
      int treeEnd = parsed.end(variable);
      previousEnd = treeEnd;
      if (multiple && !targets.isEmpty() && tree == first) {
        declarations.add(
            new Declaration(name, "", rank, true, nameStart, nameEnd, declStart, treeEnd, declStart, treeEnd, targets, declStart));
      }
      declarations.add(
          new Declaration(
              name,
              ownerId + "." + name,
              rank,
              false,
              nameStart,
              nameEnd,
              declStart,
              treeEnd,
              declStart,
              treeEnd,
              multiple ? List.of() : targets,
              declStart));
    }
  }

  /**
   * The type that a declaration's array dimensions and type annotations wrap.
   * javac gives each name of {@code int a[], b;} its own array type tree but
   * one shared element type tree.
   */
  private static Tree elementType(Tree type) {
    Tree current = type;
    while (true) {
      if (current instanceof ArrayTypeTree array) {
        current = array.getType();
      } else if (current instanceof AnnotatedTypeTree annotated) {
        current = annotated.getUnderlyingType();
      } else {
        return current;
      }
    }
  }

  /**
   * The spans of a type's element type and type annotations: the trees in a
   * declaration header that can spell the declared name, as {@code Foo Foo;}
   * does. The array dimensions are left out, because javac's array type tree
   * also covers dimensions written after the name, as in {@code int xs[]},
   * {@code int[] ys[]}, and {@code int legacy()[]}.
   */
  private List<NameLocator.Span> typeSpans(Tree type) {
    List<NameLocator.Span> spans = new ArrayList<>();
    Tree current = type;
    while (current instanceof ArrayTypeTree || current instanceof AnnotatedTypeTree) {
      if (current instanceof AnnotatedTypeTree annotated) {
        for (AnnotationTree annotation : annotated.getAnnotations()) {
          addSpan(spans, annotation);
        }
        current = annotated.getUnderlyingType();
      } else {
        current = ((ArrayTypeTree) current).getType();
      }
    }
    addSpan(spans, current);
    return spans;
  }

  private void addSpan(List<NameLocator.Span> spans, Tree tree) {
    int start = parsed.start(tree);
    int end = parsed.end(tree);
    if (start >= 0 && end > start) {
      spans.add(new NameLocator.Span(start, end));
    }
  }

  /** javac gives an enum constant's synthetic type tree no end position, which is its only syntactic tell. */
  private boolean isEnumConstant(VariableTree variable) {
    return variable.getType() != null && parsed.end(variable.getType()) < 0;
  }

  private void add(
      TreePath path,
      String name,
      String id,
      int rank,
      NameLocator.Span nameSpan,
      int treeStart,
      int treeEnd,
      int sigEnd) {
    DocComments.Comment javadoc = parsed.hasDocComment(path) ? comments.javadocBefore(treeStart) : null;
    List<DocComments.Target> targets = List.of();
    int declStart = treeStart;
    if (javadoc != null) {
      consumedJavadocs.add(javadoc.start());
      targets = comments.targets(javadoc);
      declStart = javadoc.start();
    }
    declarations.add(
        new Declaration(
            name, id, rank, false, nameSpan.start(), nameSpan.end(), declStart, treeEnd, declStart, sigEnd, targets, declStart));
  }

  private static int ownRank(ModifiersTree modifiers, boolean implicitlyPublic) {
    Set<Modifier> flags = modifiers.getFlags();
    if (flags.contains(Modifier.PUBLIC)) {
      return 0;
    }
    if (flags.contains(Modifier.PROTECTED)) {
      return 1;
    }
    if (flags.contains(Modifier.PRIVATE)) {
      return 3;
    }
    return implicitlyPublic ? 0 : 2;
  }

  /** The end of a modifiers tree, or {@code -1} when it is empty and has no position. */
  private int end(ModifiersTree modifiers) {
    int start = parsed.start(modifiers);
    int end = parsed.end(modifiers);
    return start >= 0 && end > start ? end : -1;
  }

  /**
   * Reports the annotated Javadoc comments no walked declaration consumed:
   * before a package declaration, an import, or an initializer block, or
   * dangling at the end of the file. Any other unattached Javadoc, such as one
   * inside a method body or one superseded by a later Javadoc, is neither a
   * link nor a diagnostic, like a plain comment.
   */
  private void reportUnassociatedJavadocs() {
    CompilationUnitTree unit = parsed.unit();
    for (DocComments.Comment comment : comments.comments()) {
      if (!comment.javadoc() || consumedJavadocs.contains(comment.start())) {
        continue;
      }
      List<DocComments.Target> targets = comments.targets(comment);
      if (targets.isEmpty()) {
        continue;
      }
      int next = comments.significantStartAfter(comment.end());
      if (next >= content.length()) {
        addUnsupported(comment.start(), comment.end(), targets, comment.start());
        continue;
      }
      if (unit.getPackage() != null && parsed.start(unit.getPackage()) == next) {
        Tree packageName = unit.getPackage().getPackageName();
        addUnsupported(parsed.start(packageName), parsed.end(packageName), targets, comment.start());
        continue;
      }
      for (ImportTree importTree : unit.getImports()) {
        if (parsed.start(importTree) == next) {
          Tree imported = importTree.getQualifiedIdentifier();
          addUnsupported(parsed.start(imported), parsed.end(imported), targets, comment.start());
          break;
        }
      }
      for (BlockTree block : initializers) {
        if (parsed.start(block) == next) {
          addUnsupported(next, next + (block.isStatic() ? "static".length() : 1), targets, comment.start());
          break;
        }
      }
    }
  }

  private void addUnsupported(int start, int end, List<DocComments.Target> targets, int sortKey) {
    declarations.add(new Declaration("", "", 0, true, start, end, start, end, start, end, targets, sortKey));
  }
}
