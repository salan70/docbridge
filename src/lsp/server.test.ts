import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

import { abortError, deferred, type Cancelable } from "../shared/cancelable";
import { CODE_FILE, heldTypeScript, stateOf } from "./fixtures";
import { Project, type ProjectState } from "./project";
import { Server, type SendFn } from "./server";

const EXAMPLE_ROOT = resolve(import.meta.dir, "../../examples/typescript");
const ROOT_URI = pathToFileURL(EXAMPLE_ROOT).href;
const CODE_URI = pathToFileURL(resolve(EXAMPLE_ROOT, CODE_FILE)).href;
const DOC_URI = pathToFileURL(resolve(EXAMPLE_ROOT, "docs/auth.md")).href;
const CODE_TEXT = readFileSync(resolve(EXAMPLE_ROOT, CODE_FILE), "utf8");
const DOC_LINES = readFileSync(resolve(EXAMPLE_ROOT, "docs/auth.md"), "utf8").split("\n");
const DOC_HEADING_LINE = DOC_LINES.findIndex((line) => line.includes("Login Spec"));
if (DOC_HEADING_LINE === -1) {
  throw new Error("Expected the Login Spec heading in the TypeScript example");
}
const DOC_HEADING_POSITION = {
  line: DOC_HEADING_LINE,
  character: (DOC_LINES[DOC_HEADING_LINE]?.indexOf("Login Spec") ?? 0) + 2,
};
// `login` name on line 4 (0-based 3), character 23.
const LOGIN_POSITION = { line: 3, character: 23 };
const BROKEN_LINK = "/**\n * @doc docs/auth.md#missing\n */\nexport async function login() {}\n";
const FIXED_LINK = "/**\n * @doc docs/auth.md#login-spec\n */\nexport async function login() {}\n";

type Outgoing = {
  jsonrpc?: string;
  id?: number | string;
  method?: string;
  result?: unknown;
  params?: unknown;
};

type Published = { uri: string; diagnostics: Array<{ code: string }> };

/** Timers the test fires by hand. */
function manualTimers() {
  const pending = new Map<number, () => void>();
  let nextHandle = 0;
  return {
    timers: {
      setTimeout: (callback: () => void) => {
        nextHandle += 1;
        pending.set(nextHandle, callback);
        return nextHandle;
      },
      clearTimeout: (handle: unknown) => {
        pending.delete(handle as number);
      },
    },
    pending: () => pending.size,
    fire: () => {
      const callbacks = [...pending.values()];
      pending.clear();
      for (const callback of callbacks) {
        callback();
      }
    },
  };
}

function harness(makeProject?: (root: string) => Project) {
  const sent: Outgoing[] = [];
  const waiters: Array<{ matches: (message: Outgoing) => boolean; resolve: () => void }> = [];
  const send: SendFn = (message) => {
    const outgoing = message as Outgoing;
    sent.push(outgoing);
    for (const waiter of waiters.filter((candidate) => candidate.matches(outgoing))) {
      waiters.splice(waiters.indexOf(waiter), 1);
      waiter.resolve();
    }
  };
  const clock = manualTimers();
  let exitCode: number | null = null;
  const server = new Server(send, {
    debounceMs: 50,
    timers: clock.timers,
    onExit: (code) => {
      exitCode = code;
    },
    ...(makeProject === undefined ? {} : { makeProject }),
  });
  /** Resolves with the next publish for `uri` sent from now on. */
  const nextPublish = (uri: string): Promise<Published> => {
    const arrival = deferred<void>();
    const from = sent.length;
    waiters.push({
      matches: (message) =>
        message.method === "textDocument/publishDiagnostics" &&
        (message.params as Published).uri === uri,
      resolve: arrival.resolve,
    });
    return arrival.promise.then(() => {
      const message = sent
        .slice(from)
        .findLast((candidate) => candidate.method === "textDocument/publishDiagnostics");
      return message?.params as Published;
    });
  };
  const publishes = () =>
    sent
      .filter((message) => message.method === "textDocument/publishDiagnostics")
      .map((message) => message.params as Published);
  const request = (id: number, method: string, params: unknown): unknown => {
    server.handle({ method, id, params });
    return sent.find((message) => message.id === id)?.result;
  };
  return { server, sent, clock, nextPublish, publishes, request, getExit: () => exitCode };
}

