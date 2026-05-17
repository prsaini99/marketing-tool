/**
 * One-off: delete a stray System User by id via Meta Graph API.
 *
 * Run:
 *   npx dotenv -e .env.local -- node scripts/delete-system-user.mjs <id>
 *
 * Likely outcome: 403 if META_TEST_TOKEN is itself a System User token —
 * Meta requires a Business Admin user-token for this. The error message
 * will tell us which permission is missing.
 */

const META_API = "https://graph.facebook.com/v23.0";
const token = process.env.META_TEST_TOKEN;
const id = process.argv[2];

if (!token) {
  console.error("Missing META_TEST_TOKEN in .env.local");
  process.exit(1);
}
if (!id) {
  console.error("Usage: node scripts/delete-system-user.mjs <system_user_id>");
  process.exit(1);
}

const url = new URL(`${META_API}/${id}`);
url.searchParams.set("access_token", token);

const res = await fetch(url.toString(), { method: "DELETE" });
const body = await res.text();
console.log(`HTTP ${res.status}`);
console.log(body);
