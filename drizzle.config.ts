import { defineConfig } from 'drizzle-kit'

// Schema and migrations are orchestrator-owned. Sub-agents never run `drizzle-kit generate`.
export default defineConfig({
  dialect: 'postgresql',
  schema: './server/database/schema/index.ts',
  out: './server/database/migrations',
  casing: 'snake_case',
  strict: true,
  verbose: true,
  dbCredentials: {
    url: process.env.DATABASE_URL ?? 'postgres://blinq:blinq@127.0.0.1:55432/blinq',
  },
})
