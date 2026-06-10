/**
 * Chat / LLM wrapper — server-side only. OpenAI Chat Completions.
 *
 * Thin layer over the OpenAI SDK so every RAG + LLM feature on the platform
 * funnels through one place: one model default, one place to add cost
 * logging, one place to swap providers later. Key never reaches the client
 * (same discipline as Meta tokens).
 *
 * `complete()` is the everyday call: prompt in, string out. Pass a `system`
 * prompt for persona/voice setup and `context` (already-retrieved RAG
 * chunks) which gets folded into the system message — callers focus on
 * their own question rather than prompt-stitching.
 *
 * Same OpenAI client + key as src/lib/llm/embeddings.ts — one vendor for
 * the whole AI stack.
 */

import OpenAI from "openai";
import type { ChatCompletionMessageParam } from "openai/resources/chat/completions";

const apiKey = process.env.OPENAI_API_KEY;
if (!apiKey && process.env.NODE_ENV === "production") {
  console.error(
    "OPENAI_API_KEY is not set — LLM calls will fail at call time",
  );
}

const openai = new OpenAI({ apiKey: apiKey ?? "missing-key" });

// gpt-4o is the right default — best balance of reasoning + cost for the
// kinds of tasks the platform runs (audits, copy, narrative reports).
// Use gpt-4o-mini for high-volume cheap jobs (titles, classifications),
// and the latest reasoning model (gpt-5 family) for the heaviest analysis.
export const DEFAULT_MODEL = "gpt-4o";

export interface CompleteOptions {
  /** Override the default model (e.g. "gpt-4o-mini" for cheap, "gpt-5" for hard). */
  model?: string;
  /** Persona / role / output-format instructions. */
  system?: string;
  /** Already-retrieved RAG chunks. Folded into the system message. */
  context?: string;
  /** Hard cap on output length. Defaults to 1024 tokens. */
  maxTokens?: number;
  /** 0.0 = deterministic, 1.0 = creative. 0.7 fits most copy/narrative tasks. */
  temperature?: number;
}

/** Build the messages array — shared by complete() and completeJson(). */
function buildMessages(
  prompt: string | ChatCompletionMessageParam[],
  opts: CompleteOptions,
): ChatCompletionMessageParam[] {
  const userMessages: ChatCompletionMessageParam[] =
    typeof prompt === "string"
      ? [{ role: "user", content: prompt }]
      : prompt;

  // Stitch persona + RAG context into one system message. Keeping it stable
  // across calls lets OpenAI's prompt cache reuse it (cost win at scale).
  const systemParts: string[] = [];
  if (opts.system) systemParts.push(opts.system);
  if (opts.context) {
    systemParts.push(`Retrieved context:\n\n${opts.context}`);
  }

  const messages: ChatCompletionMessageParam[] = [];
  if (systemParts.length > 0) {
    messages.push({ role: "system", content: systemParts.join("\n\n") });
  }
  messages.push(...userMessages);
  return messages;
}

/**
 * Run a single-turn completion. Pass either a string (treated as the user
 * message) or an explicit message array for multi-turn.
 *
 * Returns the assistant's text content. Errors from the SDK propagate —
 * callers should catch and surface them to the user.
 */
export async function complete(
  prompt: string | ChatCompletionMessageParam[],
  opts: CompleteOptions = {},
): Promise<string> {
  const res = await openai.chat.completions.create({
    model: opts.model ?? DEFAULT_MODEL,
    // `max_completion_tokens` is the forward-compatible field — works on
    // gpt-4o today and on the reasoning models (gpt-5 / o-series) which
    // dropped the older `max_tokens` name.
    max_completion_tokens: opts.maxTokens ?? 1024,
    temperature: opts.temperature ?? 0.7,
    messages: buildMessages(prompt, opts),
  });

  return res.choices[0]?.message?.content ?? "";
}

export interface JsonSchemaSpec {
  /** Schema name — surfaces in OpenAI errors; use a stable short slug. */
  name: string;
  /** JSON Schema describing the expected response object. */
  schema: Record<string, unknown>;
  /**
   * Strict mode forces the model to produce schema-conformant output, with
   * the same guarantees the grammar gives — required for the response to
   * parse reliably. Default true.
   */
  strict?: boolean;
}

/**
 * Run a completion that's constrained to a JSON Schema (OpenAI Structured
 * Outputs). The returned object is guaranteed to be valid JSON matching the
 * schema. Use this for any feature that needs structured data back —
 * audits, generations, list-of-N outputs — instead of regex-parsing prose.
 */
export async function completeJson<T = unknown>(
  prompt: string | ChatCompletionMessageParam[],
  opts: CompleteOptions = {},
  schema: JsonSchemaSpec,
): Promise<T> {
  const res = await openai.chat.completions.create({
    model: opts.model ?? DEFAULT_MODEL,
    max_completion_tokens: opts.maxTokens ?? 2048,
    temperature: opts.temperature ?? 0.7,
    messages: buildMessages(prompt, opts),
    response_format: {
      type: "json_schema",
      json_schema: {
        name: schema.name,
        schema: schema.schema,
        strict: schema.strict ?? true,
      },
    },
  });
  const content = res.choices[0]?.message?.content ?? "{}";
  return JSON.parse(content) as T;
}
