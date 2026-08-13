import { CalendarOff } from "lucide-react";

/**
 * Explains an all-zero window instead of leaving a wall of currency zeros on
 * screen.
 *
 * WHY THIS EXISTS. The date picker filters the metrics but not the roster,
 * which is the right behaviour (you manage every campaign you own, not only
 * the ones that spent this week) and a confusing one to look at. Select a
 * window with no delivery and you get 24 rows of "0" next to a LAST EDITED
 * column showing January dates, which reads as "this tool is showing me
 * stale data" when every number on screen is correct.
 *
 * The distinction that matters: 0 is a measurement. "Nothing delivered" is a
 * different statement, and when it is true it is the only thing on the page
 * worth reading. So say it, say when data does exist, and when the cause is
 * knowable say that too.
 */
export function NoDeliveryNotice({
  rangeLabel,
  latestDataAt,
  deliveryReason,
}: {
  /** e.g. "Last 7 days", already lowercased by the caller if needed. */
  rangeLabel: string;
  /** Most recent date we hold any insight for, across all time. */
  latestDataAt: Date | null;
  /**
   * One sentence from describeDeliveryHealth explaining why nothing can
   * deliver, or null when the ad sets look fine and the silence is simply
   * that nobody has run anything.
   */
  deliveryReason: string | null;
}) {
  const daysAgo = latestDataAt
    ? Math.floor((Date.now() - latestDataAt.getTime()) / 86_400_000)
    : null;

  return (
    <div className="mb-5 flex items-start gap-3 rounded-xl border border-warning bg-warning-subtle px-4 py-3.5">
      <CalendarOff className="mt-0.5 h-4 w-4 shrink-0 text-warning" aria-hidden />
      <div className="text-[15px] leading-relaxed">
        <p className="font-semibold text-foreground">
          No delivery in {rangeLabel.toLowerCase()}.
        </p>
        <p className="mt-1 text-muted">
          {latestDataAt ? (
            <>
              Every figure below is genuinely zero for this window, not
              missing. The most recent day with any delivery is{" "}
              <strong className="text-foreground">
                {latestDataAt.toLocaleDateString("en-GB", {
                  day: "numeric",
                  month: "long",
                  year: "numeric",
                })}
              </strong>
              {daysAgo !== null && daysAgo > 0 ? `, ${daysAgo} days ago` : ""}.
            </>
          ) : (
            <>
              No insights have been captured for this account yet. Run a sync,
              or check that the account is selected for sync.
            </>
          )}
        </p>
        {deliveryReason && (
          <p className="mt-1.5 text-muted">{deliveryReason}</p>
        )}
      </div>
    </div>
  );
}
