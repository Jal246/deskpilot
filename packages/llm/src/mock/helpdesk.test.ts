import { describe, expect, it } from "vitest";
import type { ChatMessage, ChatRequest, ToolDef } from "../types";
import { CONFIRM, mockHelpdeskTurn, OFFER_TICKET } from "./helpdesk";

const emailSchema = { type: "object", properties: { email: { type: "string" } }, required: ["email"] };
const groupSchema = {
  type: "object",
  properties: { email: { type: "string" }, group: { type: "string" } },
  required: ["email", "group"],
};
const RESET: ToolDef = { name: "wf_reset_password", description: "Reset password: Unlocks an account and sets a temporary password.", inputSchema: emailSchema };
const ADD: ToolDef = { name: "wf_add_user_to_group", description: "Add user to group: Adds an employee to a directory group.", inputSchema: groupSchema };
const KB: ToolDef = { name: "search_kb", description: "Search help articles", inputSchema: { type: "object" } };
const TICKET: ToolDef = { name: "create_ticket", description: "Open a ticket", inputSchema: { type: "object" } };

const user = { name: "Eli Employee", email: "employee@acme.test" };
const turn = (messages: ChatMessage[], tools: ToolDef[] = [RESET, ADD, KB, TICKET]) =>
  mockHelpdeskTurn({ system: "", user, messages, tools } satisfies ChatRequest);
const u = (content: string): ChatMessage => ({ role: "user", content });
const a = (content: string): ChatMessage => ({ role: "assistant", content });

describe("mock help desk", () => {
  it("offers a published workflow and asks before running it", () => {
    const res = turn([u("I'm locked out of my account")]);
    expect(res.toolCalls).toEqual([]);
    expect(res.text).toContain("Reset password");
    expect(res.text).toContain(user.email);
    expect(res.text.endsWith(CONFIRM)).toBe(true);
  });

  it("runs it after yes, always for the user's own email", () => {
    const first = turn([u("please reset my password")]);
    const res = turn([u("please reset my password"), a(first.text), u("yes please")]);
    expect(res.toolCalls).toEqual([{ id: expect.any(String), name: "wf_reset_password", input: { email: user.email } }]);
  });

  it("does nothing after no", () => {
    const first = turn([u("I forgot my password")]);
    const res = turn([u("I forgot my password"), a(first.text), u("no")]);
    expect(res.toolCalls).toEqual([]);
    expect(res.text).toMatch(/won't change anything/);
  });

  it("fills the group from the message, or asks for it", () => {
    const res = turn([u("Can you add me to the design group?")]);
    expect(res.text).toContain("group: design");
    expect(turn([u("add me to a group")]).text).toMatch(/Which group/);
  });

  it("never offers a workflow that isn't in its tool list (drafts aren't)", () => {
    const res = turn([u("I'm locked out")], [ADD, KB, TICKET]);
    expect(res.toolCalls[0]?.name).toBe("create_ticket");
  });

  it("searches the KB for questions and answers from the top article", () => {
    const q = turn([u("How do I set up the VPN?")]);
    expect(q.toolCalls[0]).toMatchObject({ name: "search_kb", input: { query: "How do I set up the VPN?" } });
    const res = turn([
      u("How do I set up the VPN?"),
      { role: "assistant", content: "", toolCalls: q.toolCalls },
      { role: "tool", toolCallId: q.toolCalls[0].id, name: "search_kb", content: JSON.stringify({ results: [{ title: "Setting up the VPN", body: "Install the client." }] }) },
    ]);
    expect(res.text).toContain("Setting up the VPN");
  });

  it("opens a ticket when the KB has nothing", () => {
    const res = turn([
      u("Why is the printer jammed?"),
      { role: "assistant", content: "", toolCalls: [{ id: "c1", name: "search_kb", input: {} }] },
      { role: "tool", toolCallId: "c1", name: "search_kb", content: JSON.stringify({ results: [] }) },
    ]);
    expect(res.toolCalls[0]).toMatchObject({ name: "create_ticket", input: { title: "Why is the printer jammed?" } });
  });

  it("opens a ticket for anything else", () => {
    const res = turn([u("My monitor is broken")]);
    expect(res.toolCalls[0]).toMatchObject({ name: "create_ticket", input: { title: "My monitor is broken" } });
  });

  it("reports workflow results and offers a ticket on failure", () => {
    const history: ChatMessage[] = [
      u("reset my password"),
      a(`... ${CONFIRM}`),
      u("yes"),
      { role: "assistant", content: "", toolCalls: [{ id: "c1", name: "wf_reset_password", input: {} }] },
    ];
    const ok = turn([...history, { role: "tool", toolCallId: "c1", name: "wf_reset_password", content: JSON.stringify({ ok: true, status: "succeeded", output: { ok: true, temporaryPassword: "Tmp-1", message: "Sign in." } }) }]);
    expect(ok.text).toContain("Tmp-1");
    const bad = turn([...history, { role: "tool", toolCallId: "c1", name: "wf_reset_password", content: JSON.stringify({ ok: true, status: "failed", error: "boom" }) }]);
    expect(bad.text).toContain("boom");
    expect(bad.text.endsWith(OFFER_TICKET)).toBe(true);
    const ticket = turn([...history, { role: "tool", toolCallId: "c1", name: "x", content: "{}" }, a(bad.text), u("yes")]);
    expect(ticket.toolCalls[0]).toMatchObject({ name: "create_ticket", input: { title: "reset my password" } });
  });
});
