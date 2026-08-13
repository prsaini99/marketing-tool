/**
 * Meta error parsing.
 *
 * Meta puts the actionable reason in `error_user_title` / `error_user_msg`
 * and leaves `message` as something generic like "Invalid parameter". Losing
 * the specific field turns a fixable problem ("Your ad account has no
 * payment method") into a shrug, so these tests pin the precedence order and
 * the non-JSON fallbacks.
 */

import { describe, expect, it } from "vitest";
import { readMetaError } from "@/lib/meta/client";

function res(body: unknown, status = 400): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

describe("readMetaError", () => {
  it("prefers title + user message over the generic message", () => {
    const out = readMetaError(
      res({
        error: {
          message: "Invalid parameter",
          error_user_title: "Payment method needed",
          error_user_msg: "Add a payment method to run ads.",
          code: 100,
        },
      }),
    );
    return out.then((r) => {
      expect(r.message).toContain("Payment method needed");
      expect(r.message).toContain("Add a payment method to run ads.");
      expect(r.message).not.toContain("Invalid parameter");
      expect(r.code).toBe(100);
    });
  });

  it("uses the user message alone when there is no title", async () => {
    const r = await readMetaError(
      res({ error: { message: "Invalid parameter", error_user_msg: "Budget too low." } }),
    );
    expect(r.message).toContain("Budget too low.");
  });

  it("uses the title alone when there is no user message", async () => {
    const r = await readMetaError(
      res({ error: { message: "Invalid parameter", error_user_title: "Budget too low" } }),
    );
    expect(r.message).toContain("Budget too low");
  });

  it("falls back to the generic message when nothing specific exists", async () => {
    const r = await readMetaError(res({ error: { message: "Invalid parameter" } }));
    expect(r.message).toContain("Invalid parameter");
  });

  it("appends code and subcode when present", async () => {
    const r = await readMetaError(
      res({ error: { message: "Nope", code: 190, error_subcode: 460 } }),
    );
    expect(r.message).toContain("190");
    expect(r.message).toContain("460");
  });

  it("appends just the code when there is no subcode", async () => {
    const r = await readMetaError(res({ error: { message: "Nope", code: 10 } }));
    expect(r.message).toContain("(code 10)");
  });

  it("falls back to the HTTP status for a non-JSON body", async () => {
    const r = await readMetaError(new Response("<html>502</html>", { status: 502 }));
    expect(r.message).toContain("502");
    expect(r.code).toBeUndefined();
  });

  it("falls back to the HTTP status when JSON carries no error object", async () => {
    const r = await readMetaError(res({ data: [] }, 500));
    expect(r.message).toContain("500");
  });

  it("never returns an empty message", async () => {
    const r = await readMetaError(res({ error: {} }, 418));
    expect(r.message.length).toBeGreaterThan(0);
  });
});
