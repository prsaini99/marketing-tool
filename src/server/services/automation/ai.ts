/**
 * AI reply generation — gpt-4o-mini, constrained by the structured bot
 * profile (buildSystemPrompt) and hard-filtered on output (isReplySafe).
 * The caller (orchestrate.ts) decides what happens on safe=false,
 * low confidence, escalate=true, or a thrown error.
 */

import { completeJson } from "@/lib/llm/chat";
import {
  buildSystemPrompt,
  isReplySafe,
  type ProfileCorpus,
} from "./ai-guards";

export interface AiReplyResult {
  reply: string;
  confidence: number;
  escalate: boolean;
}

export interface GenerateAiReplyArgs {
  profile: ProfileCorpus;
  languageMode: string;
  history: Array<{ role: string; text: string }>; // thread recent messages
  userText: string;
}

const REPLY_SCHEMA = {
  name: "ig_reply",
  schema: {
    type: "object",
    additionalProperties: false,
    properties: {
      reply: { type: "string" },
      confidence: { type: "number" },
      escalate: { type: "boolean" },
    },
    required: ["reply", "confidence", "escalate"],
  },
};

export async function generateAiReply(
  args: GenerateAiReplyArgs,
): Promise<AiReplyResult & { safe: boolean }> {
  const system = buildSystemPrompt(args.profile, args.languageMode);
  const convo = [
    ...args.history
      .slice(-10)
      .map((h) => `${h.role === "assistant" ? "Assistant" : "User"}: ${h.text}`),
    `User: ${args.userText}`,
  ].join("\n");
  const out = await completeJson<AiReplyResult>(
    convo,
    { model: "gpt-4o-mini", system, maxTokens: 300, temperature: 0.4 },
    REPLY_SCHEMA,
  );
  return { ...out, safe: isReplySafe(out.reply ?? "", args.profile) };
}
