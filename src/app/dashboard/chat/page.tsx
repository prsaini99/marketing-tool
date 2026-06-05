/**
 * AI Assistant — full-page chat with on-demand DB access.
 *
 * The assistant queries Prisma via tool calls (see
 * src/server/services/ai/tools.ts) so every answer is grounded in real
 * data, never guessed. Conversation state lives client-side; the backend
 * is stateless.
 */

import { DataChat } from "@/components/ai/data-chat";

export default function ChatPage() {
  return (
    <div className="space-y-4">
      <DataChat />
    </div>
  );
}
