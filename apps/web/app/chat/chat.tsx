"use client";

// The employee chat. History lives in the browser (and is re-sent each turn as plain text);
// the worker decides what happens. Tool activity shows as small chips under replies.
import Link from "next/link";
import { Fragment, useEffect, useRef, useState, useTransition, type ReactNode } from "react";
import { Badge, Button, inputClass, type Tone } from "@/components/ui";
import type { ChatEvent } from "@/lib/worker-client";
import { sendChat } from "./actions";

type Message = { role: "user" | "assistant"; content: string; events?: ChatEvent[]; error?: boolean };

const SUGGESTIONS = ["I'm locked out of my account", "How do I set up the VPN?", "Add me to the design group", "My monitor is broken"];

export function Chat({ firstName, isStaff }: { firstName: string; isStaff: boolean }) {
  const [messages, setMessages] = useState<Message[]>([
    { role: "assistant", content: `Hi ${firstName}! I'm the IT help desk. What can I help you with?` },
  ]);
  const [draft, setDraft] = useState("");
  const [pending, startTransition] = useTransition();
  const bottom = useRef<HTMLDivElement>(null);

  // Braces matter: an effect may only return a cleanup function, and newer browsers make
  // scrollIntoView() return a Promise ("destroy is not a function" otherwise).
  useEffect(() => {
    bottom.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [messages, pending]);

  const send = (text: string) => {
    const content = text.trim();
    if (!content || pending) return;
    const next: Message[] = [...messages, { role: "user", content }];
    setMessages(next);
    setDraft("");
    startTransition(async () => {
      // The greeting is UI only, and failed replies aren't real history: don't send them.
      const history = next.slice(1).filter((m) => !m.error).map(({ role, content }) => ({ role, content }));
      const res = await sendChat(history);
      setMessages((m) => [
        ...m,
        res.ok ? { role: "assistant", content: res.reply, events: res.events } : { role: "assistant", content: res.error, error: true },
      ]);
    });
  };

  return (
    <div className="flex flex-1 flex-col gap-4">
      <div className="flex-1 space-y-4" aria-live="polite">
        {messages.map((m, i) => (
          <div key={i} className={`flex ${m.role === "user" ? "justify-end" : "justify-start"}`}>
            <div className="max-w-[85%] space-y-2">
              <div
                className={`rounded-2xl px-4 py-2.5 text-sm leading-relaxed whitespace-pre-wrap ${
                  m.role === "user"
                    ? "bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900"
                    : m.error
                      ? "border border-red-300 text-red-700 dark:border-red-900 dark:text-red-400"
                      : "bg-zinc-100 dark:bg-zinc-900"
                }`}
              >
                <RichText text={m.content} />
              </div>
              {m.events && m.events.length > 0 && (
                <div className="flex flex-wrap gap-1.5">
                  {m.events.map((e, j) => (
                    <EventChip key={j} event={e} isStaff={isStaff} />
                  ))}
                </div>
              )}
            </div>
          </div>
        ))}
        {pending && <div className="text-sm text-zinc-500">Thinking…</div>}
        <div ref={bottom} />
      </div>

      {messages.length === 1 && (
        <div className="flex flex-wrap gap-2">
          {SUGGESTIONS.map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => send(s)}
              className="rounded-full border border-zinc-300 px-3 py-1 text-xs text-zinc-600 hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-400 dark:hover:bg-zinc-900"
            >
              {s}
            </button>
          ))}
        </div>
      )}

      <form
        onSubmit={(e) => {
          e.preventDefault();
          send(draft);
        }}
        className="sticky bottom-0 flex gap-2 bg-background py-3"
      >
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder="Describe your problem…"
          maxLength={4000}
          aria-label="Message"
          className={inputClass}
          autoFocus
        />
        <Button type="submit" disabled={pending || !draft.trim()}>
          Send
        </Button>
      </form>
    </div>
  );
}

/** **bold** only; everything else is plain text (no HTML from the model ever reaches the page). */
function RichText({ text }: { text: string }) {
  const parts = text.split(/\*\*(.+?)\*\*/g);
  return (
    <>
      {parts.map((p, i) => (i % 2 === 1 ? <strong key={i}>{p}</strong> : <Fragment key={i}>{p}</Fragment>))}
    </>
  );
}

const STATUS_TONE: Record<string, Tone> = { succeeded: "green", failed: "red", timed_out: "red", refused: "amber" };

function EventChip({ event, isStaff }: { event: ChatEvent; isStaff: boolean }) {
  let tone: Tone = "gray";
  let label: ReactNode;
  let href: string | undefined;
  if (event.type === "workflow") {
    tone = STATUS_TONE[event.status] ?? "gray";
    label = `Ran “${event.workflowName}” · ${event.status.replace("_", " ")}`;
    if (event.runId) href = `/runs/${event.runId}`;
  } else if (event.type === "kb") {
    tone = "blue";
    label = event.titles.length ? `Searched help articles · ${event.titles.length} found` : "Searched help articles · none found";
  } else {
    tone = "amber";
    label = `Opened ticket: ${event.title}`;
    href = `/tickets/${event.ticketId}`;
  }
  const chip = <Badge tone={tone}>{label}</Badge>;
  // Employees can't open dashboard pages, so only staff get links.
  return isStaff && href ? (
    <Link href={href} className="hover:opacity-80">
      {chip}
    </Link>
  ) : (
    chip
  );
}
