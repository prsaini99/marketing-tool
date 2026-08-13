/**
 * AI intent + sentiment guard.
 *
 * Runs BEFORE any reply is generated or template rendered — there is no
 * point writing a reply we then throw away. One gpt-4o-mini call.
 *
 * Two deliberate biases, both toward replying:
 *  - Low confidence proceeds. An unsure classifier silently swallowing a
 *    genuine customer question is worse than an unnecessary reply.
 *  - A failed call proceeds. Degrade to the simpler behaviour, never to
 *    silence — the same rule the reply AI already follows.
 */

import { completeJson } from "@/lib/llm/chat";

export type IntentCategory =
  | "QUESTION"
  | "INTERESTED"
  | "PRAISE_ONLY"
  | "COMPLAINT"
  | "SPAM"
  | "NOISE";

export interface IntentVerdict {
  category: IntentCategory;
  confidence: number;
}

export interface ClassifyIntentArgs {
  text: string;
  /** Caption of the post being commented on, when available. */
  postCaption?: string | null;
}

/** Categories the bot answers. Everything else is suppressed. */
export const REPLYABLE: ReadonlySet<IntentCategory> = new Set<IntentCategory>([
  "QUESTION",
  "INTERESTED",
]);

/** Skip reason recorded per suppressed category. */
export const INTENT_SKIP_REASONS: Record<IntentCategory, string> = {
  QUESTION: "",
  INTERESTED: "",
  PRAISE_ONLY: "praise_only",
  COMPLAINT: "complaint",
  SPAM: "spam",
  NOISE: "noise",
};

/** Below this the verdict is treated as "unsure" and the reply proceeds. */
export const INTENT_MIN_CONFIDENCE = 0.6;

const INTENT_SCHEMA = {
  name: "intent_verdict",
  schema: {
    type: "object",
    additionalProperties: false,
    properties: {
      category: {
        type: "string",
        enum: [
          "QUESTION",
          "INTERESTED",
          "PRAISE_ONLY",
          "COMPLAINT",
          "SPAM",
          "NOISE",
        ],
      },
      confidence: { type: "number" },
    },
    required: ["category", "confidence"],
  },
};

const SYSTEM = [
  "You classify a single incoming Instagram or Facebook message so a bot can decide whether to reply.",
  "",
  "Categories:",
  "- QUESTION: asks something answerable (price, availability, how it works, can you do X).",
  "- INTERESTED: states interest or wants to be contacted (\"dm me\", \"I want this\", \"send details\").",
  "- PRAISE_ONLY: compliments with no question and no stated interest (\"great post\", \"love your work\").",
  "- COMPLAINT: unhappy, angry, accusing, or disputing, including sarcasm aimed at the business.",
  "- SPAM: promotion of something else, follow-for-follow, unrelated links, bot-like repetition.",
  "- NOISE: no meaningful content, such as random characters, a single emoji, or off-topic chatter.",
  "",
  "confidence is 0..1 for how sure you are of the category. Be honest: use a low value when the message is short or ambiguous.",
].join("\n");

export async function classifyIntent(
  args: ClassifyIntentArgs,
): Promise<IntentVerdict> {
  const caption = args.postCaption?.trim();
  const prompt = [
    caption ? `[They are commenting on a post that says: "${caption.slice(0, 300)}"]` : "",
    `Message: ${args.text}`,
  ]
    .filter(Boolean)
    .join("\n");

  const out = await completeJson<IntentVerdict>(
    prompt,
    { model: "gpt-4o-mini", system: SYSTEM, maxTokens: 100, temperature: 0 },
    INTENT_SCHEMA,
  );
  // Clamp on read: the schema asks for 0..1 but nothing enforces the model
  // actually stays in range. If it ever answered on a 0-100 scale, every
  // verdict would clear the 0.6 threshold and the deliberate fail-OPEN bias
  // (unsure proceeds) would silently invert to fail-CLOSED (suppress
  // everything) — the opposite of this guard's intent.
  const c =
    typeof out.confidence === "number"
      ? Math.min(Math.max(out.confidence, 0), 1)
      : 0;
  return {
    category: out.category,
    confidence: c,
  };
}
