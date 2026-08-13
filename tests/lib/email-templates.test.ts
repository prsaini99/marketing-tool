/**
 * Email template builders — pure, so cheap to pin down.
 *
 * The property that matters most here is escaping. Alert bodies are LLM
 * output and entity names are Meta-supplied, so both are untrusted strings
 * heading into an HTML document. A campaign literally named
 * `<script>` must not become markup.
 */

import { describe, expect, it } from "vitest";
import {
  buildAlertDigestEmail,
  buildTestEmail,
  buildWeeklyReportEmail,
} from "@/lib/email/templates";

const alert = {
  severity: "high",
  title: "Spend dropped 65% yesterday",
  body: "Spend fell from ₹12,000 to ₹4,200.",
  entityName: "Summer Sale",
};

describe("buildAlertDigestEmail", () => {
  it("puts the account name and count in the subject", () => {
    const out = buildAlertDigestEmail({
      accountName: "Acme India",
      forDate: "2026-08-11",
      alerts: [alert, { ...alert, title: "CTR down" }],
    });
    expect(out.subject).toContain("Acme India");
    expect(out.subject).toContain("2 alerts");
  });

  it("uses the singular form for one alert", () => {
    const out = buildAlertDigestEmail({
      accountName: "Acme",
      forDate: "2026-08-11",
      alerts: [alert],
    });
    expect(out.subject).toContain("1 alert");
    expect(out.subject).not.toContain("1 alerts");
  });

  it("includes every alert in both html and text arms", () => {
    const out = buildAlertDigestEmail({
      accountName: "Acme",
      forDate: "2026-08-11",
      alerts: [alert, { ...alert, title: "CTR down 30%" }],
    });
    for (const t of ["Spend dropped 65% yesterday", "CTR down 30%"]) {
      expect(out.html).toContain(t);
      expect(out.text).toContain(t);
    }
  });

  it("escapes untrusted titles, bodies and entity names", () => {
    const out = buildAlertDigestEmail({
      accountName: "Acme",
      forDate: "2026-08-11",
      alerts: [
        {
          severity: "high",
          title: "<script>alert(1)</script>",
          body: "a & b < c",
          entityName: '"quoted"',
        },
      ],
    });
    expect(out.html).not.toContain("<script>");
    expect(out.html).toContain("&lt;script&gt;");
    expect(out.html).toContain("a &amp; b &lt; c");
    expect(out.html).toContain("&quot;quoted&quot;");
  });

  it("omits the CTA when no dashboard url is supplied", () => {
    const out = buildAlertDigestEmail({
      accountName: "Acme",
      forDate: "2026-08-11",
      alerts: [alert],
    });
    expect(out.html).not.toContain("<a href");
  });

  it("includes the CTA when a dashboard url is supplied", () => {
    const out = buildAlertDigestEmail({
      accountName: "Acme",
      forDate: "2026-08-11",
      alerts: [alert],
      dashboardUrl: "https://app.example.com/dashboard/alerts",
    });
    expect(out.html).toContain("https://app.example.com/dashboard/alerts");
    expect(out.text).toContain("https://app.example.com/dashboard/alerts");
  });
});

describe("buildWeeklyReportEmail", () => {
  it("renders headings, bullets and paragraphs", () => {
    const out = buildWeeklyReportEmail({
      accountName: "Acme",
      periodLabel: "Aug 4–10",
      bodyMarkdown: "## Summary\n\nSpend rose.\n\n- Point one\n- Point two",
    });
    expect(out.html).toContain("Summary");
    expect(out.html).toContain("<ul");
    expect(out.html).toContain("Point one");
    expect(out.html).toContain("<p");
  });

  it("converts **bold** without letting raw html through", () => {
    const out = buildWeeklyReportEmail({
      accountName: "Acme",
      periodLabel: "Aug 4–10",
      bodyMarkdown: "ROAS was **2.4x** but <b>this</b> is not markup",
    });
    expect(out.html).toContain("<strong");
    expect(out.html).toContain("2.4x");
    expect(out.html).not.toContain("<b>this</b>");
    expect(out.html).toContain("&lt;b&gt;");
  });

  it("keeps the raw markdown in the text arm", () => {
    const md = "## Summary\n\nSpend rose 12%.";
    const out = buildWeeklyReportEmail({
      accountName: "Acme",
      periodLabel: "Aug 4–10",
      bodyMarkdown: md,
    });
    expect(out.text).toContain(md);
  });
});

describe("buildTestEmail", () => {
  it("names the account and escapes it", () => {
    const out = buildTestEmail("<Acme>");
    expect(out.html).toContain("&lt;Acme&gt;");
    expect(out.subject).toContain("<Acme>"); // subject is plain text, not html
    expect(out.text).toContain("<Acme>");
  });
});
