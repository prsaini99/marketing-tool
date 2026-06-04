/**
 * Embeddings provider — server-side only.
 *
 * Wraps OpenAI's text-embedding-3-small (1536-d). Cheap (~$0.02 per 1M
 * tokens), the de-facto default for RAG. The dimension matches the pgvector
 * column in the Embedding table (vector(1536)); changing the model means a
 * migration + a full re-index, so this is the one knob to keep stable.
 *
 * The key never reaches the client — every embedding call happens from
 * server routes / services, same boundary discipline as the Meta token.
 *
 * For features that need higher quality (e.g. brand-voice copy retrieval),
 * we can layer a second provider here later — the RAG service treats this
 * file as the source of truth for `(model, dimension)`.
 */

import OpenAI from "openai";

const apiKey = process.env.OPENAI_API_KEY;
if (!apiKey && process.env.NODE_ENV === "production") {
  // Don't blow up dev (lets tests run without keys), but loudly fail prod.
  console.error("OPENAI_API_KEY is not set — embeddings will fail at call time");
}

const openai = new OpenAI({ apiKey: apiKey ?? "missing-key" });

export const EMBEDDING_MODEL = "text-embedding-3-small";
export const EMBEDDING_DIMENSIONS = 1536;

/** Embed a single piece of text. Returns a 1536-d vector. */
export async function embedText(text: string): Promise<number[]> {
  if (!text.trim()) throw new Error("embedText: empty input");
  const res = await openai.embeddings.create({
    model: EMBEDDING_MODEL,
    input: text,
  });
  return res.data[0].embedding;
}

/**
 * Embed many at once. OpenAI accepts up to 2048 inputs per call and ~8k
 * tokens each; batching cuts both round-trip and per-call overhead.
 * Returns one vector per input, in the same order.
 */
export async function embedBatch(texts: string[]): Promise<number[][]> {
  if (texts.length === 0) return [];
  if (texts.some((t) => !t.trim())) {
    throw new Error("embedBatch: empty string in batch");
  }
  const res = await openai.embeddings.create({
    model: EMBEDDING_MODEL,
    input: texts,
  });
  return res.data.map((d) => d.embedding);
}
