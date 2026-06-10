/**
 * AI Assistant chat — tool-using LLM with on-demand DB access + persisted
 * threads.
 *
 * Public surface:
 *   • runChatTurn(threadId, userContent) — runs one back-and-forth: appends
 *     the user message, loops model + tools until the model produces a
 *     plain reply, persists every message produced, returns the final reply
 *     text + the names of tools the model called this turn.
 *   • createThreadFromFirstMessage(content) — opens a fresh thread,
 *     auto-titling from the user's first message.
 *   • loadThreadTurns(threadId) — reads the persisted history back as the
 *     UI's "turn" shape (one user → one assistant chunk + the tools fired).
 *
 * Loop is capped at MAX_ITERATIONS so a misbehaving model can't drain
 * credits. Tool calls are real DB reads — never guess. If the question
 * doesn't fit any tool, the model must say so, not invent an answer.
 */

import OpenAI from "openai";
import type {
  ChatCompletionMessageParam,
  ChatCompletionMessageToolCall,
  ChatCompletionToolMessageParam,
} from "openai/resources/chat/completions";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db/prisma";
import { runTool, TOOLS } from "./tools";

const MAX_ITERATIONS = 8;
const MODEL = "gpt-4o";
const TITLE_MAX_LEN = 60;

const SYSTEM_PROMPT = `You are the AI Assistant inside an agency's Meta Marketing tool. The strategist asks questions about their ad accounts, campaigns, ad sets, ads, and insights. You answer using the tools available — never invent numbers.

Workflow rules:
- For ANY question that depends on data, call the appropriate tool FIRST, then answer.
- If the user mentions any relative date ("this week", "yesterday", "last month"), call get_today FIRST to anchor windows correctly. Don't assume what today is.
- Tool calls are cheap — chain them. Need an account id? Call list_accounts. Need campaign ids? Call get_campaigns. Then call the insights tool with the ids you found.
- If a tool returns empty data, say so plainly. Don't extrapolate.
- ROAS, conversions, and revenue ARE now available — every insights tool returns conversionsCount, revenueCents, roas, and costPerConversionCents. Lead with ROAS when the user asks "is this working?" because that's the metric clients care about most.
- If conversionsCount and revenueCents are both 0 for a window, it means the account has no conversion tracking set up yet (or the events haven't fired). Say so plainly — don't guess at ROAS.
- If the question can't be answered from any available tool (audience overlap, ad-policy issues, etc.), say "I don't have that data — would need [what's missing] synced first." Don't guess.

Response style:
- Conversational, concise. 1–4 short sentences for simple questions; longer only when the user asks for detail.
- Use markdown for lists and bold sparingly.
- Currency: format with the right symbol (look at the account's currency from list_accounts / get_account_insights). Cents come in as integers — divide by 100 for display.
- Percentages: round to 1 decimal unless precision matters.
- No clichés ("game-changer", "synergy"). No filler.`;

const apiKey = process.env.OPENAI_API_KEY;
const openai = new OpenAI({ apiKey: apiKey ?? "missing-key" });

// ── DB ↔ OpenAI message shape ───────────────────────────────────────────

interface StoredMessage {
  id: string;
  role: string;
  content: string;
  toolCalls: Prisma.JsonValue | null;
  toolCallId: string | null;
  createdAt: Date;
}

function toWireFormat(rows: StoredMessage[]): ChatCompletionMessageParam[] {
  const out: ChatCompletionMessageParam[] = [];
  for (const r of rows) {
    if (r.role === "user") {
      out.push({ role: "user", content: r.content });
    } else if (r.role === "assistant") {
      const toolCalls = r.toolCalls
        ? (r.toolCalls as unknown as ChatCompletionMessageToolCall[])
        : undefined;
      out.push({
        role: "assistant",
        content: r.content,
        ...(toolCalls && toolCalls.length > 0 ? { tool_calls: toolCalls } : {}),
      });
    } else if (r.role === "tool") {
      out.push({
        role: "tool",
        tool_call_id: r.toolCallId ?? "",
        content: r.content,
      });
    }
  }
  return out;
}

function autoTitle(text: string): string {
  const clean = text.trim().replace(/\s+/g, " ");
  if (clean.length <= TITLE_MAX_LEN) return clean;
  return clean.slice(0, TITLE_MAX_LEN - 1).trimEnd() + "…";
}

// ── Public API ──────────────────────────────────────────────────────────

export async function createThreadFromFirstMessage(
  content: string,
): Promise<{ id: string; title: string }> {
  const title = autoTitle(content) || "Untitled chat";
  const thread = await prisma.chatThread.create({
    data: { title },
    select: { id: true, title: true },
  });
  return thread;
}

