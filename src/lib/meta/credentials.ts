/**
 * Meta credential storage — the ONLY place tokens are encrypted/decrypted.
 *
 * Tokens are encrypted at rest with AES-256-GCM. Each row stores its own IV and
 * auth tag, so we can rotate ENCRYPTION_KEY without losing per-row context
 * (re-encrypt rows one at a time).
 *
 * Per PROJECT.md rule #5: never log token values. This file references rows
 * by `credentialId`; callers never see plaintext beyond client.ts.
 */

import { createCipheriv, createDecipheriv, randomBytes } from "crypto";
import { prisma } from "@/lib/db/prisma";

const ALGORITHM = "aes-256-gcm";
const IV_LENGTH = 12; // 96-bit IV is the GCM spec-recommended size

function getKey(): Buffer {
  const raw = process.env.ENCRYPTION_KEY;
  if (!raw) throw new Error("ENCRYPTION_KEY is not set");
  const key = Buffer.from(raw, "base64");
  if (key.length !== 32) {
    throw new Error("ENCRYPTION_KEY must decode to 32 bytes (use `openssl rand -base64 32`)");
  }
  return key;
}

interface EncryptedPayload {
  encryptedToken: string; // base64 ciphertext
  iv: string;             // base64
  authTag: string;        // base64
}

export function encryptToken(plaintext: string): EncryptedPayload {
  const key = getKey();
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv(ALGORITHM, key, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return {
    encryptedToken: ciphertext.toString("base64"),
    iv: iv.toString("base64"),
    authTag: authTag.toString("base64"),
  };
}

export function decryptToken(payload: EncryptedPayload): string {
  const key = getKey();
  const iv = Buffer.from(payload.iv, "base64");
  const authTag = Buffer.from(payload.authTag, "base64");
  const ciphertext = Buffer.from(payload.encryptedToken, "base64");
  const decipher = createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(authTag);
  const plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  return plaintext.toString("utf8");
}

/**
 * Load and decrypt a Connection's access token. Used by `client.ts` to get
 * a fresh token immediately before issuing a Meta API call.
 */
export async function getCredential(connectionId: string): Promise<{ accessToken: string }> {
  const row = await prisma.connection.findFirstOrThrow({
    where: { id: connectionId, status: { not: "REVOKED" } },
  });

  if (row.expiresAt && row.expiresAt < new Date()) {
    throw new Error("Connection token expired");
  }

  const accessToken = decryptToken({
    encryptedToken: row.encryptedToken,
    iv: row.iv,
    authTag: row.authTag,
  });

  return { accessToken };
}
