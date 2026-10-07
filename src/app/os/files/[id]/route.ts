import { NextResponse } from "next/server";
import { getContext } from "@/lib/session";
import { getFile } from "@/lib/files/store";

export const dynamic = "force-dynamic";

// Staff download: the database checks access (and audits clinical files) before any byte is read.
export async function GET(_req: Request, { params }: { params: { id: string } }) {
  const ctx = await getContext();
  const { data, error } = await ctx.supabase.rpc("patient_file_access", { p_id: params.id });
  if (error || !data) return NextResponse.json({ error: "not found" }, { status: 404 });
  const f = data as { storage_path: string; content_type: string; name: string };
  const body = await getFile(f.storage_path).catch(() => null);
  if (!body) return NextResponse.json({ error: "not found" }, { status: 404 });
  return new NextResponse(new Uint8Array(body), { headers: { "Content-Type": f.content_type, "Cache-Control": "private, no-store",
    "Content-Disposition": `inline; filename*=UTF-8''${encodeURIComponent(f.name)}`, "X-Content-Type-Options": "nosniff" } });
}
