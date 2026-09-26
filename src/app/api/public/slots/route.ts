import { NextResponse } from "next/server";
import { getSlots } from "@/lib/site/api";

export const dynamic = "force-dynamic";

// Real-time availability for the booking widget (never cached).
export async function GET(req: Request) {
  const url = new URL(req.url);
  const doctor = url.searchParams.get("doctor") ?? "";
  const from = url.searchParams.get("from") ?? "";
  if (!/^[0-9a-f-]{36}$/i.test(doctor) || !/^\d{4}-\d{2}-\d{2}$/.test(from)) {
    return NextResponse.json({ error: "bad request" }, { status: 400 });
  }
  try {
    const slots = await getSlots(doctor, from, 7);
    return NextResponse.json({ slots }, { headers: { "Cache-Control": "no-store" } });
  } catch {
    return NextResponse.json({ slots: [] }, { status: 200, headers: { "Cache-Control": "no-store" } });
  }
}
