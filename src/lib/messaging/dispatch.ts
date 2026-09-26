import "server-only";
import { adminClient } from "@/lib/server/admin";
import { messagingMode, sendMessage } from "./provider";
import { renderTemplate } from "./render";

type OutboxRow = { id: string; to_phone: string; lang: "ar" | "en"; template_code: string; vars: Record<string, unknown> };

/** One dispatcher run: queue due reminders, then send a batch with retry/backoff handled in the database. */
export async function dispatchOnce(limit = 20) {
  const db = adminClient();
  const { data: reminders } = await db.rpc("svc_enqueue_due_reminders");
  if (messagingMode() === "disabled") return { reminders: reminders ?? 0, sent: 0, failed: 0, skipped: "no provider configured" };

  const { data: batch, error } = await db.rpc("svc_outbox_claim", { p_limit: limit });
  if (error) throw new Error(error.message);
  const { data: templates } = await db.from("message_templates").select("code, lang, body, provider_template, is_active");
  let sent = 0, failed = 0;
  for (const m of (batch ?? []) as OutboxRow[]) {
    const t = (templates ?? []).find((x) => x.code === m.template_code && x.lang === m.lang && x.is_active);
    if (!t) {
      await db.rpc("svc_outbox_result", { p_id: m.id, p_ok: false, p_provider: "none", p_provider_id: null, p_error: "template missing or inactive" });
      failed++; continue;
    }
    const r = await sendMessage({ to: m.to_phone, template: m.template_code, providerTemplate: t.provider_template, lang: m.lang, vars: m.vars,
                                  body: renderTemplate(t.body, m.vars, m.lang) });
    await db.rpc("svc_outbox_result", { p_id: m.id, p_ok: r.ok, p_provider: r.provider, p_provider_id: r.id ?? null, p_error: r.error ?? null });
    if (r.ok) sent++; else failed++;
  }
  return { reminders: reminders ?? 0, sent, failed };
}
