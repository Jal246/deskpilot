// A pretend company directory, kept in memory. Stands in for Okta / Google Workspace
// in Milestone 1 so workflows have real, visible effects without any real accounts.
import { randomBytes } from "node:crypto";
import type { DirectoryUser } from "../types";

type StoredUser = { email: string; name: string; groups: Set<string>; locked: boolean };

const SEED_GROUPS = ["all-staff", "engineering", "design", "vpn-users", "finance"];
const SEED_USERS: Array<{ email: string; name: string; groups: string[]; locked?: boolean }> = [
  { email: "admin@acme.test", name: "Ada Admin", groups: ["all-staff", "engineering", "vpn-users"] },
  { email: "employee@acme.test", name: "Eli Employee", groups: ["all-staff"], locked: true },
  { email: "dana@acme.test", name: "Dana Designer", groups: ["all-staff", "design"] },
];

export class MockDirectoryStore {
  private users = new Map<string, StoredUser>();
  private groups = new Set<string>();

  constructor() {
    this.reset();
  }

  /** Back to the starting data (used by tests and the worker's /directory/reset). */
  reset() {
    this.groups = new Set(SEED_GROUPS);
    this.users = new Map(
      SEED_USERS.map((u) => [u.email, { ...u, groups: new Set(u.groups), locked: u.locked ?? false }]),
    );
  }

  getUser(email: string): DirectoryUser | null {
    const u = this.users.get(normalize(email));
    return u ? toPublic(u) : null;
  }

  listUsers(): DirectoryUser[] {
    return [...this.users.values()].map(toPublic);
  }

  listGroups(): string[] {
    return [...this.groups].sort();
  }

  addUserToGroup(email: string, group: string) {
    this.requireGroup(group);
    this.requireUser(email).groups.add(group);
  }

  removeUserFromGroup(email: string, group: string) {
    this.requireGroup(group);
    this.requireUser(email).groups.delete(group);
  }

  resetPassword(email: string): { temporaryPassword: string } {
    const user = this.requireUser(email);
    user.locked = false;
    return { temporaryPassword: `Tmp-${randomBytes(6).toString("base64url")}` };
  }

  private requireUser(email: string): StoredUser {
    const u = this.users.get(normalize(email));
    if (!u) throw new Error(`No directory user with email "${email}"`);
    return u;
  }

  private requireGroup(group: string) {
    if (!this.groups.has(group)) {
      throw new Error(`No group named "${group}". Groups: ${this.listGroups().join(", ")}`);
    }
  }
}

function normalize(email: string) {
  return email.trim().toLowerCase();
}

function toPublic(u: StoredUser): DirectoryUser {
  return { email: u.email, name: u.name, groups: [...u.groups].sort(), locked: u.locked };
}
