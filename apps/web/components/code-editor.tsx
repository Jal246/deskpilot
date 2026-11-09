"use client";

// Monaco (the VS Code editor) in the browser. The editor itself is loaded from the
// jsDelivr CDN by @monaco-editor/react on first use, so it isn't in our JS bundle.
// For TypeScript, the SDK's type declarations are added so `sdk.` autocompletes.
import Editor, { type BeforeMount } from "@monaco-editor/react";
import { useSyncExternalStore } from "react";

type Props = {
  value: string;
  onChange: (value: string) => void;
  language: "typescript" | "json";
  /** Unique per editor on the page, e.g. "workflow.ts". */
  path: string;
  height: number;
  /** Type declarations to add (TypeScript only). */
  extraLib?: string;
};

let sdkLibAdded = false;

export function CodeEditor({ value, onChange, language, path, height, extraLib }: Props) {
  const dark = usePrefersDark();

  const beforeMount: BeforeMount = (monaco) => {
    if (language !== "typescript" || !extraLib || sdkLibAdded) return;
    sdkLibAdded = true;
    const ts = monaco.typescript;
    ts.typescriptDefaults.setCompilerOptions({
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.ESNext,
      allowNonTsExtensions: true,
      noEmit: true,
      strict: true,
    });
    ts.typescriptDefaults.addExtraLib(extraLib, "file:///deskpilot-sdk.d.ts");
  };

  return (
    <div className="overflow-hidden rounded-md border border-zinc-300 dark:border-zinc-700">
      <Editor
        height={height}
        language={language}
        path={path}
        value={value}
        onChange={(v) => onChange(v ?? "")}
        beforeMount={beforeMount}
        theme={dark ? "vs-dark" : "light"}
        loading={<p className="p-4 text-sm text-zinc-500">Loading editor…</p>}
        options={{
          minimap: { enabled: false },
          fontSize: 13,
          scrollBeyondLastLine: false,
          tabSize: 2,
          automaticLayout: true,
          wordWrap: "on",
        }}
      />
    </div>
  );
}

function usePrefersDark(): boolean {
  return useSyncExternalStore(
    (cb) => {
      const mq = window.matchMedia("(prefers-color-scheme: dark)");
      mq.addEventListener("change", cb);
      return () => mq.removeEventListener("change", cb);
    },
    () => window.matchMedia("(prefers-color-scheme: dark)").matches,
    () => false,
  );
}
