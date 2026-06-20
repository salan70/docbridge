import { fileURLToPath } from "node:url";

import { encodeMessage, MessageReader } from "./transport";
import { definition, references, type Locator } from "./navigation";
import { diagnosticsForFile } from "./diagnostics";
import { hover } from "./hover";
import { fromLspPosition, toLspRange } from "./position";
import { Project } from "./project";
import { relativePathToUri, uriToRelativePath } from "./paths";

/** Sends an outgoing JSON-RPC message to the client. */
export type SendFn = (message: unknown) => void;

export type ServerOptions = {
  /** Build the project model for a resolved root (overridable for tests). */
  makeProject?: (root: string) => Project;
  /** Debounce window, in ms, for re-resolving after a document change. */
  debounceMs?: number;
  /** Called on `exit`; defaults to terminating the process. */
  onExit?: (code: number) => void;
};

type JsonRpcMessage = {
  jsonrpc?: string;
  id?: number | string;
  method?: string;
  params?: unknown;
};

const CAPABILITIES = {
  textDocumentSync: 1, // Full
  hoverProvider: true,
  definitionProvider: true,
  referencesProvider: true,
};

/**
 * The DocBridge Language Server: JSON-RPC lifecycle plus the four link-graph
 * features over a whole-project model. Transport-agnostic; `send` delivers
 * outgoing messages and `handle` consumes incoming ones.
 *
 * @doc docs/specs/lsp.md#lifecycle
 */
export class Server {
  private project: Project | null = null;
  private readonly openFiles = new Set<string>();
  private dirty = true;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private shuttingDown = false;

  private readonly makeProject: (root: string) => Project;
  private readonly debounceMs: number;
  private readonly onExit: (code: number) => void;

  constructor(
    private readonly send: SendFn,
    options: ServerOptions = {},
  ) {
    this.makeProject = options.makeProject ?? ((root) => new Project(root));
    this.debounceMs = options.debounceMs ?? 50;
    this.onExit = options.onExit ?? ((code) => process.exit(code));
  }

  /** Dispatch one parsed incoming JSON-RPC message. */
  handle(message: JsonRpcMessage): void {
    switch (message.method) {
      case "initialize":
        this.respond(message.id, { capabilities: CAPABILITIES });
        this.project = this.makeProject(resolveRoot(message.params));
        break;
      case "initialized":
        this.flush();
        break;
      case "shutdown":
        this.shuttingDown = true;
        this.clearTimer();
        this.respond(message.id, null);
        break;
      case "exit":
        this.onExit(this.shuttingDown ? 0 : 1);
        break;
      case "textDocument/didOpen":
        this.onDidOpen(message.params);
        break;
      case "textDocument/didChange":
        this.onDidChange(message.params);
        break;
      case "textDocument/didClose":
        this.onDidClose(message.params);
        break;
      case "textDocument/hover":
        this.respond(message.id, this.onHover(message.params));
        break;
      case "textDocument/definition":
        this.respond(message.id, this.onDefinition(message.params));
        break;
      case "textDocument/references":
        this.respond(message.id, this.onReferences(message.params));
        break;
      default:
        // Unknown requests get a null result; unknown notifications are ignored.
        if (message.id !== undefined) {
          this.respond(message.id, null);
        }
    }
  }

  private onDidOpen(params: unknown): void {
    const doc = textDocument(params);
    const rel = this.relPath(doc?.uri);
    const text = typeof doc?.text === "string" ? doc.text : undefined;
    if (rel === undefined || text === undefined || this.project === null) {
      return;
    }
    this.openFiles.add(rel);
    this.project.setOverlay(rel, text);
    this.dirty = true;
    this.flush();
  }

  private onDidChange(params: unknown): void {
    const record = params as { textDocument?: { uri?: unknown }; contentChanges?: unknown } | null;
    const uri = record?.textDocument?.uri;
    const rel = this.relPath(typeof uri === "string" ? uri : undefined);
    const text = fullChangeText(record?.contentChanges);
    if (rel === undefined || text === undefined || this.project === null) {
      return;
    }
    this.project.setOverlay(rel, text);
    this.scheduleFlush();
  }

  private onDidClose(params: unknown): void {
    const doc = textDocument(params);
    const rel = this.relPath(doc?.uri);
    if (rel === undefined || this.project === null) {
      return;
    }
    this.openFiles.delete(rel);
    this.project.clearOverlay(rel);
    this.dirty = true;
    // Clear diagnostics for the closed document, then refresh the rest.
    this.publish(rel, []);
    this.flush();
  }

  private onHover(params: unknown): unknown {
    const located = this.locate(params);
    if (located === null) {
      return null;
    }
    const result = hover(located.state, located.rel, located.position);
    if (result === null) {
      return null;
    }
    return {
      contents: { kind: "markdown", value: result.value },
      range: toLspRange(result.range),
    };
  }

  private onDefinition(params: unknown): unknown {
    const located = this.locate(params);
    if (located === null) {
      return null;
    }
    const locators = definition(located.state, located.rel, located.position);
    return locators.length > 0
      ? locators.map((locator) => toLocation(located.root, locator))
      : null;
  }

