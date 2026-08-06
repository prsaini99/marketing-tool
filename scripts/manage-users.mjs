/**
 * Manage database-backed app logins (the `AppUser` table).
 *
 * Exists so the owner can hand out and revoke logins — notably a temporary,
 * self-expiring reviewer account for Meta App Review — without editing
 * Vercel env vars and redeploying.
 *
 * Usage (run from the repo root; reads .env, NOT .env.local):
 *
 *   node scripts/manage-users.mjs list
 *   NEW_USER_PASSWORD=... node scripts/manage-users.mjs create a@b.com reviewer
 *   NEW_USER_PASSWORD=... node scripts/manage-users.mjs create a@b.com reviewer --expires 2026-09-01
 *   node scripts/manage-users.mjs disable a@b.com
 *   node scripts/manage-users.mjs enable a@b.com
 *   NEW_USER_PASSWORD=... node scripts/manage-users.mjs set-password a@b.com
 *   node scripts/manage-users.mjs delete a@b.com
 *
 * SECURITY: passwords are read from the `NEW_USER_PASSWORD` env var or, if
 * unset, from stdin — never from argv, because argv leaks into shell history
 * and into `ps` output for every user on the box. Nothing here ever prints a
 * password or a hash.
 *
 * `enable` clears BOTH disabledAt and a past expiresAt — a login that is
 * merely un-disabled but still expired would look active in `list` and fail
 * at the door.
 */

import { createInterface } from "node:readline";
import { randomBytes, scryptSync } from "node:crypto";
import { PrismaClient } from "@prisma/client";

const SCHEME = "scrypt";
const SALT_BYTES = 16;
const KEY_BYTES = 64;
const ROLES = ["owner", "reviewer"];

// Kept byte-identical in behaviour to hashPassword() in
// src/server/services/auth/users.ts — this script is plain .mjs and can't
// import the TS module, so the format contract lives in both places.
function hashPassword(plain) {
  const salt = randomBytes(SALT_BYTES);
  const hash = scryptSync(plain, salt, KEY_BYTES);
  return `${SCHEME}$${salt.toString("hex")}$${hash.toString("hex")}`;
}

function normalizeEmail(email) {
  return String(email).trim().toLowerCase();
}

function die(msg) {
  console.error(msg);
  process.exit(1);
}

async function readPasswordFromStdin() {
  if (process.stdin.isTTY) {
    console.log(
      "Enter password (input is visible — prefer NEW_USER_PASSWORD env var):",
    );
  }
  const rl = createInterface({ input: process.stdin });
  for await (const line of rl) {
    rl.close();
    return line.trim();
  }
  return "";
}

async function getPassword() {
  const fromEnv = process.env.NEW_USER_PASSWORD;
  if (fromEnv && fromEnv.length > 0) return fromEnv;
  const fromStdin = await readPasswordFromStdin();
  if (!fromStdin) {
    die("No password supplied. Set NEW_USER_PASSWORD or pipe one on stdin.");
  }
  if (fromStdin.length < 8) die("Password must be at least 8 characters.");
  return fromStdin;
}

function parseExpires(args) {
  const i = args.indexOf("--expires");
  if (i === -1) return null;
  const raw = args[i + 1];
  if (!raw) die("--expires needs an ISO date, e.g. --expires 2026-09-01");
  const d = new Date(raw);
  if (Number.isNaN(d.getTime())) die(`Could not parse date: ${raw}`);
  return d;
}

function statusOf(u) {
  if (u.disabledAt) return "DISABLED";
  if (u.expiresAt && u.expiresAt.getTime() <= Date.now()) return "EXPIRED";
  return "active";
}

const prisma = new PrismaClient();

