/**
 * One-off: enables Row-Level Security on every app table.
 *
 * No policies are created — that's the point. RLS-enabled-with-zero-policies
 * blocks all anon / authenticated access via PostgREST/Realtime, while the
 * `postgres` role Prisma uses bypasses RLS (it's a superuser), so the app
 * keeps working unchanged.
 *
 * Run with: `npx dotenv -e .env.local -- node scripts/enable-rls.mjs`
 */

import { PrismaClient } from "@prisma/client";

const TABLES = [
  "Connection",
  "MetaBusiness",
  "MetaAdAccount",
  "Campaign",
  "AdSet",
  "Ad",
  "InsightsSnapshot",
  "SyncLog",
  "SyncSchedule",
  "AuditLog",
];

const p = new PrismaClient();

try {
  console.log("Enabling RLS on", TABLES.length, "tables…");
  for (const t of TABLES) {
    // Identifier is from a hardcoded allow-list above — safe to interpolate.
    await p.$executeRawUnsafe(
      `ALTER TABLE "${t}" ENABLE ROW LEVEL SECURITY;`,
    );
    console.log(`  ✓ ${t}`);
  }

  // Verify — read pg_class.relrowsecurity to confirm the flag is on.
  // Also count policies (should be 0 for every table).
  const rows = await p.$queryRawUnsafe(`
    SELECT c.relname AS table_name,
           c.relrowsecurity AS rls_enabled,
           (SELECT COUNT(*) FROM pg_policies p
              WHERE p.schemaname = 'public' AND p.tablename = c.relname) AS policies
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = 'public'
       AND c.relname = ANY($1::text[])
     ORDER BY c.relname;
  `, TABLES);

  console.log("\nVerification:");
  console.table(
    rows.map((r) => ({
      table: r.table_name,
      rls_enabled: r.rls_enabled,
      policies: Number(r.policies),
    })),
  );

  const allOn = rows.every((r) => r.rls_enabled === true);
  const noPolicies = rows.every((r) => Number(r.policies) === 0);
  if (allOn && noPolicies) {
    console.log(
      "\n✓ All tables have RLS enabled with 0 policies. anon/authenticated are now blocked.",
    );
  } else {
    console.log(
      "\n⚠ Something is off — check the table above and fix manually in Supabase.",
    );
    process.exit(1);
  }
} catch (err) {
  console.error("Failed:", err);
  process.exit(1);
} finally {
  await p.$disconnect();
}
