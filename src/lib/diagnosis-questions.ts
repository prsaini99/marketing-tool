/**
 * The canned diagnosis questions — pure module, no I/O.
 *
 * WHY THIS EXISTS AT ALL, given the product already has a chat assistant:
 * a chat box asks the user to know what to ask. Most people opening a
 * dashboard have the same five questions and no appetite for phrasing them.
 * Turning those five into buttons converts a feature people admire into one
 * they use — the answer arrives without anyone composing a prompt.
 *
 * Each question carries its own instruction, not just a label, because the
 * useful part is the ANALYTICAL FRAME rather than the words. "Why did CPA
 * rise?" answered well means: check whether conversions fell or spend rose,
 * name the campaigns responsible, and say what to look at — not a paragraph
 * restating the number the user can already see.
 *
 * Every prompt ends with the same anti-fabrication clause. These run against
 * a context blob that may be thin or stale, and a model asked "why did X
 * happen?" will happily invent a cause rather than answer "the data doesn't
 * say". Making "I can't tell from this data" an explicitly acceptable answer
 * is what keeps the feature trustworthy on exactly the accounts where it is
 * most tempting to bluff.
 */

export interface DiagnosisQuestion {
  id: string;
  /** Button label — short, in the user's words. */
  label: string;
  /** One-line description for tooltips / empty state. */
  hint: string;
  /** The analytical instruction handed to the model. */
  instruction: string;
}

const HONESTY_CLAUSE = [
  "Ground every claim in the numbers provided. Never invent a figure, a",
  "date, or a cause that the data does not support. If the data is too thin",
  "or too stale to answer, say so plainly and say what would be needed.",
  "That is a better answer than a confident guess.",
].join(" ");

const FORMAT_CLAUSE = [
  "Answer in at most 120 words. Lead with the direct answer in one sentence,",
  "then at most three short bullets of supporting detail. No preamble, no",
  "restating the question.",
].join(" ");

export const DIAGNOSIS_QUESTIONS: DiagnosisQuestion[] = [
  {
    id: "what_changed",
    label: "What changed this week?",
    hint: "Week-on-week movement and what drove it",
    instruction: [
      "Compare this period against the previous one. Identify the largest",
      "genuine movements in spend, conversions, CPA and CTR, and name the",
      "specific campaigns responsible. Ignore movements small enough to be",
      "noise.",
    ].join(" "),
  },
  {
    id: "cpa_rose",
    label: "Why did CPA move?",
    hint: "Whether spend rose or conversions fell, and where",
    instruction: [
      "Explain the change in cost per acquisition. Decompose it: did spend",
      "rise, did conversions fall, or both? Attribute the change to specific",
      "campaigns rather than describing the account average. If CPA is",
      "stable, say so rather than manufacturing a trend.",
    ].join(" "),
  },
  {
    id: "budget_waste",
    label: "Where is budget being wasted?",
    hint: "Spend with little or nothing to show for it",
    instruction: [
      "Identify campaigns spending meaningfully with little or no return:",
      "high spend and no conversions, or a CPA far worse than the account",
      "average. Also flag active campaigns with no delivery at all, which",
      "usually means a budget, audience or scheduling problem. Rank by how",
      "much money is at stake.",
    ].join(" "),
  },
  {
    id: "what_to_scale",
    label: "What should I scale?",
    hint: "The campaigns worth more budget",
    instruction: [
      "Identify campaigns performing well enough to deserve more budget:",
      "better-than-average CPA or ROAS with enough spend behind them to",
      "trust. Say explicitly if nothing has earned a budget increase yet.",
      "Recommending a scale-up on thin data is how money gets lost.",
    ].join(" "),
  },
  {
    id: "needs_attention",
    label: "What needs attention first?",
    hint: "The single most urgent thing today",
    instruction: [
      "Name the one thing in this account that most needs a human today, and",
      "why. Prefer problems that are costing money now over opportunities.",
      "Give one concrete next action.",
    ].join(" "),
  },
];

export function getQuestion(id: string): DiagnosisQuestion | null {
  return DIAGNOSIS_QUESTIONS.find((q) => q.id === id) ?? null;
}

/**
 * Assemble the full prompt: the question's frame, then the shared format and
 * honesty clauses, then the data.
 *
 * The context blob goes LAST. Instructions ahead of a long data payload are
 * followed more reliably than instructions buried after it.
 */
export interface PromptContextOptions {
  /** ISO currency code, e.g. "INR". Stated so the model picks the symbol. */
  currency: string;
  /**
   * Whether this account has ANY revenue recorded in the window.
   *
   * Load-bearing. Lead-gen accounts never report revenue, so ROAS is
   * structurally 0 for all of them. Without being told, a model reads
   * "spend ₹10,925, revenue 0, ROAS 0" as catastrophic and recommends
   * pausing a campaign that is in fact converting well on cost-per-lead —
   * confidently destructive advice, produced from data that never claimed
   * what the model assumed.
   */
  revenueTracked: boolean;
}

export function buildDiagnosisPrompt(
  question: DiagnosisQuestion,
  contextJson: string,
  opts: PromptContextOptions,
): string {
  const unitsClause = [
    `All monetary amounts are already in ${opts.currency}, not in minor`,
    `units. Use them exactly as given and never multiply or divide them.`,
    `Format them with the ${opts.currency} symbol and thousands separators.`,
  ].join(" ");

  const revenueClause = opts.revenueTracked
    ? "Revenue is tracked on this account, so ROAS is meaningful."
    : [
        "IMPORTANT: this account records NO revenue. It is a lead-generation",
        "account. ROAS and revenue are therefore structurally zero and carry",
        "NO information. Judge performance on cost per conversion (CPA), CTR",
        "and conversion volume only. Never describe zero revenue or zero ROAS",
        "as poor performance, and never recommend pausing anything on that",
        "basis.",
      ].join(" ");

  return [
    question.instruction,
    "",
    FORMAT_CLAUSE,
    "",
    HONESTY_CLAUSE,
    "",
    unitsClause,
    "",
    revenueClause,
    "",
    "ACCOUNT DATA (JSON):",
    contextJson,
  ].join("\n");
}
