/**
 * The ad format catalogue: seventeen static layouts documented as working on
 * Meta in 2026, each carrying the four things the studio needs to act on it —
 * the frame anatomy as a prompt fragment, the copy slots the image must
 * render, the geometry for the schematic preview, and what it needs supplied.
 *
 * Imports NOTHING, same discipline as studio-prompt.ts: a pure data module is
 * testable with zero setup and safe to import from both server and client.
 *
 * `frame` is deliberately data rather than an SVG per format. One component
 * renders any format from these blocks, so adding a format is a data edit and
 * the geometry is unit-testable.
 */

export type FormatIntent = "awareness" | "consideration" | "conversion";

/** What the operator must supply before this format can be generated. */
export type FormatNeeds = "none" | "product" | "proof";

export type CopySlot =
  | "headline"
  | "subhead"
  | "offer"
  | "cta"
  | "proof"
  | "attribution"
  | "source";

export type BlockKind = "headline" | "body" | "media" | "cta" | "accent";

/** A rectangle in a 0-100 square canvas, origin top-left. */
export interface FrameBlock {
  x: number;
  y: number;
  w: number;
  h: number;
  kind: BlockKind;
  label?: string;
}

export interface AdFormat {
  id: string;
  name: string;
  intent: FormatIntent;
  needs: FormatNeeds;
  /** One line under the schematic, written for the operator. */
  anatomy: string;
  /** Frame instruction written for the image model. */
  layout: string;
  /** Schematic geometry. */
  frame: FrameBlock[];
  /** Which strings the image must carry. Shapes the copy stage's output. */
  slots: CopySlot[];
  /** Seeds the copy stage when the brief is empty. */
  defaultAngle: string;
  /**
   * A concrete brief for this format, shown as the field's placeholder.
   * Every format carries one: an example of the real thing invites a real
   * brief, where an empty box invites an empty box.
   */
  briefExample: string;
  /** Shown as a hint under the picker. */
  failureMode: string;
  /**
   * The register this format is built in, which decides what art directions
   * it can be varied with. Declared here rather than imported from
   * art-directions.ts so this module stays import-free; the two unions are
   * identical and a catalogue test asserts every look is servable.
   */
  look: "designed" | "photographic" | "raw";
}

