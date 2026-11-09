// The public API that workflow code can use. Workflow code never imports anything:
// everything it can do comes through the `sdk` argument.
//
// Keep `Sdk` and `SDK_DTS` in sync (a test checks the method names match).
// `SDK_DTS` is what the builder LLM (step 5) and the code editor see.

export type DirectoryUser = {
  email: string;
  name: string;
  groups: string[];
  locked: boolean;
};

export interface MockDirectory {
  /** Look up a user. Returns null if there is no such user. */
  getUser(email: string): Promise<DirectoryUser | null>;
  /** All group names in the directory. */
  listGroups(): Promise<string[]>;
  /** Add a user to a group. Throws if the user or group doesn't exist. */
  addUserToGroup(email: string, group: string): Promise<void>;
  /** Remove a user from a group. Throws if the user or group doesn't exist. */
  removeUserFromGroup(email: string, group: string): Promise<void>;
  /** Unlock the account and set a temporary password the user must change at next sign-in. */
  resetPassword(email: string): Promise<{ temporaryPassword: string }>;
}

export interface Sdk {
  /** Write a line to the run log (shown on the Runs page). `console.log` does the same. */
  log(message: string): void;
  /** A fake company directory (users and groups) for Milestone 1. */
  mockDirectory: MockDirectory;
}

/** Every method workflow code may call on the host, as "namespace.method". */
export const HOST_METHODS = [
  "mockDirectory.getUser",
  "mockDirectory.listGroups",
  "mockDirectory.addUserToGroup",
  "mockDirectory.removeUserFromGroup",
  "mockDirectory.resetPassword",
] as const;
export type HostMethod = (typeof HOST_METHODS)[number];

export const SDK_DTS = `type DirectoryUser = { email: string; name: string; groups: string[]; locked: boolean };

interface MockDirectory {
  /** Look up a user. Returns null if there is no such user. */
  getUser(email: string): Promise<DirectoryUser | null>;
  /** All group names in the directory. */
  listGroups(): Promise<string[]>;
  /** Add a user to a group. Throws if the user or group doesn't exist. */
  addUserToGroup(email: string, group: string): Promise<void>;
  /** Remove a user from a group. Throws if the user or group doesn't exist. */
  removeUserFromGroup(email: string, group: string): Promise<void>;
  /** Unlock the account and set a temporary password the user must change at next sign-in. */
  resetPassword(email: string): Promise<{ temporaryPassword: string }>;
}

interface Sdk {
  /** Write a line to the run log. console.log does the same. */
  log(message: string): void;
  /** A fake company directory (users and groups). */
  mockDirectory: MockDirectory;
}
`;
