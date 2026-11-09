import { beforeEach, describe, expect, it } from "vitest";
import { callHost, MockDirectoryStore } from "@deskpilot/sdk";
import { compileWorkflow } from "./compile";
import { MAX_CONCURRENT_RUNS, MAX_OUTPUT_CHARS, runInSandbox, sandboxLoad, type LogLevel } from "./sandbox";

const directory = new MockDirectoryStore();
beforeEach(() => directory.reset());

async function run(code: string, input: unknown = {}, limits: { timeoutMs?: number; memoryMb?: number } = { timeoutMs: 1_000 }) {
  const logs: Array<[LogLevel, string]> = [];
  const result = await runInSandbox({
    js: compileWorkflow(code),
    input,
    onLog: (level, message) => logs.push([level, message]),
    callHost: (method, args) => callHost({ directory }, method, args),
    ...limits,
  });
  return { result, logs };
}

describe("sandbox: normal workflows", () => {
  it("runs the sample workflow and changes the directory", async () => {
    const { result, logs } = await run(
      `export default async function run(input: { email: string; group: string }, sdk: Sdk) {
        sdk.log(\`Adding \${input.email} to \${input.group}\`);
        await sdk.mockDirectory.addUserToGroup(input.email, input.group);
        return { ok: true };
      }`,
      { email: "employee@acme.test", group: "design" },
    );
    expect(result).toEqual({ status: "succeeded", output: { ok: true } });
    expect(logs).toEqual([["info", "Adding employee@acme.test to design"]]);
    expect(directory.getUser("employee@acme.test")?.groups).toContain("design");
  });

  it("passes sdk results back into the sandbox", async () => {
    const { result } = await run(
      `export default async (input: unknown, sdk: Sdk) => {
        const user = await sdk.mockDirectory.getUser("employee@acme.test");
        const { temporaryPassword } = await sdk.mockDirectory.resetPassword("employee@acme.test");
        return { wasLocked: user?.locked, gotPassword: temporaryPassword.startsWith("Tmp-") };
      }`,
    );
    expect(result).toEqual({ status: "succeeded", output: { wasLocked: true, gotPassword: true } });
    expect(directory.getUser("employee@acme.test")?.locked).toBe(false);
  });

  it("captures console.log/warn/error as log lines", async () => {
    const { logs } = await run(
      `export default async () => { console.log("a", { n: 1 }); console.warn("b"); console.error("c"); }`,
    );
    expect(logs).toEqual([
      ["info", 'a {"n":1}'],
      ["warn", "b"],
      ["error", "c"],
    ]);
  });

  it("returns null when the workflow returns nothing", async () => {
    const { result } = await run(`export default async () => {}`);
    expect(result).toEqual({ status: "succeeded", output: null });
  });

  it("reports a thrown error as failed", async () => {
    const { result } = await run(`export default async () => { throw new Error("boom"); }`);
    expect(result.status).toBe("failed");
    expect(result.status !== "succeeded" && result.error).toMatch(/boom/);
  });

  it("reports sdk errors (unknown group) as failed", async () => {
    const { result } = await run(
      `export default async (i: unknown, sdk: Sdk) => sdk.mockDirectory.addUserToGroup("employee@acme.test", "nope")`,
    );
    expect(result.status !== "succeeded" && result.error).toMatch(/No group named "nope"/);
  });
});