export interface RunTurnResult {
  reply: string;
  toolsUsed: string[];
}

export async function runChatTurn(
  threadId: string,
  userContent: string,
): Promise<RunTurnResult> {
  // Persist the user message immediately so a server crash mid-loop still
  // leaves a recoverable thread state.
  await prisma.chatMessage.create({
    data: { threadId, role: "user", content: userContent },
  });

  // Load full thread history (including the message we just wrote).
  const history = await prisma.chatMessage.findMany({
    where: { threadId },
    orderBy: { createdAt: "asc" },
  });

  const working: ChatCompletionMessageParam[] = [
    { role: "system", content: SYSTEM_PROMPT },
    ...toWireFormat(history),
  ];

  const toolsUsed: string[] = [];
  let finalReply = "";

  for (let iter = 0; iter < MAX_ITERATIONS; iter++) {
    const res = await openai.chat.completions.create({
      model: MODEL,
      messages: working,
      tools: TOOLS,
      tool_choice: "auto",
      temperature: 0.4,
      max_completion_tokens: 1200,
    });

    const msg = res.choices[0]?.message;
    if (!msg) throw new Error("LLM returned no message");

    const assistantContent = msg.content ?? "";
    const toolCalls = msg.tool_calls ?? [];

    // Persist + add to working buffer.
    await prisma.chatMessage.create({
      data: {
        threadId,
        role: "assistant",
        content: assistantContent,
        toolCalls:
          toolCalls.length > 0
            ? (toolCalls as unknown as Prisma.InputJsonValue)
            : Prisma.JsonNull,
      },
    });
    working.push({
      role: "assistant",
      content: assistantContent,
      ...(toolCalls.length > 0 ? { tool_calls: toolCalls } : {}),
    });

    if (toolCalls.length === 0) {
      finalReply = assistantContent;
      break;
    }

    // Execute every tool call, persist each result.
    for (const call of toolCalls) {
      if (call.type !== "function") continue;
      const name = call.function.name;
      toolsUsed.push(name);

      let result: unknown;
      try {
        const args = call.function.arguments
          ? (JSON.parse(call.function.arguments) as Record<string, unknown>)
          : {};
        result = await runTool(name, args);
      } catch (err) {
        result = {
          error: err instanceof Error ? err.message : "Unknown tool error",
        };
      }
      const serialised = JSON.stringify(result);
      await prisma.chatMessage.create({
        data: {
          threadId,
          role: "tool",
          content: serialised,
          toolCallId: call.id,
        },
      });
      const toolMsg: ChatCompletionToolMessageParam = {
        role: "tool",
        tool_call_id: call.id,
        content: serialised,
      };
      working.push(toolMsg);
    }
  }

  if (!finalReply) {
    finalReply =
      "I hit my reasoning cap on this one — try breaking the question into smaller parts.";
  }

  // Bump the thread's updatedAt so it floats to the top of the sidebar.
  await prisma.chatThread.update({
    where: { id: threadId },
    data: { updatedAt: new Date() },
  });

  return { reply: finalReply, toolsUsed };
}

// ── Read-back for the UI ────────────────────────────────────────────────

export interface DisplayTurn {
  userContent: string;
  toolsUsed: string[];
  assistantContent: string;
}

/**
 * Compact the persisted message stream into UI-friendly "turns" — each
 * user message becomes one turn, with everything up to the next user
 * message folded into it (tools fired, assistant text). We surface only
 * the LAST assistant text in a turn because that's the model's final
 * answer after any tool reasoning.
 */
export async function loadThreadTurns(
  threadId: string,
): Promise<DisplayTurn[] | null> {
  const thread = await prisma.chatThread.findUnique({
    where: { id: threadId },
    select: { id: true },
  });
  if (!thread) return null;

  const messages = await prisma.chatMessage.findMany({
    where: { threadId },
    orderBy: { createdAt: "asc" },
  });

  const turns: DisplayTurn[] = [];
  let current: DisplayTurn | null = null;
  for (const m of messages) {
    if (m.role === "user") {
      if (current) turns.push(current);
      current = {
        userContent: m.content,
        toolsUsed: [],
        assistantContent: "",
      };
    } else if (m.role === "assistant" && current) {
      // Track tool calls
      if (m.toolCalls) {
        const calls = m.toolCalls as unknown as ChatCompletionMessageToolCall[];
        for (const c of calls) {
          if (c.type === "function") current.toolsUsed.push(c.function.name);
        }
      }
      if (m.content.trim()) current.assistantContent = m.content;
    }
  }
  if (current) turns.push(current);
  return turns;
}
