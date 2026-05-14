/**
 * Legacy route — kept only to redirect old bookmarks / internal links to the
 * merged account detail page (which now contains the campaigns table). New
 * code should link straight to /dashboard/accounts/[id].
 */
import { redirect } from "next/navigation";

export default async function LegacyCampaignsPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { id } = await params;
  const sp = await searchParams;
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(sp)) {
    if (typeof v === "string") qs.set(k, v);
  }
  const tail = qs.toString();
  redirect(`/dashboard/accounts/${id}${tail ? `?${tail}` : ""}`);
}
