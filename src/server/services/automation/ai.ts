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
  /**
   * Caption of the post being commented on, when the event is a comment.
   * Without it "how much for this?" is unanswerable — the model cannot tell
   * which post the person means. Null for DMs and for unreadable media.
   */
  postCaption?: string | null;
  /** Per-rule AI steer from BotRule.aiInstructions. */
  ruleInstructions?: string;
  /**
   * Which surface this reply is for: a public comment reply everyone can
   * see, or a private DM. The two need different wording and the model
   * cannot infer it from the message alone.
   */
  channel?: "PUBLIC_REPLY" | "DM";
  /**
   * True when a DM is ALSO being sent for this same comment. Without it the
   * public reply and the DM are generated independently and come out nearly
   * identical — the public reply answers in full, so the DM adds nothing and
   * the pair reads like a glitch.
   */
  companionDm?: boolean;
  /** Which Meta surface this reply is being sent on — see buildSystemPrompt. */
  platform?: "INSTAGRAM" | "FACEBOOK";
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
  const system = buildSystemPrompt(
    args.profile,
    args.languageMode,
    args.ruleInstructions,
    args.channel,
    args.companionDm,
    args.platform,
  );
  const caption = args.postCaption?.trim();
  const convo = [
    // Post context first so the model reads it as background, not as
    // something the user said. Truncated: captions can run long and the
    // first couple of lines carry the topic.
    ...(caption
      ? [
          `[Context - the post they commented on says: "${caption.slice(0, 500)}"]`,
        ]
      : []),
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