describe("sandbox: safety", () => {
  it("stops a synchronous infinite loop (timed_out)", async () => {
    const { result } = await run(`export default async () => { while (true) {} }`);
    expect(result.status).toBe("timed_out");
  });

  it("stops an infinite loop in top-level code (timed_out)", async () => {
    const { result } = await run(`for (;;) {}\nexport default async () => 1;`);
    expect(result.status).toBe("timed_out");
  });

  it("stops a promise that never resolves (wall-clock timed_out)", async () => {
    const { result } = await run(`export default async () => { await new Promise(() => {}); }`, {}, { timeoutMs: 300 });
    expect(result.status).toBe("timed_out");
  });

  it("stops a loop between awaits", async () => {
    const { result } = await run(
      // Keeps going even after the sdk-call cap starts refusing, so only the time limit can stop it.
      `export default async (i: unknown, sdk: Sdk) => { for (;;) { try { await sdk.mockDirectory.listGroups(); } catch {} } }`,
      {},
      { timeoutMs: 500 },
    );
    expect(result.status).toBe("timed_out");
  });

  it("stops a memory bomb (failed) and the worker survives", async () => {
    const { result } = await run(
      `export default async () => { const a: string[] = []; for (;;) a.push("x".repeat(1e6) + a.length); }`,
      {},
      { timeoutMs: 10_000, memoryMb: 16 },
    );
    expect(result.status).not.toBe("succeeded");
    const after = await run(`export default async () => "still alive"`);
    expect(after.result).toEqual({ status: "succeeded", output: "still alive" });
  });

  it("has no Node.js globals and can't see the host references", async () => {
    const names = ["process", "require", "fetch", "Buffer", "setTimeout", "__host", "__log", "__hostRef", "__logRef"];
    const { result } = await run(
      `export default async () => [${names.map((n) => `typeof ${n}`).join(", ")}]`,
    );
    expect(result).toEqual({ status: "succeeded", output: names.map(() => "undefined") });
  });

  it("can't read env vars or the filesystem", async () => {
    const { result } = await run(`export default async () => process.env.WORKER_SECRET`);
    expect(result.status).toBe("failed");
    expect(result.status !== "succeeded" && result.error).toMatch(/process is not defined/);
  });

  it("can't escape through the Function constructor", async () => {
    const { result } = await run(
      `export default async () => { const g = (0, eval)("this"); return [typeof g.process, typeof g.require]; }`,
    );
    expect(result).toEqual({ status: "succeeded", output: ["undefined", "undefined"] });
  });

  it("rejects host calls to methods that aren't on the list", async () => {
    await expect(callHost({ directory }, "fs.readFile", "[]")).rejects.toThrow(/Unknown sdk method/);
    await expect(callHost({ directory }, "mockDirectory.addUserToGroup", "[1, {}]")).rejects.toThrow(/must be/);
  });
});

describe("sandbox: limits (step 8 hardening)", () => {
  it("refuses a result that's too big to store", async () => {
    const { result } = await run(`export default async () => "x".repeat(${MAX_OUTPUT_CHARS + 10})`);
    expect(result.status).toBe("failed");
    expect(result.status !== "succeeded" && result.error).toMatch(/too much data/);
  });

  it("caps the number of sdk calls per run", async () => {
    const { result } = await run(
      `export default async (i: unknown, sdk: Sdk) => { for (let n = 0; n < 10_000; n++) await sdk.mockDirectory.listGroups(); }`,
      {},
      { timeoutMs: 5_000 },
    );
    expect(result.status).toBe("failed");
    expect(result.status !== "succeeded" && result.error).toMatch(/Too many sdk calls/);
  });

  it("fails cleanly on a result that isn't JSON (BigInt)", async () => {
    const { result } = await run(`export default async () => ({ n: BigInt(1) })`);
    expect(result.status).toBe("failed");
  });

  it("survives endless recursion (stack overflow)", async () => {
    const { result } = await run(`const f = (n: number): number => f(n + 1) + 1;
export default async () => f(0);`);
    expect(result.status).toBe("failed");
    const after = await run(`export default async () => "ok"`);
    expect(after.result).toEqual({ status: "succeeded", output: "ok" });
  });

  it("can't change the sdk object", async () => {
    const { result } = await run(
      `export default async (i: unknown, sdk: any) => {
        try { sdk.mockDirectory.resetPassword = () => "hacked"; } catch {}
        try { sdk.extra = 1; } catch {}
        return [Object.isFrozen(sdk), Object.isFrozen(sdk.mockDirectory), sdk.extra === undefined];
      }`,
    );
    expect(result).toEqual({ status: "succeeded", output: [true, true, true] });
  });

  it("rejects oversized sdk arguments on the host side", async () => {
    const { result } = await run(
      `export default async (i: unknown, sdk: Sdk) => sdk.mockDirectory.getUser("a".repeat(100_000))`,
    );
    expect(result.status).toBe("failed");
    expect(result.status !== "succeeded" && result.error).toMatch(/must be a non-empty string/);
  });

  it("runs at most MAX_CONCURRENT_RUNS sandboxes at once; the rest queue", async () => {
    const busy = `export default async () => { const end = Date.now() + 150; while (Date.now() < end) {} return "done"; }`;
    const runs = Array.from({ length: MAX_CONCURRENT_RUNS + 2 }, () => run(busy));
    expect(sandboxLoad()).toEqual({ active: MAX_CONCURRENT_RUNS, waiting: 2 });
    const results = await Promise.all(runs);
    expect(results.every((r) => r.result.status === "succeeded")).toBe(true);
    expect(sandboxLoad()).toEqual({ active: 0, waiting: 0 });
  });
});
