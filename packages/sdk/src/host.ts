// The host side of the SDK. Code inside the sandbox can't touch anything directly:
// each sdk call becomes (method name, JSON args) and lands here. This file decides
// which methods exist and checks every argument, because sandbox code is untrusted.
import { HOST_METHODS, type HostMethod } from "./types";
import { MockDirectoryStore } from "./integrations/mock-directory";

export type HostDeps = { directory: MockDirectoryStore };

export class HostCallError extends Error {}

function str(args: unknown[], i: number, name: string): string {
  const v = args[i];
  if (typeof v !== "string" || v.length === 0 || v.length > 320) {
    throw new HostCallError(`${name} must be a non-empty string`);
  }
  return v;
}

const handlers: Record<HostMethod, (deps: HostDeps, args: unknown[]) => unknown> = {
  "mockDirectory.getUser": ({ directory }, a) => directory.getUser(str(a, 0, "email")),
  "mockDirectory.listGroups": ({ directory }) => directory.listGroups(),
  "mockDirectory.addUserToGroup": ({ directory }, a) => {
    directory.addUserToGroup(str(a, 0, "email"), str(a, 1, "group"));
    return null;
  },
  "mockDirectory.removeUserFromGroup": ({ directory }, a) => {
    directory.removeUserFromGroup(str(a, 0, "email"), str(a, 1, "group"));
    return null;
  },
  "mockDirectory.resetPassword": ({ directory }, a) => directory.resetPassword(str(a, 0, "email")),
};

/** Run one sdk call from the sandbox. Args and result are JSON strings. */
export async function callHost(deps: HostDeps, method: string, argsJson: string): Promise<string> {
  if (!(HOST_METHODS as readonly string[]).includes(method)) {
    throw new HostCallError(`Unknown sdk method "${method}"`);
  }
  let args: unknown;
  try {
    args = JSON.parse(argsJson);
  } catch {
    throw new HostCallError("sdk arguments must be JSON");
  }
  if (!Array.isArray(args)) throw new HostCallError("sdk arguments must be a list");
  const result = await handlers[method as HostMethod](deps, args);
  return JSON.stringify(result ?? null);
}
