import { NextResponse } from "next/server";
import { timingSafeEqual } from "node:crypto";
import { dispatchOnce } from "@/lib/messaging/dispatch";

export const dynamic = "force-dynamic";

// Called by a scheduler (Vercel Cron / Supabase pg_cron → http) every few minutes.
export async function POST(req: Request) {
  const secret = process.env.CRON_SECRET ?? "";
  const given = (req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "");
  const a = Buffer.from(given), b = Buffer.from(secret);
  if (!secret || a.length !== b.length || !timingSafeEqual(a, b)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  try {
    return NextResponse.json(await dispatchOnce());
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "dispatch failed" }, { status: 500 });
  }
}
export const GET = POST;