function init(server: Server): void {
  server.handle({ method: "initialize", id: 1, params: { rootUri: ROOT_URI } });
  server.handle({ method: "initialized", params: {} });
}

function open(server: Server, uri: string, text: string): void {
  server.handle({ method: "textDocument/didOpen", params: { textDocument: { uri, text } } });
}

function change(server: Server, uri: string, text: string): void {
  server.handle({
    method: "textDocument/didChange",
    params: { textDocument: { uri }, contentChanges: [{ text }] },
  });
}

/** Initialize against the example and wait until the opened code file's first scan publishes. */
async function initialized(server: Server, nextPublish: (uri: string) => Promise<Published>) {
  init(server);
  const published = nextPublish(CODE_URI);
  open(server, CODE_URI, CODE_TEXT);
  await published;
}

type ScriptedScan = {
  resolve(state: ProjectState): void;
  cancelled: boolean;
};

/**
 * A project whose scans settle only when the test says so. With `honorCancel`
 * false, a cancelled scan keeps running, as a scan that finished just before
 * its cancellation would.
 */
class ScriptedProject extends Project {
  readonly scans: ScriptedScan[] = [];

  constructor(
    root: string,
    private readonly honorCancel = true,
  ) {
    super(root);
  }

  resolveAsync(): Cancelable<ProjectState> {
    const outcome = deferred<ProjectState>();
    const scan: ScriptedScan = { resolve: outcome.resolve, cancelled: false };
    this.scans.push(scan);
    return {
      promise: outcome.promise,
      cancel: () => {
        scan.cancelled = true;
        if (this.honorCancel) {
          outcome.reject(abortError());
        }
      },
    };
  }
}

/**
 * Let settled scans run their continuations. An immediate runs only once the
 * microtask queue is empty, and nothing here waits on a clock or on I/O.
 */
async function settle(): Promise<void> {
  await new Promise<void>((done) => {
    setImmediate(done);
  });
}

