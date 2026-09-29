import { NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabase/server";
import { monthRange, profitCsv, type ProfitRow } from "@/lib/reports";

export const dynamic = "force-dynamic";
const isDate = (s: string | null) => /^\d{4}-\d{2}-\d{2}$/.test(s ?? "");

// Runs under the signed-in user's session: the database returns nothing without reports.finance.
export async function GET(req: Request) {
  const url = new URL(req.url);
  const def = monthRange();
  const from = isDate(url.searchParams.get("from")) ? url.searchParams.get("from")! : def.from;
  const to = isDate(url.searchParams.get("to")) ? url.searchParams.get("to")! : def.to;
  const lang = url.searchParams.get("lang") === "en" ? "en" : "ar";
  const supabase = supabaseServer();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const { data, error } = await supabase.rpc("report_profitability", { p_from: from, p_to: to, p_branch: null });
  if (error) return NextResponse.json({ error: "failed" }, { status: 500 });
  return new NextResponse(profitCsv((data ?? []) as ProfitRow[], lang), {
    headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="profitability_${from}_${to}.csv"`, "Cache-Control": "no-store" },
  });
}
