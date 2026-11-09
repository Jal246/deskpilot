import { describe, expect, it } from "vitest";
import { compileWorkflow, CompileError } from "./compile";

const GOOD = `export default async function run(input: { email: string }, sdk: Sdk) {
  sdk.log("hi " + input.email);
  return { ok: true };
}`;

function problems(code: string): string {
  try {
    compileWorkflow(code);
  } catch (err) {
    expect(err).toBeInstanceOf(CompileError);
    return (err as Error).message;
  }
  throw new Error("expected a CompileError");
}

describe("compileWorkflow", () => {
  it("compiles a normal workflow and strips the types", () => {
    const js = compileWorkflow(GOOD);
    expect(js).toContain("sdk.log");
    expect(js).not.toContain(": Sdk");
  });

  it("accepts `export default` of an arrow function", () => {
    expect(() => compileWorkflow("export default async (input: unknown) => 1;")).not.toThrow();
  });

  it("rejects import statements", () => {
    expect(problems(`import fs from "node:fs";\n${GOOD}`)).toMatch(/line 1:1: imports are not allowed/);
  });

  it("rejects import = require()", () => {
    expect(problems(`import fs = require("fs");\n${GOOD}`)).toMatch(/imports are not allowed/);
  });

  it("rejects dynamic import()", () => {
    expect(problems(`export default async function run() { await import("node:fs"); }`)).toMatch(
      /import\(\) is not allowed/,
    );
  });

  it("rejects re-exports", () => {
    expect(problems(`export * from "x";\n${GOOD}`)).toMatch(/re-exports are not allowed/);
  });

  it("requires a default export", () => {
    expect(problems(`async function run() {}`)).toMatch(/must `export default/);
  });

  it("reports syntax errors with a line number", () => {
    expect(problems(`export default async function run( {`)).toMatch(/line \d+:\d+/);
  });
});
