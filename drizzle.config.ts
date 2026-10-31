import { defineConfig } from "drizzle-kit";

// db/client.ts bootstraps the tables itself. This config is for drizzle-kit
// once the schema starts changing: `npx drizzle-kit generate` / `migrate`.
export default defineConfig({
  dialect: "sqlite",
  schema: "./db/schema.ts",
  out: "./drizzle",
  dbCredentials: { url: process.env.DATABASE_FILE ?? "game.db" },
});
