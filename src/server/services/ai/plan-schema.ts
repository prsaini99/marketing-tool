/**
 * JSON Schema for a CampaignPlan.
 *
 * Shared by the one-shot generator and the agent's submit_plan tool, so the
 * two cannot drift into accepting different shapes. validatePlan in
 * src/lib/campaign-plan.ts is the real gate; this only constrains what the
 * model may emit.
 *
 * NOT strict-mode. OpenAI's strict schemas require every property to appear
 * in `required`, which would force the model to emit every optional field
 * (endTime, promotedObject, spendCapCents) on every object even when they
 * must be absent. For this shape "absent" means something different from
 * "null": an ad set with no budget key is a campaign-budget ad set, whereas
 * budgetType null is what a strict emitter produces when it has nothing to
 * say. A looser schema plus a strong validator beats a strict schema that
 * forces meaningless keys.
 */
export const PLAN_JSON_SCHEMA = {
    type: "object",
    additionalProperties: false,
    required: ["campaign", "adSets"],
    properties: {
      rationale: { type: "string" },
      campaign: {
        type: "object",
        additionalProperties: false,
        required: ["name", "objective", "specialAdCategories", "budgetType"],
        properties: {
          name: { type: "string" },
          objective: {
            type: "string",
            enum: [
              "OUTCOME_AWARENESS",
              "OUTCOME_TRAFFIC",
              "OUTCOME_ENGAGEMENT",
              "OUTCOME_LEADS",
              "OUTCOME_APP_PROMOTION",
              "OUTCOME_SALES",
            ],
          },
          specialAdCategories: { type: "array", items: { type: "string" } },
          budgetType: { type: ["string", "null"], enum: ["daily", "lifetime", null] },
          budgetCents: { type: "integer" },
          bidStrategy: { type: "string" },
          spendCapCents: { type: "integer" },
          stopTime: { type: "string" },
        },
      },
      adSets: {
        type: "array",
        minItems: 1,
        items: {
          type: "object",
          additionalProperties: false,
          required: ["name", "optimizationGoal", "targeting", "ads"],
          properties: {
            name: { type: "string" },
            optimizationGoal: { type: "string" },
            billingEvent: { type: "string" },
            budgetType: { type: ["string", "null"], enum: ["daily", "lifetime", null] },
            budgetCents: { type: "integer" },
            startTime: { type: "string" },
            endTime: { type: "string" },
            targeting: {
              type: "object",
              additionalProperties: false,
              required: ["countries", "ageMin", "ageMax", "genders", "placements"],
              properties: {
                countries: { type: "array", items: { type: "string" } },
                ageMin: { type: "integer" },
                ageMax: { type: "integer" },
                genders: { type: ["array", "null"], items: { type: "integer" } },
                placements: { type: ["object", "null"], additionalProperties: true },
                includedAudienceIds: { type: "array", items: { type: "string" } },
                excludedAudienceIds: { type: "array", items: { type: "string" } },
              },
            },
            promotedObject: {
              type: "object",
              additionalProperties: false,
              properties: {
                pixelId: { type: "string" },
                customEventType: { type: "string" },
                customConversionId: { type: "string" },
                pageId: { type: "string" },
                applicationId: { type: "string" },
                objectStoreUrl: { type: "string" },
              },
            },
            ads: {
              type: "array",
              minItems: 1,
              items: {
                type: "object",
                additionalProperties: false,
                required: ["name", "primaryText", "headline", "mediaType"],
                properties: {
                  name: { type: "string" },
                  primaryText: { type: "string" },
                  headline: { type: "string" },
                  description: { type: "string" },
                  linkUrl: { type: "string" },
                  callToAction: { type: "string" },
                  mediaType: { type: "string", enum: ["image", "video"] },
                  imageHash: { type: "string" },
                  videoId: { type: "string" },
                },
              },
            },
          },
        },
      },
    },
  } as const;
