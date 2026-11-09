// Runs compiled workflow code inside a V8 isolate (isolated-vm): a separate JS heap
// with no Node.js at all — no require, process, fetch, fs or env vars. The only way
// out is two references we hand in: a logger and the sdk host call.
import ivm from "isolated-vm";

export type LogLevel = "info" | "warn" | "error";

export type SandboxOptions = {
  /** Output of compileWorkflow(). */
  js: string;
  input: unknown;
  onLog: (level: LogLevel, message: string) => void;
  /** Handles sdk calls: (method, argsJson) → resultJson. */
  callHost: (method: string, argsJson: string) => Promise<string>;
  timeoutMs?: number;
  memoryMb?: number;
};

export type SandboxResult =
  | { status: "succeeded"; output: unknown }
  | { status: "failed" | "timed_out"; error: string };

export const DEFAULT_TIMEOUT_MS = 10_000;
export const DEFAULT_MEMORY_MB = 64;

// Runs inside the isolate. Builds the `sdk` object from the two references, then
// hides them so workflow code can't reach them directly.
const BOOTSTRAP = `(() => {
const __hostRef = globalThis.__host;
const __logRef = globalThis.__log;
delete globalThis.__host;
delete globalThis.__log;
const __fmt = (args) => args.map((a) => {
  if (typeof a === "string") return a;
  try { return JSON.stringify(a); } catch { return String(a); }
}).join(" ");
const __emit = (level) => (...args) => { __logRef.applyIgnored(undefined, [level, __fmt(args)]); };
const __call = (method) => async (...args) =>
  JSON.parse(await __hostRef.apply(undefined, [method, JSON.stringify(args)], { result: { promise: true } }));
globalThis.console = Object.freeze({ log: __emit("info"), info: __emit("info"), warn: __emit("warn"), error: __emit("error") });
globalThis.__sdk = Object.freeze({
  log: (message) => __emit("info")(message),
  mockDirectory: Object.freeze({
    getUser: __call("mockDirectory.getUser"),
    listGroups: __call("mockDirectory.listGroups"),
    addUserToGroup: __call("mockDirectory.addUserToGroup"),
    removeUserFromGroup: __call("mockDirectory.removeUserFromGroup"),
    resetPassword: __call("mockDirectory.resetPassword"),
  }),
});
})();`;

class WallClockTimeout extends Error {}

export async function runInSandbox(opts: SandboxOptions): Promise<SandboxResult> {
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const isolate = new ivm.Isolate({ memoryLimit: opts.memoryMb ?? DEFAULT_MEMORY_MB });
  let timer: NodeJS.Timeout | undefined;

  try {
    const context = await isolate.createContext();
    const jail = context.global;
    await jail.set("globalThis", jail.derefInto());
    await jail.set(
      "__log",
      new ivm.Reference((level: string, message: string) => {
        const lvl: LogLevel = level === "warn" || level === "error" ? level : "info";
        opts.onLog(lvl, String(message));
      }),
    );
    await jail.set(
      "__host",
      new ivm.Reference(async (method: string, argsJson: string) => opts.callHost(String(method), String(argsJson))),
    );

    const execute = async () => {
      await context.eval(BOOTSTRAP, { timeout: timeoutMs });
      // Evaluating the module runs its top-level code (sync, so `timeout` covers it).
      await context.eval(`globalThis.__runFn = ${opts.js};`, { timeout: timeoutMs });
      await context.eval(
        `globalThis.__main = async (inputJson) => {
          const out = await globalThis.__runFn(JSON.parse(inputJson), globalThis.__sdk);
          return JSON.stringify(out === undefined ? null : out);
        };`,
      );
      const main = (await jail.get("__main", { reference: true })) as ivm.Reference<
        (inputJson: string) => Promise<string>
      >;
      // `timeout` here only covers synchronous work; the wall clock below covers awaits.
      const outJson = await main.apply(undefined, [JSON.stringify(opts.input ?? null)], {
        timeout: timeoutMs,
        result: { promise: true },
      });
      return JSON.parse(String(outJson)) as unknown;
    };

    const wallClock = new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new WallClockTimeout()), timeoutMs);
    });

    const output = await Promise.race([execute(), wallClock]);
    return { status: "succeeded", output };
  } catch (err) {
    return classify(err, timeoutMs);
  } finally {
    clearTimeout(timer);
    // Disposing kills anything still running inside (e.g. a never-ending await).
    if (!isolate.isDisposed) isolate.dispose();
  }
}

function classify(err: unknown, timeoutMs: number): SandboxResult {
  const message = err instanceof Error ? err.message : String(err);
  if (err instanceof WallClockTimeout || /timed out/i.test(message)) {
    return { status: "timed_out", error: `Stopped after ${timeoutMs / 1000}s (time limit)` };
  }
  if (/memory limit/i.test(message) || /disposed/i.test(message)) {
    return { status: "failed", error: "Stopped: the workflow used too much memory" };
  }
  const stack = err instanceof Error && err.stack ? err.stack : message;
  return { status: "failed", error: stack.slice(0, 4000) };
}
