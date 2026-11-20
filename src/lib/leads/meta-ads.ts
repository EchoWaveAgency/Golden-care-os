import "server-only";
import { adminClient } from "@/lib/server/admin";

// Meta Marketing API enrichment: a Click-to-WhatsApp message carries only the ad id. With a token that can read the
// ad account (META_ADS_TOKEN, ads_read), the dispatcher job fills in ad / ad set / campaign names for new ad ids and
// attributes the Golden Friday campaign when the Meta campaign name contains its code (e.g. "GF26-LASER | Nov").
// Runs with the message dispatcher (service role, svc_* functions only). Off when the token is not set.
export function metaAdsEnabled() {
  return Boolean(process.env.META_ADS_TOKEN);
}

type AdInfo = { name?: string; adset?: { name?: string }; campaign?: { name?: string }; error?: { message?: string } };

export async function enrichAdNames(limit = 20) {
  if (!metaAdsEnabled()) return { skipped: "META_ADS_TOKEN not set" };
  const db = adminClient();
  const { data: ids, error } = await db.rpc("svc_lead_ads_pending", { p_limit: limit });
  if (error) throw new Error(error.message);
  const version = process.env.WHATSAPP_API_VERSION ?? "v21.0";
  let updated = 0, failed = 0;
  for (const adId of (ids ?? []) as string[]) {
    if (!/^\d{5,30}$/.test(adId)) continue;
    try {
      const res = await fetch(`https://graph.facebook.com/${version}/${adId}?fields=name,adset{name},campaign{name}`, {
        headers: { Authorization: `Bearer ${process.env.META_ADS_TOKEN}` }, signal: AbortSignal.timeout(8_000),
      });
      const j = (await res.json().catch(() => ({}))) as AdInfo;
      if (!res.ok || j.error) { failed++; continue; }
      const { data: n } = await db.rpc("svc_lead_set_ad_names", { p_ad_id: adId, p_ad: j.name ?? null, p_adset: j.adset?.name ?? null, p_campaign: j.campaign?.name ?? null });
      updated += Number(n ?? 0);
    } catch {
      failed++;
    }
  }
  return { ads: (ids ?? []).length, leadsUpdated: updated, failed };
}
