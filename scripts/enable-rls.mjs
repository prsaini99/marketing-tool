/**
 * Enables Row-Level Security on every app table.
 *
 * No policies are created — that's the point. RLS-enabled-with-zero-policies
 * blocks all anon / authenticated access via PostgREST/Realtime, while the
 * `postgres` role Prisma uses bypasses RLS (it's a superuser), so the app
 * keeps working unchanged.
 *
 * THE TABLE LIST IS READ FROM THE DATABASE, NOT WRITTEN DOWN HERE. It used to
 * be a hardcoded array, which failed in the worst available way: the script
 * enabled RLS on the tables it knew about, then verified only those same
 * tables and printed "All tables have RLS enabled". Every model added after
 * the array was written stayed exposed while the script said otherwise. By
 * the time this was caught, ten tables were unprotected, including chat
 * threads, the RAG embeddings and the demo request table that holds names and
 * email addresses.
 *
 * A check that can only see what it was told about cannot report the thing you
 * are running it to find out.
 *
 * Run with: `npx dotenv -e .env.local -- node scripts/enable-rls.mjs`
 */

import { PrismaClient } from "@prisma/client";

const p = new PrismaClient();

/**
 * Tables that are SUPPOSED to carry policies, so the check below does not
 * cry wolf on them every run.
 *
 * `heartbeats` is the external keep-alive described in schema.prisma: a
 * launchd job outside this repo inserts a row on a schedule using the anon
 * key, so the Supabase project is not paused for inactivity. Its anon
 * INSERT/SELECT policies are what make that work. Stripping them would stop
 * the writer and eventually let the database sleep.
 */
const POLICIES_EXPECTED = new Set(["heartbeats"]);

/**
 * Every ordinary table in `public`, straight from the catalogue.
 *
 * Excludes Prisma's own `_prisma_migrations` bookkeeping table: it is not app
 * data, and the migration engine connects on its own terms.
 */
async function appTables() {
  const rows = await p.$queryRawUnsafe(`
    SELECT c.relname AS name
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = 'public'
       AND c.relkind = 'r'
       AND c.relname NOT LIKE '\\_%'
     ORDER BY c.relname;
  `);
  return rows.map((r) => r.name);
}

try {
  const TABLES = await appTables();
  console.log("Enabling RLS on", TABLES.length, "tables…");
  for (const t of TABLES) {
    // Identifier comes from pg_class, so it is a real table name by
    // construction, and quoting handles the mixed case Prisma generates.
    await p.$executeRawUnsafe(
      `ALTER TABLE "${t}" ENABLE ROW LEVEL SECURITY;`,
    );
    console.log(`  ✓ ${t}`);
  }

  // Verify against the catalogue again rather than against TABLES, so a table
  // created between the two reads still shows up as a failure.
  const rows = await p.$queryRawUnsafe(`
    SELECT c.relname AS table_name,
           c.relrowsecurity AS rls_enabled,
           (SELECT COUNT(*) FROM pg_policies p
              WHERE p.schemaname = 'public' AND p.tablename = c.relname) AS policies
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = 'public'
       AND c.relkind = 'r'
       AND c.relname NOT LIKE '\\_%'
     ORDER BY c.relname;
  `);

  console.log("\nVerification:");
  console.table(
    rows.map((r) => ({
      table: r.table_name,
      rls_enabled: r.rls_enabled,
      policies: Number(r.policies),
    })),
  );

  const exposed = rows.filter((r) => r.rls_enabled !== true);
  const withPolicies = rows.filter(
    (r) => Number(r.policies) !== 0 && !POLICIES_EXPECTED.has(r.table_name),
  );
  if (exposed.length === 0 && withPolicies.length === 0) {
    const exempt = rows.filter((r) => POLICIES_EXPECTED.has(r.table_name));
    console.log(
      `\n✓ All ${rows.length} tables in public have RLS enabled.` +
        ` ${rows.length - exempt.length} have zero policies, so anon/authenticated are blocked.` +
        (exempt.length
          ? ` Deliberately policied: ${exempt.map((r) => r.table_name).join(", ")}.`
          : ""),
    );
  } else {
    if (exposed.length) {
      console.log("\n⚠ RLS is OFF on:", exposed.map((r) => r.table_name).join(", "));
    }
    if (withPolicies.length) {
      // A policy here would grant access rather than restrict it, since the
      // whole design is deny-by-default through having none.
      console.log(
        "⚠ Unexpected policies on:",
        withPolicies.map((r) => r.table_name).join(", "),
      );
    }
    process.exit(1);
  }
} catch (err) {
  console.error("Failed:", err);
  process.exit(1);
} finally {
  await p.$disconnect();
}
