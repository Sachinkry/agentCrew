import type { Config } from "drizzle-kit";

export default {
  schema: "./src/core/schema.ts",
  out: "./drizzle",
  dialect: "sqlite",
  dbCredentials: {
    url: process.env["DATABASE_URL"] ?? "./runs/autoshelf.sqlite",
  },
} satisfies Config;
