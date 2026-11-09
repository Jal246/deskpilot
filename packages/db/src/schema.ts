import { relations } from "drizzle-orm";
import {
  type AnyPgColumn,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

// ---------- enums ----------
export const userRole = pgEnum("user_role", ["admin", "agent", "employee"]);
export const workflowStatus = pgEnum("workflow_status", ["draft", "published", "archived"]);
export const runTrigger = pgEnum("run_trigger", ["helpdesk", "manual"]);
export const runStatus = pgEnum("run_status", ["running", "succeeded", "failed", "timed_out"]);
export const ticketStatus = pgEnum("ticket_status", ["open", "in_progress", "resolved"]);
export const ticketSource = pgEnum("ticket_source", ["slack", "web"]);
export const authorKind = pgEnum("author_kind", ["user", "agent"]);

// ---------- shared columns ----------
const id = () => uuid("id").primaryKey().defaultRandom();
const timestamps = () => ({
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
});
const orgId = () =>
  uuid("org_id")
    .notNull()
    .references(() => organizations.id, { onDelete: "cascade" });

// ---------- tables ----------
export const organizations = pgTable("organizations", {
  id: id(),
  name: text("name").notNull(),
  ...timestamps(),
});

export const users = pgTable(
  "users",
  {
    id: id(),
    orgId: orgId(),
    email: text("email").notNull(),
    name: text("name").notNull(),
    role: userRole("role").notNull().default("employee"),
    ...timestamps(),
  },
  (t) => [uniqueIndex("users_org_email_idx").on(t.orgId, t.email)],
);

export const workflows = pgTable(
  "workflows",
  {
    id: id(),
    orgId: orgId(),
    name: text("name").notNull(),
    slug: text("slug").notNull(),
    description: text("description").notNull().default(""),
    status: workflowStatus("status").notNull().default("draft"),
    // The ONLY version the help desk may run. Set by "Publish".
    currentVersionId: uuid("current_version_id").references(
      (): AnyPgColumn => workflowVersions.id,
      { onDelete: "set null" },
    ),
    ...timestamps(),
  },
  (t) => [uniqueIndex("workflows_org_slug_idx").on(t.orgId, t.slug)],
);

export const workflowVersions = pgTable(
  "workflow_versions",
  {
    id: id(),
    workflowId: uuid("workflow_id")
      .notNull()
      .references(() => workflows.id, { onDelete: "cascade" }),
    versionNumber: integer("version_number").notNull(),
    code: text("code").notNull(),
    inputSchema: jsonb("input_schema").notNull().$type<Record<string, unknown>>(),
    prompt: text("prompt"),
    createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
    ...timestamps(),
  },
  (t) => [uniqueIndex("workflow_versions_wf_num_idx").on(t.workflowId, t.versionNumber)],
);

export type RunLog = { at: string; level: "info" | "warn" | "error"; message: string };

export const workflowRuns = pgTable(
  "workflow_runs",
  {
    id: id(),
    workflowVersionId: uuid("workflow_version_id")
      .notNull()
      .references(() => workflowVersions.id, { onDelete: "cascade" }),
    triggeredBy: uuid("triggered_by").references(() => users.id, { onDelete: "set null" }),
    trigger: runTrigger("trigger").notNull(),
    inputs: jsonb("inputs").notNull().$type<Record<string, unknown>>(),
    outputs: jsonb("outputs").$type<unknown>(),
    status: runStatus("status").notNull().default("running"),
    error: text("error"),
    logs: jsonb("logs").notNull().$type<RunLog[]>().default([]),
    startedAt: timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
    ...timestamps(),
  },
  (t) => [index("workflow_runs_version_idx").on(t.workflowVersionId)],
);

export const tickets = pgTable(
  "tickets",
  {
    id: id(),
    orgId: orgId(),
    title: text("title").notNull(),
    description: text("description").notNull().default(""),
    status: ticketStatus("status").notNull().default("open"),
    requesterId: uuid("requester_id").references(() => users.id, { onDelete: "set null" }),
    assigneeId: uuid("assignee_id").references(() => users.id, { onDelete: "set null" }),
    source: ticketSource("source").notNull().default("web"),
    ...timestamps(),
  },
  (t) => [index("tickets_org_status_idx").on(t.orgId, t.status)],
);

export const ticketMessages = pgTable("ticket_messages", {
  id: id(),
  ticketId: uuid("ticket_id")
    .notNull()
    .references(() => tickets.id, { onDelete: "cascade" }),
  authorId: uuid("author_id").references(() => users.id, { onDelete: "set null" }),
  authorKind: authorKind("author_kind").notNull(),
  body: text("body").notNull(),
  ...timestamps(),
});

export const kbArticles = pgTable("kb_articles", {
  id: id(),
  orgId: orgId(),
  title: text("title").notNull(),
  body: text("body").notNull(),
  ...timestamps(),
});

// ---------- relations (for db.query.* with `with:`) ----------
export const organizationsRelations = relations(organizations, ({ many }) => ({
  users: many(users),
  workflows: many(workflows),
  tickets: many(tickets),
  kbArticles: many(kbArticles),
}));

export const usersRelations = relations(users, ({ one }) => ({
  org: one(organizations, { fields: [users.orgId], references: [organizations.id] }),
}));

export const workflowsRelations = relations(workflows, ({ one, many }) => ({
  org: one(organizations, { fields: [workflows.orgId], references: [organizations.id] }),
  currentVersion: one(workflowVersions, {
    fields: [workflows.currentVersionId],
    references: [workflowVersions.id],
    relationName: "current_version",
  }),
  versions: many(workflowVersions, { relationName: "versions" }),
}));

export const workflowVersionsRelations = relations(workflowVersions, ({ one, many }) => ({
  workflow: one(workflows, {
    fields: [workflowVersions.workflowId],
    references: [workflows.id],
    relationName: "versions",
  }),
  runs: many(workflowRuns),
}));

export const workflowRunsRelations = relations(workflowRuns, ({ one }) => ({
  version: one(workflowVersions, {
    fields: [workflowRuns.workflowVersionId],
    references: [workflowVersions.id],
  }),
  triggeredByUser: one(users, { fields: [workflowRuns.triggeredBy], references: [users.id] }),
}));

export const ticketsRelations = relations(tickets, ({ one, many }) => ({
  org: one(organizations, { fields: [tickets.orgId], references: [organizations.id] }),
  requester: one(users, { fields: [tickets.requesterId], references: [users.id], relationName: "requester" }),
  assignee: one(users, { fields: [tickets.assigneeId], references: [users.id], relationName: "assignee" }),
  messages: many(ticketMessages),
}));

export const ticketMessagesRelations = relations(ticketMessages, ({ one }) => ({
  ticket: one(tickets, { fields: [ticketMessages.ticketId], references: [tickets.id] }),
  author: one(users, { fields: [ticketMessages.authorId], references: [users.id] }),
}));

export const kbArticlesRelations = relations(kbArticles, ({ one }) => ({
  org: one(organizations, { fields: [kbArticles.orgId], references: [organizations.id] }),
}));
