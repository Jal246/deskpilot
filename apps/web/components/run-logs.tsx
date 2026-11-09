// A run's log lines. Server-safe (no hooks), used on the run page and in the workflow workbench.
type Log = { at: string; level: "info" | "warn" | "error"; message: string };

export function RunLogs({ logs }: { logs: Log[] }) {
  if (logs.length === 0) return <p className="p-4 text-sm text-zinc-500">No log lines.</p>;
  return (
    <ol className="divide-y divide-zinc-100 font-mono text-xs dark:divide-zinc-900">
      {logs.map((l, i) => (
        <li key={i} className="flex gap-3 px-4 py-1.5">
          <span className="shrink-0 text-zinc-400">{new Date(l.at).toLocaleTimeString()}</span>
          <span className={`min-w-0 break-words ${l.level === "error" ? "text-red-600" : l.level === "warn" ? "text-amber-600" : ""}`}>
            {l.message}
          </span>
        </li>
      ))}
    </ol>
  );
}