export const AD_FORMATS: AdFormat[] = [
  {
    id: "problem-solution",
    name: "Problem → solution",
    intent: "awareness",
    needs: "product",
    anatomy: "Pain headline top-left, product hero right, CTA pill bottom-left.",
    layout:
      "Lay out as a problem-solution ad: the pain stated as a headline across the upper left, the product photographed large on the right as the answer, and a call-to-action pill in the lower left. Leave the right third clear for the product.",
    frame: [
      { x: 8, y: 10, w: 42, h: 14, kind: "headline", label: "pain" },
      { x: 8, y: 28, w: 34, h: 8, kind: "body" },
      { x: 56, y: 22, w: 36, h: 50, kind: "media", label: "product" },
      { x: 8, y: 74, w: 26, h: 12, kind: "cta" },
    ],
    slots: ["headline", "subhead", "cta"],
    defaultAngle:
      "the single most common frustration this product removes, stated plainly",
    briefExample: "Sarees that don't need ironing before every wear",
    failureMode: "A generic pain. Name the specific moment it goes wrong.",
    look: "photographic",
  },
  {
    id: "before-after",
    name: "Before / after split",
    intent: "consideration",
    needs: "proof",
    anatomy: "Vertical split, identical angle both sides, timeframe labelled.",
    layout:
      "Lay out as a before-and-after split: the frame divided vertically down the middle, the same subject on both sides at an identical angle, distance and lighting, with small labels reading before and after and the elapsed time noted beneath.",
    frame: [
      { x: 6, y: 8, w: 40, h: 62, kind: "media", label: "before" },
      { x: 54, y: 8, w: 40, h: 62, kind: "media", label: "after" },
      { x: 6, y: 76, w: 88, h: 10, kind: "headline" },
    ],
    slots: ["headline", "proof"],
    defaultAngle: "the visible change, with the honest timeframe it took",
    briefExample: "Skin after eight weeks on the vitamin C serum",
    failureMode:
      "Any shift in angle, lighting or distance between the halves reads as a lie.",
    look: "raw",
  },
  {
    id: "quote-card",
    name: "Quote card",
    intent: "consideration",
    needs: "proof",
    anatomy: "Quote fills the top 60%, product thumbnail and attribution below.",
    layout:
      "Lay out as a testimonial quote card: one customer quote set large across the top sixty percent of the frame, and beneath it a small product thumbnail, a five-star row and the attribution line. The quote is the hero; the product is secondary.",
    frame: [
      { x: 8, y: 12, w: 84, h: 40, kind: "headline", label: "quote" },
      { x: 8, y: 62, w: 18, h: 18, kind: "media" },
      { x: 32, y: 66, w: 40, h: 6, kind: "body", label: "attribution" },
      { x: 32, y: 76, w: 22, h: 5, kind: "accent", label: "stars" },
    ],
    slots: ["headline", "attribution"],
    defaultAngle: "one customer's specific outcome, in their own register",
    briefExample: "Priya's review of the sleep tea",
    failureMode: "Past about fifteen words it stops being a graphic.",
    look: "designed",
  },
  {
    id: "review-stack",
    name: "Stack of reviews",
    intent: "consideration",
    needs: "proof",
    anatomy: "Three or four review snippets stacked, aggregate rating callout.",
    layout:
      "Lay out as a stack of reviews: three or four short review snippets in separate rounded cards stacked down the left, a small product thumbnail on the right, and an aggregate rating callout. Each snippet praises a different thing.",
    frame: [
      { x: 8, y: 10, w: 56, h: 16, kind: "body" },
      { x: 8, y: 30, w: 56, h: 16, kind: "body" },
      { x: 8, y: 50, w: 56, h: 16, kind: "body" },
      { x: 70, y: 28, w: 22, h: 22, kind: "media" },
      { x: 8, y: 74, w: 40, h: 10, kind: "accent", label: "aggregate rating" },
    ],
    slots: ["headline", "proof", "attribution"],
    defaultAngle: "the range of reasons people rate this well, not one repeated",
    briefExample: "What buyers keep saying about the running shoes",
    failureMode: "Snippets that all praise the same thing read as written by one hand.",
    look: "designed",
  },
  {
    id: "founder-quote",
    name: "Founder quote",
    intent: "awareness",
    needs: "proof",
    anatomy: "Founder photo left, their words right, product below, attribution.",
    layout:
      "Lay out as a founder quote: a candid, non-studio photograph of the founder on the left, their quote set beside it on the right, the product small beneath, and an attribution line reading from the founder. The photo should look like a selfie or a snapshot, never a corporate headshot.",
    frame: [
      { x: 8, y: 14, w: 32, h: 42, kind: "media", label: "founder" },
      { x: 46, y: 18, w: 46, h: 26, kind: "headline", label: "quote" },
      { x: 46, y: 50, w: 30, h: 6, kind: "body", label: "attribution" },
      { x: 8, y: 66, w: 84, h: 18, kind: "media", label: "product" },
    ],
    slots: ["headline", "attribution"],
    defaultAngle: "why the founder made this, in one sentence they would say aloud",
    briefExample: "Why I started cold-pressing oils in my kitchen",
    failureMode:
      "A professional headshot. Selfies and candids test 30-50% better.",
    look: "raw",
  },
  {
    id: "us-vs-them",
    name: "Us vs them",
    intent: "consideration",
    needs: "product",
    anatomy: "Two labelled columns, old way against new way, product on the right.",
    layout:
      "Lay out as a two-column comparison: the left column labelled with the old way and the right column with the new, four to six paired rows between them, and the product sitting in the right column. Give the right column the brand's accent colour and the left a muted neutral.",
    frame: [
      { x: 8, y: 8, w: 38, h: 8, kind: "body", label: "old" },
      { x: 54, y: 8, w: 38, h: 8, kind: "accent", label: "new" },
      { x: 8, y: 20, w: 38, h: 52, kind: "body" },
      { x: 54, y: 20, w: 38, h: 52, kind: "media" },
      { x: 30, y: 80, w: 40, h: 10, kind: "headline" },
    ],
    slots: ["headline"],
    defaultAngle: "the specific habit this replaces, named rather than implied",
    briefExample: "Our steel bottle against the plastic one it replaces",
    failureMode: "A strawman old way. Name the real alternative behaviour.",
    look: "designed",
  },
  {
    id: "benefit-list",
    name: "Numbered benefit list",
    intent: "consideration",
    needs: "product",
    anatomy: "Four numbered outcome rows on the left, product hero on the right.",
    layout:
      "Lay out as a numbered benefit list: four numbered rows down the left, each a short outcome-worded benefit with a circled numeral, and the product photographed tall on the right. Never more than five rows. A call-to-action pill sits at the lower left.",
    frame: [
      { x: 8, y: 14, w: 8, h: 8, kind: "accent" },
      { x: 20, y: 15, w: 34, h: 6, kind: "body" },
      { x: 8, y: 30, w: 8, h: 8, kind: "accent" },
      { x: 20, y: 31, w: 34, h: 6, kind: "body" },
      { x: 8, y: 46, w: 8, h: 8, kind: "accent" },
      { x: 20, y: 47, w: 34, h: 6, kind: "body" },
      { x: 64, y: 14, w: 28, h: 56, kind: "media", label: "product" },
      { x: 8, y: 78, w: 30, h: 10, kind: "cta" },
    ],
    slots: ["headline", "subhead", "cta"],
    defaultAngle: "the four outcomes a buyer would list if asked why they kept it",
    briefExample: "Four reasons the air purifier pays for itself",
    failureMode: "Seven or more items. Four to five is the readable ceiling.",
    look: "designed",
  },
  {
    id: "product-callouts",
    name: "Product + callouts",
    intent: "consideration",
    needs: "product",
    anatomy: "Product centred, four feature callouts pointing inward, CTA at base.",
    layout:
      "Lay out as an annotated product shot: the product centred and large, four short feature callouts placed at the corners with thin leader lines pointing in to the part each describes, and a call to action along the base. The callouts must never visually outweigh the product.",
    frame: [
      { x: 32, y: 26, w: 36, h: 40, kind: "media", label: "product" },
      { x: 6, y: 16, w: 22, h: 6, kind: "body" },
      { x: 72, y: 16, w: 22, h: 6, kind: "body" },
      { x: 6, y: 62, w: 22, h: 6, kind: "body" },
      { x: 72, y: 62, w: 22, h: 6, kind: "body" },
      { x: 32, y: 80, w: 36, h: 9, kind: "cta" },
    ],
    slots: ["headline", "subhead", "cta"],
    defaultAngle: "the four details that justify the price, each tied to a part",
    briefExample: "Every feature of the 40,000mAh power bank",
    failureMode: "Callouts louder than the product they annotate.",
    look: "photographic",
  },
  {
    id: "checkerboard",
    name: "Checkerboard",
    intent: "consideration",
    needs: "product",
    anatomy: "Four panels: headline, product, benefit, lifestyle shot.",
    layout:
      "Lay out as a four-panel checkerboard: headline top-left, product photograph top-right, a benefit statement bottom-left, and a lifestyle usage shot bottom-right, alternating text and image on the diagonal. One panel must clearly lead.",
    frame: [
      { x: 6, y: 8, w: 42, h: 38, kind: "headline" },
      { x: 52, y: 8, w: 42, h: 38, kind: "media" },
      { x: 6, y: 52, w: 42, h: 38, kind: "accent" },
      { x: 52, y: 52, w: 42, h: 38, kind: "media" },
    ],
    slots: ["headline", "subhead"],
    defaultAngle: "one claim and one proof, paired against two views of the product",
    briefExample: "The winter jacket, four ways",
    failureMode: "Four panels all shouting. Pick the one that leads.",
    look: "photographic",
  },
  {
    id: "stat-drop",
    name: "Stat drop",
    intent: "awareness",
    needs: "none",
    anatomy: "One statistic at maximum scale, a supporting line, source line beneath.",
    layout:
      "Lay out as a statistic drop: a single number or claim set at the largest type the frame allows across the middle, a short supporting line beneath it, and a small source attribution line at the base. Purely typographic — no product photograph.",
    frame: [
      { x: 12, y: 26, w: 76, h: 26, kind: "headline", label: "the number" },
      { x: 24, y: 58, w: 52, h: 8, kind: "body" },
      { x: 34, y: 72, w: 32, h: 5, kind: "body", label: "source" },
    ],
    slots: ["headline", "subhead", "source"],
    defaultAngle:
      "the one number from the brief that makes the case on its own — the figure has to come from the brief or the brand kit, since nothing here may invent one",
    briefExample: "92% of buyers reorder within a month",
    failureMode: "No source line. An unattributed number reads as exaggeration.",
    look: "designed",
  },
  {
    id: "bold-statement",
    name: "Bold statement",
    intent: "awareness",
    needs: "none",
    anatomy: "One declarative claim filling the frame, brand mark, nothing else.",
    layout:
      "Lay out as a bold statement: one declarative sentence of ten words or fewer set at hero scale filling most of the frame, with the brand mark small at the base and almost nothing else in the composition. Generous negative space.",
    frame: [
      { x: 10, y: 22, w: 80, h: 14, kind: "headline" },
      { x: 10, y: 40, w: 62, h: 14, kind: "headline" },
      { x: 10, y: 78, w: 24, h: 7, kind: "accent", label: "brand" },
    ],
    slots: ["headline"],
    defaultAngle: "the claim this brand would defend in an argument",
    briefExample: "The last mattress you'll buy this decade",
    failureMode: "A claim nobody could contest. Confidence without specificity.",
    look: "designed",
  },
  {
    id: "offer-stack",
    name: "Offer stack",
    intent: "conversion",
    needs: "none",
    anatomy: "Offer figure at hero scale, inclusions, price anchor, CTA, deadline.",
    layout:
      "Lay out as an offer stack: the offer figure at hero scale across the top, a short list of what is included beneath it on the left, the anchor price struck through beside that list, a call-to-action pill, and the deadline as a small line at the base. Festive or seasonal decoration is welcome here if the occasion calls for it.",
    frame: [
      { x: 8, y: 10, w: 84, h: 20, kind: "headline", label: "offer" },
      { x: 8, y: 36, w: 44, h: 26, kind: "body", label: "inclusions" },
      { x: 60, y: 36, w: 32, h: 26, kind: "media" },
      { x: 8, y: 68, w: 32, h: 12, kind: "cta" },
      { x: 48, y: 72, w: 44, h: 6, kind: "body", label: "deadline" },
    ],
    slots: ["headline", "offer", "subhead", "cta"],
    defaultAngle: "the offer as it stands, with a real reason it ends",
    briefExample: "Diwali sale, FLAT 40% off, ends Sunday",
    failureMode: "Manufactured urgency. Tie the deadline to something true.",
    look: "designed",
  },
  {
    id: "advertorial",
    name: "Advertorial card",
    intent: "awareness",
    needs: "none",
    anatomy: "Editorial headline, a real paragraph, inline image, byline.",
    layout:
      "Lay out as a small editorial card rather than an advertisement: an editorial headline in a serif at the top, two or three lines of body copy set at genuinely readable size beneath it, a small inline image, and a byline. It should read like a magazine clipping.",
    frame: [
      { x: 8, y: 10, w: 62, h: 12, kind: "headline" },
      { x: 8, y: 26, w: 84, h: 5, kind: "body" },
      { x: 8, y: 34, w: 84, h: 5, kind: "body" },
      { x: 8, y: 42, w: 70, h: 5, kind: "body" },
      { x: 8, y: 54, w: 42, h: 26, kind: "media" },
      { x: 56, y: 54, w: 36, h: 6, kind: "accent", label: "byline" },
    ],
    slots: ["headline", "subhead", "attribution"],
    defaultAngle: "the thing a buyer must understand before the product makes sense",
    briefExample: "Why cold-pressed oil smokes less than refined",
    failureMode: "Editorial styling with nothing worth reading inside it.",
    look: "designed",
  },
  {
    id: "platform-native",
    name: "Platform native",
    intent: "awareness",
    needs: "none",
    anatomy: "Post chrome at top, content in the middle, reaction row at the base.",
    layout:
      "Lay out to resemble an organic social post: a small avatar and handle across the top, the content filling the middle, and a row of reaction icons at the base. Plain and unstyled, as though screenshotted rather than designed. Never imitate a platform's own notices or system messages.",
    frame: [
      { x: 8, y: 8, w: 10, h: 10, kind: "accent", label: "avatar" },
      { x: 22, y: 10, w: 34, h: 6, kind: "body", label: "handle" },
      { x: 8, y: 24, w: 84, h: 50, kind: "media" },
      { x: 8, y: 80, w: 8, h: 8, kind: "accent" },
      { x: 20, y: 80, w: 8, h: 8, kind: "accent" },
      { x: 32, y: 80, w: 8, h: 8, kind: "accent" },
    ],
    slots: ["headline", "subhead"],
    defaultAngle: "the thing a happy customer would post unprompted",
    briefExample: "A customer's unboxing post about the gift set",
    failureMode:
      "Crossing from native styling into impersonating a platform notice.",
    look: "raw",
  },
  {
    id: "sticky-note",
    name: "Sticky-note callout",
    intent: "awareness",
    needs: "product",
    anatomy: "Plain phone photo with two rotated handwritten notes over it.",
    layout:
      "Lay out as a plain, unstyled phone photograph of the product with two small sticky notes stuck over it at slight angles, each carrying a short handwritten benefit in real handwriting with uneven baselines. No other graphic chrome, no designed type.",
    frame: [
      { x: 6, y: 8, w: 88, h: 62, kind: "media", label: "phone photo" },
      { x: 12, y: 46, w: 30, h: 22, kind: "accent", label: "note" },
      { x: 56, y: 34, w: 30, h: 22, kind: "accent", label: "note" },
      { x: 20, y: 78, w: 60, h: 8, kind: "headline" },
    ],
    slots: ["headline", "subhead"],
    defaultAngle: "the two things a friend would point out about this",
    briefExample: "Three things people miss about the beard trimmer",
    failureMode: "A neat script font on a perfect rectangle. It must look handmade.",
    look: "raw",
  },
  {
    id: "anti-ad",
    name: "Anti-ad",
    intent: "awareness",
    needs: "none",
    anatomy: "Deliberately crude drawing or type, unbranded, no polish anywhere.",
    layout:
      "Lay out as something that does not look like an advertisement at all: a deliberately crude hand-drawn illustration or plain unstyled type on a flat background, no brand polish, no CTA button, no designed layout. It should look like someone made it in two minutes and meant it.",
    frame: [
      { x: 10, y: 14, w: 56, h: 10, kind: "headline" },
      { x: 14, y: 34, w: 72, h: 40, kind: "media", label: "crude drawing" },
      { x: 10, y: 82, w: 40, h: 7, kind: "body" },
    ],
    slots: ["headline", "subhead"],
    defaultAngle: "the honest, slightly self-deprecating truth about this product",
    briefExample: "Our packaging is ugly. The coffee isn't.",
    failureMode:
      "A brand with no established voice trying it. Reads as a mistake, not a joke.",
    look: "raw",
  },
  {
    id: "benefit-timeline",
    name: "Benefit timeline",
    intent: "conversion",
    needs: "product",
    anatomy: "Horizontal axis with three milestones alternating above and below.",
    layout:
      "Lay out as a horizontal timeline: a rule across the middle of the frame with three milestone markers on it, each labelled with an elapsed time and the outcome at that point, the labels alternating above and below the rule. The product sits small at one end. A call-to-action pill sits at the base beneath the timeline.",
    frame: [
      { x: 8, y: 48, w: 84, h: 3, kind: "accent", label: "axis" },
      { x: 16, y: 44, w: 9, h: 9, kind: "accent" },
      { x: 46, y: 44, w: 9, h: 9, kind: "accent" },
      { x: 76, y: 44, w: 9, h: 9, kind: "accent" },
      { x: 10, y: 26, w: 24, h: 12, kind: "body" },
      { x: 40, y: 62, w: 24, h: 12, kind: "body" },
      { x: 70, y: 26, w: 24, h: 12, kind: "body" },
      { x: 30, y: 80, w: 40, h: 8, kind: "headline" },
      { x: 38, y: 90, w: 24, h: 8, kind: "cta" },
    ],
    slots: ["headline", "subhead", "cta"],
    defaultAngle: "what changes at day one, week two and month three",
    briefExample: "What the protein does at week one, four and twelve",
    failureMode:
      "Promising a date the product cannot hit. This one invites refunds.",
    look: "designed",
  },
];

/** Null for an unknown id — the caller decides whether that is an error. */
export function getFormat(id: string): AdFormat | null {
  return AD_FORMATS.find((f) => f.id === id) ?? null;
}
