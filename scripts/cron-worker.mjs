/**
 * Dev cron worker. Pokes /api/cron/tick once a minute so SyncSchedule rows
 * actually fire. Not used in production — there a real scheduler (Vercel cron,
 * external cron, etc.) will hit the same endpoint on its own cadence.
 *
 * Run:   npm run cron-worker
 * Stop:  Ctrl+C
 */

const URL = process.env.CRON_TICK_URL ?? "http://localhost:3000/api/cron/tick";
const INTERVAL_MS = Number(process.env.CRON_TICK_INTERVAL_MS ?? 60_000);

// The tick endpoint now requires the bearer token on both GET and POST, so
// the worker has to present it. `npm run cron-worker` loads .env.local via
// dotenv-cli; running this file with bare `node` will not pick the secret up.
const SECRET = process.env.CRON_SECRET;
if (!SECRET) {
  console.error(
    "[cron-worker] CRON_SECRET is not set, so every tick would 401.\n" +
      "  Add it to .env.local and start with `npm run cron-worker`.",
  );
  process.exit(1);
}

console.log(`[cron-worker] polling ${URL} every ${INTERVAL_MS / 1000}s`);

let busy = false;

async function tick() {
  if (busy) {
    console.log(
      `[cron-worker ${new Date().toISOString()}] previous tick still running, skipping`,
    );
    return;
  }
  busy = true;
  try {
    const res = await fetch(URL, {
      method: "POST",
      headers: { authorization: `Bearer ${SECRET}` },
    });
    if (res.status === 401) {
      console.error(
        `[cron-worker ${new Date().toISOString()}] 401 - CRON_SECRET here does not match the server's.`,
      );
      return;
    }
    const data = await res.json().catch(() => ({}));
    if (data.ran || data.errors || data.skipped) {
      console.log(
        `[cron-worker ${new Date().toISOString()}] ran=${data.ran} skipped=${data.skipped} errors=${data.errors}`,
      );
    }
  } catch (err) {
    console.error(`[cron-worker ${new Date().toISOString()}] tick failed:`, err);
  } finally {
    busy = false;
  }
}

// Fire once immediately so a freshly-saved schedule that's already due
// doesn't have to wait a full minute on first start.
tick();
setInterval(tick, INTERVAL_MS);