describe(Server, () => {
  test("initialize returns the declared capabilities", () => {
    const { server, sent } = harness();
    server.handle({ method: "initialize", id: 1, params: { rootUri: ROOT_URI } });

    expect(sent[0]).toEqual({
      jsonrpc: "2.0",
      id: 1,
      result: {
        capabilities: {
          textDocumentSync: 1,
          hoverProvider: true,
          definitionProvider: true,
          referencesProvider: true,
        },
      },
    });
  });

  test("shutdown responds null and exit reports a clean code", () => {
    const { server, sent, getExit } = harness();
    init(server);
    server.handle({ method: "shutdown", id: 2 });
    server.handle({ method: "exit" });

    expect(sent.find((m) => m.id === 2)?.result).toBeNull();
    expect(getExit()).toBe(0);
  });

  test("didOpen on a file with a link error publishes the diagnostic", async () => {
    const { server, nextPublish } = harness();
    init(server);
    const published = nextPublish(CODE_URI);

    open(server, CODE_URI, BROKEN_LINK);

    const params = await published;
    expect(params.uri).toBe(CODE_URI);
    expect(params.diagnostics.map((d) => d.code)).toContain("doc_anchor_not_found");
  });

  test("a change that fixes the error clears it once the debounce elapses", async () => {
    const { server, clock, nextPublish } = harness();
    init(server);
    const opened = nextPublish(CODE_URI);
    open(server, CODE_URI, BROKEN_LINK);
    await opened;

    const fixed = nextPublish(CODE_URI);
    change(server, CODE_URI, FIXED_LINK);
    clock.fire();

    expect((await fixed).diagnostics).toEqual([]);
  });

  test("hover over a linked symbol returns the doc section", async () => {
    const { server, nextPublish, request } = harness();
    await initialized(server, nextPublish);

    const result = request(5, "textDocument/hover", {
      textDocument: { uri: CODE_URI },
      position: LOGIN_POSITION,
    }) as { contents: { kind: string; value: string } } | null;

    expect(result?.contents.kind).toBe("markdown");
    expect(result?.contents.value).toContain("Login Spec");
  });

  test("definition from a heading returns the code declaration location", async () => {
    const { server, nextPublish, request } = harness();
    await initialized(server, nextPublish);

    const result = request(6, "textDocument/definition", {
      textDocument: { uri: DOC_URI },
      position: DOC_HEADING_POSITION,
    }) as Array<{ uri: string }> | null;

    expect(result?.[0]?.uri).toBe(CODE_URI);
  });

  test("references from a heading returns the linking code symbol", async () => {
    const { server, nextPublish, request } = harness();
    await initialized(server, nextPublish);

    const result = request(7, "textDocument/references", {
      textDocument: { uri: DOC_URI },
      position: DOC_HEADING_POSITION,
      context: { includeDeclaration: false },
    }) as Array<{ uri: string }>;

    expect(result.map((location) => location.uri)).toEqual([CODE_URI]);
  });

  test("read-only requests start no scan", async () => {
    let scans = 0;
    class CountingProject extends Project {
      resolveAsync(): Cancelable<ProjectState> {
        scans += 1;
        return super.resolveAsync();
      }
    }
    const { server, nextPublish, request } = harness((root) => new CountingProject(root));
    await initialized(server, nextPublish);
    const before = scans;

    request(10, "textDocument/hover", {
      textDocument: { uri: CODE_URI },
      position: LOGIN_POSITION,
    });
    request(11, "textDocument/definition", {
      textDocument: { uri: DOC_URI },
      position: DOC_HEADING_POSITION,
    });
    await settle();

    expect(scans).toBe(before);
  });

  test("an unknown request gets a null result", () => {
    const { server, sent } = harness();
    init(server);
    server.handle({ method: "textDocument/documentSymbol", id: 8, params: {} });

    expect(sent.find((m) => m.id === 8)?.result).toBeNull();
  });
});

