import { NextResponse } from "next/server";
import { getPortal } from "@/lib/portal";
import { getFile } from "@/lib/files/store";
import type { Lang } from "@/lib/site/api";

export const dynamic = "force-dynamic";

// Patient download: only files their doctor released (portal_file checks the account and the family grant).
export async function GET(_req: Request, { params }: { params: { lang: Lang; id: string } }) {
  const { supabase } = await getPortal(params.lang);
  const { data, error } = await supabase.rpc("portal_file", { p_id: params.id });
  if (error || !data) return NextResponse.json({ error: "not found" }, { status: 404 });
  const f = data as { storage_path: string; content_type: string; name: string };
  const body = await getFile(f.storage_path).catch(() => null);
  if (!body) return NextResponse.json({ error: "not found" }, { status: 404 });
  return new NextResponse(new Uint8Array(body), { headers: { "Content-Type": f.content_type, "Cache-Control": "private, no-store",
    "Content-Disposition": `inline; filename*=UTF-8''${encodeURIComponent(f.name)}`, "X-Content-Type-Options": "nosniff" } });
}
