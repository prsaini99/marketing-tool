/**
 * Automated-experience disclosure. Pure module.
 *
 * Meta's messaging policies require that a person can tell they are in an
 * automated conversation rather than talking to a human. Without this, a
 * reviewer testing the demo sees a bot presenting as a person, which is a
 * standard rejection reason for a messaging submission.
 *
 * WHERE IT APPLIES
 *
 * Private messages only, and only on the first automated message a person
 * receives in a conversation.
 *
 * Not on public comment replies: a comment reply under a post is not a
 * private automated conversation, everyone reading the thread can see it is
 * a brand account replying, and stamping a disclaimer under every public
 * comment would make the Page look worse without telling anyone anything
 * they did not already know.
 *
 * Not on every message: repeating it each turn burns most of a ~60 word DM
 * budget and reads as broken. Once per conversation is what the policy is
 * asking for, and the first message is when the person needs to know.
 *
 * WHY IT IS APPENDED RATHER THAN PROMPTED
 *
 * Putting "always disclose you are a bot" in the system prompt would make
 * disclosure a thing the model usually does. Appending it after generation
 * makes it a thing that always happens, regardless of what the model wrote,
 * which template fired, or whether the AI path ran at all. Same reasoning as
 * the isReplySafe output filter in ai-guards.ts: for anything that has to
 * hold every time, the check belongs in code.
 *
 * It is appended AFTER the empty-render backstop in orchestrate.ts, so a
 * blank reply still gets skipped rather than being rescued into a message
 * that is nothing but a disclaimer.
 */

/**
 * Default wording. Deliberately plain and short. It names the business as
 * the operator of the automation and points at the way out, which is what
 * makes it a disclosure rather than a decoration.
 */
export const DEFAULT_BOT_DISCLOSURE =
  "You're chatting with an automated assistant. Reply STOP to opt out, or ask for a person any time.";

export type DisclosureAction =
  | "DM"
  | "AI_DM"
  | "DM_VIA_COMMENT"
  | "AI_DM_VIA_COMMENT"
  | "PUBLIC_REPLY"
  | "AI_PUBLIC_REPLY"
  | "SKIPPED"
  | (string & {});

/** The private-message actions. Public replies are deliberately absent. */
const DM_ACTIONS = new Set([
  "DM",
  "AI_DM",
  "DM_VIA_COMMENT",
  "AI_DM_VIA_COMMENT",
]);

/**
 * Should this specific outbound message carry the disclosure?
 *
 * `hasPriorBotDm` is whether this person has already received an automated
 * private message on this thread. A comment-triggered DM opens a private
 * conversation by definition, but it is still gated on the same flag: a
 * person who commented twice on two posts is one person, already told once,
 * and telling them again on every comment would be the repetition this
 * module exists to avoid.
 */
export function needsDisclosure(
  action: DisclosureAction,
  hasPriorBotDm: boolean,
): boolean {
  if (!DM_ACTIONS.has(action)) return false;
  return !hasPriorBotDm;
}

/**
 * Append the disclosure, unless the text already carries it.
 *
 * The idempotency check is not paranoia: an operator can put the same
 * sentence in a template, and the AI can echo it out of the conversation
 * history once it has appeared in the thread once. Either would otherwise
 * produce a message that discloses twice in a row.
 *
 * Matching ignores case and collapses whitespace so a template that wrapped
 * the sentence across lines still counts as already disclosed.
 */
export function applyDisclosure(text: string, disclosure: string): string {
  const body = text.trimEnd();
  const wanted = disclosure.trim();
  if (!wanted) return text;

  // Never turn nothing into something. orchestrate.ts skips empty replies
  // before calling this, but if that guard is ever moved or removed, the
  // failure must be a skipped message rather than a customer receiving a
  // bare "you're chatting with an automated assistant" and nothing else.
  if (!body.trim()) return text;

  const normalise = (s: string) => s.toLowerCase().replace(/\s+/g, " ");
  if (normalise(body).includes(normalise(wanted))) return text;

  // Blank line between the reply and the disclaimer so the person reads them
  // as two separate things: the answer they asked for, and a note about who
  // is answering.
  return `${body}\n\n${wanted}`;
}
