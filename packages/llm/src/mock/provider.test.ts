import { describe, expect, it } from "vitest";
import { MockProvider, pickTemplate } from "./provider";
import { TEMPLATES } from "./templates";

describe("mock builder: picking a template", () => {
  const cases: Array<[string, string | null]> = [
    ["Reset a user's password", "reset-password"],
    ["Employee is locked out of their account", "reset-password"],
    ["I forgot my password", "reset-password"],
    ["Add someone to the design group", "add-to-group"],
    ["Give a user VPN access", "add-to-group"],
    ["Remove a user from a group", "remove-from-group"],
    ["Revoke finance access", "remove-from-group"],
    ["Onboard a new hire into several groups", "onboard-user"],
    ["List all groups", "list-groups"],
    ["Look up a user's details", "lookup-user"],
    ["Order pizza for the team", null],
    ["", null],
  ];
  it.each(cases)("%s → %s", (prompt, expected) => {
    expect(pickTemplate(prompt)?.id ?? null).toBe(expected);
  });
});

describe("mock builder: output", () => {
  const llm = new MockProvider();

  it("returns code, name and an object schema", async () => {
    const wf = await llm.generateWorkflow({ prompt: "reset password" });
    expect(wf.name).toBe("Reset password");
    expect(wf.code).toContain("export default async function run");
    expect(wf.inputSchema.type).toBe("object");
    expect(wf.notes).toMatch(/reset-password/);
  });

  it("falls back to a starter named after the prompt", async () => {
    const wf = await llm.generateWorkflow({ prompt: "order pizza for the team." });
    expect(wf.name).toBe("Order pizza for the team");
    expect(wf.code).toContain("export default async function run");
    expect(wf.notes).toMatch(/starter/);
  });

  it("templates have unique ids and every required field exists in properties", () => {
    expect(new Set(TEMPLATES.map((t) => t.id)).size).toBe(TEMPLATES.length);
    for (const t of TEMPLATES) {
      const { inputSchema, code } = t.build();
      for (const key of inputSchema.required ?? []) expect(inputSchema.properties).toHaveProperty(key);
      expect(code).not.toMatch(/\bimport\b/);
    }
  });
});
