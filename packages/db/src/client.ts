import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import pg from "pg";
import * as schema from "./schema";

export type Db = NodePgDatabase<typeof schema>;

// One pool per process, reused across Next.js dev hot-reloads. Created lazily on
// first use, so importing this file (e.g. during `next build`) needs no DATABASE_URL.
const g = globalThis as unknown as { __deskpilotPool?: pg.Pool; __deskpilotDb?: Db };

export function getPool(): pg.Pool {
  if (!g.__deskpilotPool) {
    const url = process.env.DATABASE_URL;
    if (!url) throw new Error("DATABASE_URL is not set (see .env.example)");
    g.__deskpilotPool = new pg.Pool({ connectionString: url, max: 10 });
  }
  return g.__deskpilotPool;
}

function getDb(): Db {
  g.__deskpilotDb ??= drizzle(getPool(), { schema });
  return g.__deskpilotDb;
}

/** The database. Use it like a normal Drizzle instance: `db.select()…`, `db.query.users…`. */
export const db = new Proxy({} as Db, {
  get(_target, prop) {
    const real = getDb();
    const value = Reflect.get(real, prop, real);
    return typeof value === "function" ? value.bind(real) : value;
  },
});

export async function closeDb() {
  await g.__deskpilotPool?.end();
  g.__deskpilotPool = undefined;
  g.__deskpilotDb = undefined;
}
