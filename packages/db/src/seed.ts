// Fills an empty database with demo data. Safe to re-run: it wipes demo tables first.
import { eq } from "drizzle-orm";
import { closeDb, db } from "./client";
import {
  kbArticles,
  organizations,
  ticketMessages,
  tickets,
  users,
  workflowRuns,
  workflows,
  workflowVersions,
} from "./schema";

const SAMPLE_CODE = `export default async function run(input: { email: string; group: string }, sdk: Sdk) {
  sdk.log(\`Adding \${input.email} to \${input.group}\`);
  await sdk.mockDirectory.addUserToGroup(input.email, input.group);
  return { ok: true, message: \`\${input.email} added to \${input.group}\` };
}
`;

const RESET_PASSWORD_CODE = `export default async function run(input: { email: string }, sdk: Sdk) {
  const user = await sdk.mockDirectory.getUser(input.email);
  if (!user) throw new Error(\`No directory user with email \${input.email}\`);
  const { temporaryPassword } = await sdk.mockDirectory.resetPassword(input.email);
  sdk.log(\`Password reset for \${user.name}\${user.locked ? " (account was locked, now unlocked)" : ""}\`);
  return { ok: true, temporaryPassword, message: "Sign in with the temporary password, then pick a new one." };
}
`;

async function main() {
  console.log("Clearing old data…");
  await db.transaction(async (tx) => {
    await tx.delete(workflowRuns);
    await tx.update(workflows).set({ currentVersionId: null });
    await tx.delete(workflowVersions);
    await tx.delete(workflows);
    await tx.delete(ticketMessages);
    await tx.delete(tickets);
    await tx.delete(kbArticles);
    await tx.delete(users);
    await tx.delete(organizations);

    console.log("Seeding…");
    const [org] = await tx.insert(organizations).values({ name: "Acme Inc." }).returning();

    const [admin, employee] = await tx
      .insert(users)
      .values([
        { orgId: org.id, email: "admin@acme.test", name: "Ada Admin", role: "admin" },
        { orgId: org.id, email: "employee@acme.test", name: "Eli Employee", role: "employee" },
      ])
      .returning();

    await tx.insert(kbArticles).values([
      {
        orgId: org.id,
        title: "How to connect to the office Wi-Fi",
        body: "Choose the network **Acme-Corp**, sign in with your work email and password. Guests use **Acme-Guest**; the password is on the front desk.",
      },
      {
        orgId: org.id,
        title: "Setting up the VPN",
        body: "Install the VPN client from the Self Service app, open it, and sign in with your work account. Turn it on whenever you work outside the office.",
      },
      {
        orgId: org.id,
        title: "Requesting new hardware",
        body: "Ask the help desk for a new laptop, monitor or accessory. Describe what you need and why; IT will open a ticket and follow up within 2 business days.",
      },
    ]);

    const [wf] = await tx
      .insert(workflows)
      .values({
        orgId: org.id,
        name: "Add user to group",
        slug: "add-user-to-group",
        description: "Adds an employee to a directory group (e.g. 'design', 'vpn-users').",
        status: "published",
      })
      .returning();

    const [v1] = await tx
      .insert(workflowVersions)
      .values({
        workflowId: wf.id,
        versionNumber: 1,
        code: SAMPLE_CODE,
        inputSchema: {
          type: "object",
          properties: {
            email: { type: "string", format: "email", description: "The user's work email" },
            group: { type: "string", description: "Group name" },
          },
          required: ["email", "group"],
          additionalProperties: false,
        },
        prompt: "Add a user to a group",
        createdBy: admin.id,
      })
      .returning();

    await tx.update(workflows).set({ currentVersionId: v1.id }).where(eq(workflows.id, wf.id));

    // A draft: admins can test it, but the help desk must not run it until it's published.
    const [resetWf] = await tx
      .insert(workflows)
      .values({
        orgId: org.id,
        name: "Reset password",
        slug: "reset-password",
        description: "Unlocks an account and sets a temporary password.",
        status: "draft",
      })
      .returning();
    await tx.insert(workflowVersions).values({
      workflowId: resetWf.id,
      versionNumber: 1,
      code: RESET_PASSWORD_CODE,
      inputSchema: {
        type: "object",
        properties: { email: { type: "string", format: "email", description: "The user's work email" } },
        required: ["email"],
        additionalProperties: false,
      },
      prompt: "Reset a user's password",
      createdBy: admin.id,
    });

    const [ticket] = await tx
      .insert(tickets)
      .values({
        orgId: org.id,
        title: "Monitor flickers",
        description: "My second monitor keeps flickering since this morning.",
        requesterId: employee.id,
        source: "web",
      })
      .returning();

    await tx.insert(ticketMessages).values({
      ticketId: ticket.id,
      authorId: employee.id,
      authorKind: "user",
      body: "My second monitor keeps flickering since this morning.",
    });
  });

  console.log("Done: 1 org, 2 users, 3 KB articles, 1 published + 1 draft workflow, 1 ticket.");
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => closeDb());
