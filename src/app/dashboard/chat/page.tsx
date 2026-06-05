/**
 * AI Assistant — full-page chat with on-demand DB access.
 *
 * The assistant queries Prisma via tool calls (see
 * src/server/services/ai/tools.ts) so every answer is grounded in real
 * data, never guessed. Conversation state lives client-side; the backend
 * is stateless.
 *
 * Topbar client filter is INTENTIONALLY a no-op here. Threads are
 * deliberately global — a conversation may span multiple clients ("compare
 * Fashion A vs D2C B"). The /api/ai/chat tools take an explicit accountId
 * per call, so the model scopes per-question rather than per-page.
 */

import { DataChat } from "@/components/ai/data-chat";

export default function ChatPage() {
  return (
    <div className="space-y-4">
      <DataChat />
    </div>
  );
}
