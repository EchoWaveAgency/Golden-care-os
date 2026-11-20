import { NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabase/server";
import { clinicToday } from "@/lib/format";
import { toCsv } from "@/lib/leads-flow";

export const dynamic = "force-dynamic";
const isDate = (s: string | null) => /^\d{4}-\d{2}-\d{2}$/.test(s ?? "");

const COLUMNS = ["lead_id", "received_at", "name", "phone", "whatsapp_name", "campaign_code", "source", "ad_id", "ad_name", "adset_name", "meta_campaign",
  "utm_source", "utm_medium", "utm_campaign", "message", "agent", "status", "first_contact_at", "response_minutes", "last_follow_up_at", "next_follow_up_at",
  "follow_up_reason", "booking_at", "booking_service", "booking_notes", "last_note", "archived", "updated_at"];

// Runs under the signed-in user's session: lead_export requires lead.export and writes an audit event.
export async function GET(req: Request) {
  const url = new URL(req.url);
  const today = clinicToday();
  const from = isDate(url.searchParams.get("from")) ? url.searchParams.get("from")! : today;
  const to = isDate(url.searchParams.get("to")) ? url.searchParams.get("to")! : today;
  const supabase = supabaseServer();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const { data, error } = await supabase.rpc("lead_export", { p_from: from, p_to: to });
  if (error) return NextResponse.json({ error: /permission/.test(error.message) ? "forbidden" : "failed" }, { status: /permission/.test(error.message) ? 403 : 500 });
  return new NextResponse(toCsv((data ?? []) as Record<string, unknown>[], COLUMNS), {
    headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="golden_friday_leads_${from}_${to}.csv"`, "Cache-Control": "no-store" },
  });
}
