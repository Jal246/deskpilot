// Ready-made workflows the free mock builder picks from. Each one is real, runnable
// code against the sdk (a test runs every template in the sandbox).
import type { GeneratedWorkflow, InputSchema } from "../types";

export type Template = {
  id: string;
  /** Words/phrases in the admin's prompt that point at this template, with weights. */
  keywords: Array<[phrase: string, weight: number]>;
  build(): Omit<GeneratedWorkflow, "notes">;
};

const emailInput = { type: "string", format: "email", description: "The user's work email" };
const objectSchema = (properties: InputSchema["properties"]): InputSchema => ({
  type: "object",
  properties,
  required: Object.keys(properties),
  additionalProperties: false,
});

export const TEMPLATES: Template[] = [
  {
    id: "reset-password",
    keywords: [["password", 3], ["reset", 2], ["locked", 3], ["lock out", 3], ["unlock", 3], ["forgot", 3], ["sign in", 1], ["log in", 1]],
    build: () => ({
      name: "Reset password",
      description: "Unlocks an account and sets a temporary password.",
      inputSchema: objectSchema({ email: emailInput }),
      code: `export default async function run(input: { email: string }, sdk: Sdk) {
  const user = await sdk.mockDirectory.getUser(input.email);
  if (!user) throw new Error(\`No directory user with email \${input.email}\`);

  const { temporaryPassword } = await sdk.mockDirectory.resetPassword(input.email);
  sdk.log(\`Password reset for \${user.name}\${user.locked ? " (account was locked, now unlocked)" : ""}\`);

  return { ok: true, temporaryPassword, message: "Sign in with the temporary password, then pick a new one." };
}
`,
    }),
  },
  {
    id: "remove-from-group",
    keywords: [["remove", 4], ["revoke", 4], ["take away", 4], ["kick", 3], ["leave", 2], ["out of", 2], ["from group", 2]],
    build: () => ({
      name: "Remove user from group",
      description: "Removes an employee from a directory group.",
      inputSchema: objectSchema({ email: emailInput, group: { type: "string", description: "Group name" } }),
      code: `export default async function run(input: { email: string; group: string }, sdk: Sdk) {
  const user = await sdk.mockDirectory.getUser(input.email);
  if (!user) throw new Error(\`No directory user with email \${input.email}\`);
  if (!user.groups.includes(input.group)) {
    sdk.log(\`\${input.email} is not in \${input.group}; nothing to do\`);
    return { ok: true, changed: false, message: \`\${input.email} was not in \${input.group}\` };
  }

  await sdk.mockDirectory.removeUserFromGroup(input.email, input.group);
  sdk.log(\`Removed \${input.email} from \${input.group}\`);
  return { ok: true, changed: true, message: \`\${input.email} removed from \${input.group}\` };
}
`,
    }),
  },
  {
    id: "onboard-user",
    keywords: [["onboard", 5], ["new hire", 5], ["new employee", 4], ["first day", 3], ["starter", 3], ["several groups", 3], ["groups", 1]],
    build: () => ({
      name: "Onboard new hire",
      description: "Adds a new hire to all-staff plus their team's groups, logging each step.",
      inputSchema: objectSchema({
        email: emailInput,
        groups: {
          type: "array",
          items: { type: "string" },
          maxItems: 10,
          description: "Team groups to add, e.g. engineering, vpn-users",
        },
      }),
      code: `export default async function run(input: { email: string; groups: string[] }, sdk: Sdk) {
  const user = await sdk.mockDirectory.getUser(input.email);
  if (!user) throw new Error(\`No directory user with email \${input.email}\`);

  const known = await sdk.mockDirectory.listGroups();
  const wanted = Array.from(new Set(["all-staff", ...input.groups]));
  const added: string[] = [];
  const skipped: string[] = [];

  for (const group of wanted) {
    if (!known.includes(group)) {
      sdk.log(\`Skipping unknown group "\${group}"\`);
      skipped.push(group);
    } else if (user.groups.includes(group)) {
      sdk.log(\`Already in \${group}\`);
    } else {
      await sdk.mockDirectory.addUserToGroup(input.email, group);
      sdk.log(\`Added to \${group}\`);
      added.push(group);
    }
  }

  return { ok: true, added, skipped, message: \`\${user.name} onboarded (\${added.length} group(s) added)\` };
}
`,
    }),
  },
  {
    id: "add-to-group",
    keywords: [["add", 3], ["group", 2], ["join", 3], ["grant", 2], ["access", 2], ["give", 1], ["vpn", 1]],
    build: () => ({
      name: "Add user to group",
      description: "Adds an employee to a directory group (e.g. 'design', 'vpn-users').",
      inputSchema: objectSchema({ email: emailInput, group: { type: "string", description: "Group name" } }),
      code: `export default async function run(input: { email: string; group: string }, sdk: Sdk) {
  const groups = await sdk.mockDirectory.listGroups();
  if (!groups.includes(input.group)) {
    throw new Error(\`Unknown group "\${input.group}". Known groups: \${groups.join(", ")}\`);
  }

  sdk.log(\`Adding \${input.email} to \${input.group}\`);
  await sdk.mockDirectory.addUserToGroup(input.email, input.group);
  return { ok: true, message: \`\${input.email} added to \${input.group}\` };
}
`,
    }),
  },
  {
    id: "list-groups",
    keywords: [["list", 2], ["which groups", 4], ["what groups", 4], ["all groups", 4], ["show groups", 4]],
    build: () => ({
      name: "List groups",
      description: "Lists every group in the directory.",
      inputSchema: objectSchema({}),
      code: `export default async function run(_input: {}, sdk: Sdk) {
  const groups = await sdk.mockDirectory.listGroups();
  sdk.log(\`Found \${groups.length} groups\`);
  return { ok: true, groups };
}
`,
    }),
  },
  {
    id: "lookup-user",
    keywords: [["look up", 4], ["lookup", 4], ["who is", 4], ["find", 2], ["details", 2], ["info", 2], ["check", 2], ["status", 2]],
    build: () => ({
      name: "Look up user",
      description: "Shows a user's name, groups and whether their account is locked.",
      inputSchema: objectSchema({ email: emailInput }),
      code: `export default async function run(input: { email: string }, sdk: Sdk) {
  const user = await sdk.mockDirectory.getUser(input.email);
  if (!user) {
    sdk.log(\`No user \${input.email}\`);
    return { ok: false, message: \`No directory user with email \${input.email}\` };
  }
  sdk.log(\`\${user.name}: \${user.groups.length} groups, \${user.locked ? "locked" : "active"}\`);
  return { ok: true, user };
}
`,
    }),
  },
];

/** Used when no template matches: a small, valid starting point to edit by hand. */
export function starterTemplate(prompt: string): Omit<GeneratedWorkflow, "notes"> {
  const name = titleFrom(prompt);
  return {
    name,
    description: prompt.trim().slice(0, 200),
    inputSchema: objectSchema({ email: emailInput }),
    code: `// Starter for: ${prompt.trim().replace(/\s+/g, " ").slice(0, 120).replace(/\*\//g, "* /")}
// Edit this to do what you need. Everything available is on \`sdk\` (hover it for docs).
export default async function run(input: { email: string }, sdk: Sdk) {
  const user = await sdk.mockDirectory.getUser(input.email);
  if (!user) throw new Error(\`No directory user with email \${input.email}\`);

  sdk.log(\`Working on \${user.name}\`);
  // TODO: your steps here, e.g. await sdk.mockDirectory.addUserToGroup(input.email, "design");

  return { ok: true, message: \`Done for \${user.name}\` };
}
`,
  };
}

function titleFrom(prompt: string): string {
  const words = prompt.trim().replace(/\s+/g, " ").replace(/[.!?]+$/, "").slice(0, 60);
  if (!words) return "New workflow";
  return words.charAt(0).toUpperCase() + words.slice(1);
}
