import "server-only";
import { createHash, randomUUID } from "node:crypto";
import { adminClient } from "@/lib/server/admin";

// Electronic invoice / receipt connector.
// - "dev": local simulator — accepts every complete document with test ids. Never in production.
// - "disabled" (default): documents stay queued; nothing is sent.
// The Egyptian Tax Authority connector (OAuth client credentials, receipt serialisation + SHA-256 uuid for e-receipts,
// a qualified signature for e-invoices, submission and status polling) is to be completed and certified on the ETA
// pre-production portal with the clinic's credentials; it plugs in here as one more mode.
export function einvoiceMode(): "dev" | "disabled" {
  return process.env.EINVOICE_MODE === "dev" ? "dev" : "disabled";
}

type Doc = { id: string; doc_no: string; kind: string; payload: Record<string, unknown> };

async function submitDev(doc: Doc) {
  const uuid = createHash("sha256").update(JSON.stringify(doc.payload)).digest("hex");
  return { status: "accepted" as const, submission: `DEV-${randomUUID().slice(0, 8)}`, uuid, longId: `DEV${uuid.slice(0, 20).toUpperCase()}`, error: null };
}

export async function processEinvoices(limit = 20) {
  if (einvoiceMode() === "disabled") return { skipped: "e-invoice connector not configured" };
  const db = adminClient();
  const { data, error } = await db.rpc("svc_einvoice_claim", { p_limit: limit });
  if (error) throw new Error(error.message);
  let accepted = 0, failed = 0;
  for (const doc of (data ?? []) as Doc[]) {
    try {
      const r = await submitDev(doc);
      await db.rpc("svc_einvoice_result", { p_id: doc.id, p_status: r.status, p_provider: "dev", p_submission: r.submission, p_uuid: r.uuid, p_long_id: r.longId, p_error: r.error });
      accepted++;
    } catch (e) {
      await db.rpc("svc_einvoice_result", { p_id: doc.id, p_status: "error", p_provider: "dev", p_submission: null, p_uuid: null, p_long_id: null,
        p_error: e instanceof Error ? e.message : "submission failed" });
      failed++;
    }
  }
  return { accepted, failed };
}
