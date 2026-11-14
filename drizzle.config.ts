import { defineConfig } from "drizzle-kit";

const url = process.env.DATABASE_URL;
if (url === undefined || url.trim() === "") {
  throw new Error("Set DATABASE_URL to the database you intend to migrate");
}

export default defineConfig({
  schema: "./src/services/database/schema/index.ts",
  dialect: "postgresql",
  out: "./src/services/database/migrations",
  dbCredentials: { url: url },
});
