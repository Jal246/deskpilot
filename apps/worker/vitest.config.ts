import { existsSync } from "node:fs";
import { defineConfig } from "vitest/config";

// DB tests use the local Postgres from docker compose (pnpm db:up).
if (existsSync("../../.env")) process.loadEnvFile("../../.env");

export default defineConfig({
  test: {
    pool: "forks", // isolated-vm wants a real process, not a worker thread
    execArgv: ["--no-node-snapshot"], // required by isolated-vm on Node 20+
    testTimeout: 20_000,
    fileParallelism: false,
  },
});