async function main() {
  const [cmd, ...rest] = process.argv.slice(2);

  switch (cmd) {
    case "list": {
      const users = await prisma.appUser.findMany({
        orderBy: { createdAt: "asc" },
        // Explicit select: never pull passwordHash into a process that prints.
        select: {
          email: true,
          role: true,
          disabledAt: true,
          expiresAt: true,
          createdAt: true,
        },
      });
      if (users.length === 0) {
        console.log("No AppUser rows. Login falls back to env credentials.");
        return;
      }
      console.table(
        users.map((u) => ({
          email: u.email,
          role: u.role,
          status: statusOf(u),
          expires: u.expiresAt ? u.expiresAt.toISOString() : "—",
          disabled: u.disabledAt ? u.disabledAt.toISOString() : "—",
          created: u.createdAt.toISOString(),
        })),
      );
      return;
    }

    case "create": {
      const email = normalizeEmail(rest[0] ?? "");
      const role = rest[1];
      if (!email || !email.includes("@")) die("Usage: create <email> <role>");
      if (!ROLES.includes(role)) die(`Role must be one of: ${ROLES.join(", ")}`);
      const expiresAt = parseExpires(rest);
      const existing = await prisma.appUser.findUnique({ where: { email } });
      if (existing) die(`${email} already exists — use set-password / enable.`);
      const password = await getPassword();
      await prisma.appUser.create({
        data: { email, role, passwordHash: hashPassword(password), expiresAt },
      });
      console.log(
        `Created ${email} (${role})${
          expiresAt ? `, expires ${expiresAt.toISOString()}` : ", no expiry"
        }.`,
      );
      return;
    }

    case "disable": {
      const email = normalizeEmail(rest[0] ?? "");
      if (!email) die("Usage: disable <email>");
      const r = await prisma.appUser.updateMany({
        where: { email },
        data: { disabledAt: new Date() },
      });
      if (r.count === 0) die(`No such user: ${email}`);
      console.log(`Disabled ${email}. Login now refused.`);
      return;
    }

    case "enable": {
      const email = normalizeEmail(rest[0] ?? "");
      if (!email) die("Usage: enable <email>");
      const user = await prisma.appUser.findUnique({ where: { email } });
      if (!user) die(`No such user: ${email}`);
      // Clear a lapsed expiry too, otherwise "enabled" still can't log in.
      const clearExpiry =
        user.expiresAt && user.expiresAt.getTime() <= Date.now();
      await prisma.appUser.update({
        where: { email },
        data: {
          disabledAt: null,
          ...(clearExpiry ? { expiresAt: null } : {}),
        },
      });
      console.log(
        `Enabled ${email}${clearExpiry ? " (cleared lapsed expiry)" : ""}.`,
      );
      return;
    }

    case "set-password": {
      const email = normalizeEmail(rest[0] ?? "");
      if (!email) die("Usage: set-password <email>");
      const user = await prisma.appUser.findUnique({ where: { email } });
      if (!user) die(`No such user: ${email}`);
      const password = await getPassword();
      await prisma.appUser.update({
        where: { email },
        data: { passwordHash: hashPassword(password) },
      });
      console.log(`Password updated for ${email}.`);
      return;
    }

    case "delete": {
      const email = normalizeEmail(rest[0] ?? "");
      if (!email) die("Usage: delete <email>");
      const r = await prisma.appUser.deleteMany({ where: { email } });
      if (r.count === 0) die(`No such user: ${email}`);
      console.log(`Deleted ${email}.`);
      return;
    }

    default:
      die(
        [
          "Usage: node scripts/manage-users.mjs <command>",
          "",
          "  list",
          "  create <email> <owner|reviewer> [--expires <ISO date>]",
          "  disable <email>",
          "  enable <email>",
          "  set-password <email>",
          "  delete <email>",
          "",
          "Password comes from NEW_USER_PASSWORD or stdin — never argv.",
        ].join("\n"),
      );
  }
}

try {
  await main();
} catch (err) {
  console.error("Failed:", err);
  process.exitCode = 1;
} finally {
  await prisma.$disconnect();
}