describe("Server rescan scheduling", () => {
  test("requests before the first scan completes answer as for an empty project", () => {
    const project = new ScriptedProject(EXAMPLE_ROOT);
    const { server, request } = harness(() => project);
    init(server);

    expect(project.scans).toHaveLength(1);
    expect(
      request(2, "textDocument/hover", {
        textDocument: { uri: CODE_URI },
        position: LOGIN_POSITION,
      }),
    ).toBeNull();
    expect(
      request(3, "textDocument/definition", {
        textDocument: { uri: DOC_URI },
        position: DOC_HEADING_POSITION,
      }),
    ).toBeNull();
    expect(
      request(4, "textDocument/references", {
        textDocument: { uri: DOC_URI },
        position: DOC_HEADING_POSITION,
        context: { includeDeclaration: false },
      }),
    ).toEqual([]);
  });

  test("a change rescans only once the debounce window elapses", async () => {
    const project = new ScriptedProject(EXAMPLE_ROOT);
    const { server, clock } = harness(() => project);
    init(server);
    project.scans[0]?.resolve(stateOf(CODE_TEXT, DOC_LINES.join("\n")));
    await settle();

    change(server, CODE_URI, FIXED_LINK);
    await settle();
    expect(project.scans).toHaveLength(1);

    clock.fire();
    expect(project.scans).toHaveLength(2);
  });

  test("changes during a scan cancel it and schedule exactly one follow-up", async () => {
    const project = new ScriptedProject(EXAMPLE_ROOT);
    const { server, clock } = harness(() => project);
    init(server);

    change(server, CODE_URI, "export function a() {}\n");
    change(server, CODE_URI, "export function b() {}\n");
    change(server, CODE_URI, "export function c() {}\n");
    await settle();

    expect(project.scans[0]?.cancelled).toBe(true);
    expect(project.scans).toHaveLength(1);
    expect(clock.pending()).toBe(1);
    clock.fire();
    await settle();
    expect(project.scans).toHaveLength(2);
  });

  test("only one scan runs at a time and a stale result is discarded", async () => {
    const project = new ScriptedProject(EXAMPLE_ROOT, false);
    const { server, publishes } = harness(() => project);
    init(server);

    open(server, CODE_URI, BROKEN_LINK);
    await settle();
    expect(project.scans).toHaveLength(1);
    expect(project.scans[0]?.cancelled).toBe(true);

    project.scans[0]?.resolve(stateOf(CODE_TEXT, DOC_LINES.join("\n")));
    await settle();
    expect(publishes()).toEqual([]);
    expect(project.scans).toHaveLength(2);

    project.scans[1]?.resolve(stateOf(BROKEN_LINK, DOC_LINES.join("\n")));
    await settle();
    expect(publishes().map((published) => published.uri)).toEqual([CODE_URI]);
    expect(publishes()[0]?.diagnostics.map((d) => d.code)).toContain("doc_anchor_not_found");
  });

  test("navigation answers from the last completed scan while a scan runs", async () => {
    const held = heldTypeScript();
    const { server, clock, nextPublish, request } = harness(
      (root) => new Project(root, { adapters: { typescript: held.adapter } }),
    );
    init(server);
    const opened = nextPublish(CODE_URI);
    open(server, CODE_URI, CODE_TEXT);
    await settle();
    held.batches.at(-1)?.release();
    await opened;

    change(server, CODE_URI, BROKEN_LINK);
    clock.fire();
    await settle();
    const running = held.batches.at(-1);
    const hover = request(9, "textDocument/hover", {
      textDocument: { uri: CODE_URI },
      position: LOGIN_POSITION,
    }) as { contents: { value: string } } | null;

    expect(running?.files).toEqual([CODE_FILE]);
    expect(hover?.contents.value).toContain("Login Spec");
    const rescanned = nextPublish(CODE_URI);
    running?.release();
    expect((await rescanned).diagnostics.map((d) => d.code)).toContain("doc_anchor_not_found");
  });

  test("shutdown cancels the running scan and starts or publishes nothing more", async () => {
    const project = new ScriptedProject(EXAMPLE_ROOT, false);
    const { server, clock, publishes } = harness(() => project);
    init(server);
    open(server, CODE_URI, CODE_TEXT);

    server.handle({ method: "shutdown", id: 2 });
    change(server, CODE_URI, BROKEN_LINK);
    clock.fire();
    project.scans[0]?.resolve(stateOf(CODE_TEXT, DOC_LINES.join("\n")));
    await settle();

    expect(project.scans).toHaveLength(1);
    expect(project.scans[0]?.cancelled).toBe(true);
    expect(clock.pending()).toBe(0);
    expect(publishes()).toEqual([]);
  });

  test("a scan that fails unexpectedly is reported and the next change rescans", async () => {
    const errors: unknown[] = [];
    let scans = 0;
    class FailingProject extends Project {
      resolveAsync(): Cancelable<ProjectState> {
        scans += 1;
        return { promise: Promise.reject(new Error("boom")), cancel: () => undefined };
      }
    }
    const sent: Outgoing[] = [];
    const server = new Server((message) => sent.push(message as Outgoing), {
      makeProject: (root) => new FailingProject(root),
      onScanError: (error) => errors.push(error),
    });
    init(server);
    await settle();

    open(server, CODE_URI, CODE_TEXT);
    await settle();

    expect(errors.map(String)).toEqual(["Error: boom", "Error: boom"]);
    expect(scans).toBe(2);
    expect(sent.filter((message) => message.method === "textDocument/publishDiagnostics")).toEqual(
      [],
    );
  });
});