  private onReferences(params: unknown): unknown {
    const located = this.locate(params);
    if (located === null) {
      return null;
    }
    return references(located.state, located.rel, located.position).map((locator) =>
      toLocation(located.root, locator),
    );
  }

  private locate(params: unknown): {
    state: ReturnType<Project["resolve"]>;
    rel: string;
    root: string;
    position: ReturnType<typeof fromLspPosition>;
  } | null {
    const record = params as
      | { textDocument?: { uri?: unknown }; position?: { line?: unknown; character?: unknown } }
      | null;
    const uri = record?.textDocument?.uri;
    const rel = this.relPath(typeof uri === "string" ? uri : undefined);
    const position = record?.position;
    if (
      rel === undefined ||
      this.project === null ||
      typeof position?.line !== "number" ||
      typeof position?.character !== "number"
    ) {
      return null;
    }
    // Ensure the state reflects the latest buffered edits before answering.
    this.flush();
    return {
      state: this.project.state,
      rel,
      root: this.project.root,
      position: fromLspPosition({ line: position.line, character: position.character }),
    };
  }

  private scheduleFlush(): void {
    this.dirty = true;
    this.clearTimer();
    this.timer = setTimeout(() => {
      this.timer = null;
      this.flush();
    }, this.debounceMs);
  }

  /** Re-resolve if needed and publish diagnostics for every open document. */
  private flush(): void {
    this.clearTimer();
    if (this.project === null || !this.dirty) {
      return;
    }
    this.dirty = false;
    const state = this.project.resolve();
    for (const rel of this.openFiles) {
      const content = state.contentByFile.get(rel) ?? "";
      this.publish(rel, diagnosticsForFile(state.diagnostics, rel, content));
    }
  }

  private publish(rel: string, diagnostics: unknown[]): void {
    if (this.project === null) {
      return;
    }
    this.send({
      jsonrpc: "2.0",
      method: "textDocument/publishDiagnostics",
      params: { uri: relativePathToUri(this.project.root, rel), diagnostics },
    });
  }

  private relPath(uri: string | undefined): string | undefined {
    if (uri === undefined || this.project === null) {
      return undefined;
    }
    return uriToRelativePath(this.project.root, uri);
  }

  private respond(id: number | string | undefined, result: unknown): void {
    if (id === undefined) {
      return;
    }
    this.send({ jsonrpc: "2.0", id, result });
  }

  private clearTimer(): void {
    if (this.timer !== null) {
      clearTimeout(this.timer);
      this.timer = null;
    }
  }
}

function resolveRoot(params: unknown): string {
  const record = params as
    | { rootUri?: unknown; rootPath?: unknown; workspaceFolders?: Array<{ uri?: unknown }> }
    | null;

  const folderUri = record?.workspaceFolders?.[0]?.uri;
  if (typeof folderUri === "string") {
    const path = uriToPath(folderUri);
    if (path !== undefined) {
      return path;
    }
  }
  if (typeof record?.rootUri === "string") {
    const path = uriToPath(record.rootUri);
    if (path !== undefined) {
      return path;
    }
  }
  if (typeof record?.rootPath === "string") {
    return record.rootPath;
  }
  return process.cwd();
}

/**
 * Run the Language Server over stdio: frame outgoing messages to stdout and
 * decode incoming messages from stdin. Blocks by keeping stdin open until the
 * client sends `exit`.
 */
export function runLspServer(): void {
  const reader = new MessageReader();
  const server = new Server((message) => {
    process.stdout.write(encodeMessage(message));
  });

  process.stdin.on("data", (chunk: Buffer) => {
    reader.append(chunk);
    for (const message of reader.read()) {
      server.handle(message as JsonRpcMessage);
    }
  });
  process.stdin.resume();
}

function uriToPath(uri: string): string | undefined {
  try {
    return fileURLToPath(uri);
  } catch {
    return undefined;
  }
}

function toLocation(
  root: string,
  locator: Locator,
): { uri: string; range: ReturnType<typeof toLspRange> } {
  return {
    uri: relativePathToUri(root, locator.filePath),
    range: toLspRange(locator.range),
  };
}

function textDocument(
  params: unknown,
): { uri?: string; text?: string } | undefined {
  const record = params as { textDocument?: { uri?: unknown; text?: unknown } } | null;
  const doc = record?.textDocument;
  if (doc === undefined) {
    return undefined;
  }
  const result: { uri?: string; text?: string } = {};
  if (typeof doc.uri === "string") {
    result.uri = doc.uri;
  }
  if (typeof doc.text === "string") {
    result.text = doc.text;
  }
  return result;
}

function fullChangeText(changes: unknown): string | undefined {
  if (!Array.isArray(changes) || changes.length === 0) {
    return undefined;
  }
  const last = changes[changes.length - 1] as { text?: unknown };
  return typeof last.text === "string" ? last.text : undefined;
}
