// Every template the mock builder can hand out must pass the save check and really run.
import { beforeEach, describe, expect, it } from "vitest";
import { callHost, MockDirectoryStore } from "@deskpilot/sdk";
import { MockProvider, TEMPLATES } from "@deskpilot/llm";
import { ajv } from "./ajv";
import { checkWorkflow } from "./check-workflow";
import { compileWorkflow } from "./compile";
import { runInSandbox } from "./sandbox";

const directory = new MockDirectoryStore();
beforeEach(() => directory.reset());

const SAMPLE_INPUTS: Record<string, unknown> = {
  "reset-password": { email: "employee@acme.test" },
  "remove-from-group": { email: "dana@acme.test", group: "design" },
  "onboard-user": { email: "employee@acme.test", groups: ["engineering", "nope"] },
  "add-to-group": { email: "employee@acme.test", group: "design" },
  "list-groups": {},
  "lookup-user": { email: "admin@acme.test" },
};

async function runTemplate(code: string, input: unknown) {
  return runInSandbox({
    js: compileWorkflow(code),
    input,
    onLog: () => {},
    callHost: (method, args) => callHost({ directory }, method, args),
    timeoutMs: 2_000,
  });
}

describe("mock builder templates", () => {
  it("has sample inputs for every template", () => {
    expect(Object.keys(SAMPLE_INPUTS).sort()).toEqual(TEMPLATES.map((t) => t.id).sort());
  });

  it.each(TEMPLATES.map((t) => [t.id, t] as const))("%s passes the check and runs", async (id, template) => {
    const wf = template.build();
    expect(checkWorkflow(wf.code, wf.inputSchema)).toEqual({ ok: true });
    expect(ajv.validate(wf.inputSchema, SAMPLE_INPUTS[id])).toBe(true);
    const result = await runTemplate(wf.code, SAMPLE_INPUTS[id]);
    expect(result.status).toBe("succeeded");
  });

  it("the starter template (no match) also passes and runs", async () => {
    const wf = await new MockProvider().generateWorkflow({ prompt: "order pizza */ for the team" });
    expect(checkWorkflow(wf.code, wf.inputSchema)).toEqual({ ok: true });
    expect((await runTemplate(wf.code, { email: "admin@acme.test" })).status).toBe("succeeded");
  });

  it("onboarding really changes the directory", async () => {
    const wf = TEMPLATES.find((t) => t.id === "onboard-user")!.build();
    const result = await runTemplate(wf.code, SAMPLE_INPUTS["onboard-user"]);
    expect(result).toMatchObject({ status: "succeeded", output: { added: ["engineering"], skipped: ["nope"] } });
    expect(directory.getUser("employee@acme.test")?.groups).toContain("engineering");
  });
});

describe("checkWorkflow", () => {
  const schema = { type: "object", properties: {} };

  it("reports imports and a missing default export", () => {
    const r = checkWorkflow(`import fs from "fs";\nfunction run() {}`, schema);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.codeProblems.join("\n")).toMatch(/imports are not allowed/);
      expect(r.codeProblems.join("\n")).toMatch(/export default/);
    }
  });

  it("reports schema problems", () => {
    const ok = `export default async () => ({})`;
    expect(checkWorkflow(ok, [])).toMatchObject({ ok: false, schemaProblems: ["Input schema must be a JSON object"] });
    expect(checkWorkflow(ok, { type: "string" })).toMatchObject({ ok: false });
    expect(checkWorkflow(ok, { type: "object", properties: { a: { type: 5 } } })).toMatchObject({ ok: false });
    expect(checkWorkflow(ok, { type: "object", required: ["a"], properties: { a: { type: "string" } } })).toEqual({ ok: true });
  });
});
