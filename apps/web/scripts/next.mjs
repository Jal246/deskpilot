// Runs the Next.js CLI with the monorepo's root .env loaded.
// Why: Next only reads apps/web/.env* and resets process.env to what it was at startup,
// so the root .env must already be in the environment when Next starts.
// (`node --env-file` can't be used: Next copies Node flags into NODE_OPTIONS, which rejects it.)
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const rootEnv = fileURLToPath(new URL("../../../.env", import.meta.url));
if (existsSync(rootEnv)) process.loadEnvFile(rootEnv);
else console.warn(`[deskpilot] no ${rootEnv}; copy .env.example to .env`);

const nextBin = createRequire(import.meta.url).resolve("next/dist/bin/next");
const child = spawn(process.execPath, [nextBin, ...process.argv.slice(2)], { stdio: "inherit" });

for (const signal of ["SIGINT", "SIGTERM"]) process.on(signal, () => child.kill(signal));
child.on("exit", (code, signal) => process.exit(signal ? 1 : (code ?? 0)));
