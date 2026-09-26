"use server";
import { randomUUID } from "node:crypto";
import { redirect } from "next/navigation";
import { getPortal } from "@/lib/portal";
import { portalError } from "@/lib/errors";
import { adminClient } from "@/lib/server/admin";
import { createCheckout, paymentsMode, providerName, type IntentInfo } from "@/lib/payments/gateway";
import type { Lang } from "@/lib/site/api";

const langOf = (f: FormData): Lang => (f.get("lang") === "en" ? "en" : "ar");

// Audited service-role path #5 (payments): the patient's own session creates the intent
// (access checked in portal_pay_invoice); the server then attaches the gateway order.
export async function startPayment(form: FormData) {
  const lang = langOf(form);
  const { supabase } = await getPortal(lang);
  const fail = (msg: string): never => redirect(`/${lang}/portal/finance?error=${encodeURIComponent(msg)}`);
  if (paymentsMode() === "off") fail(lang === "ar" ? "الدفع الإلكتروني غير متاح حاليًا. يمكنك السداد في العيادة." : "Online payment is not available yet. You can pay at the clinic.");
  const { data, error } = await supabase.rpc("portal_pay_invoice", { p_invoice: String(form.get("invoice")) });
  if (error) fail(portalError(error.message, lang));
  const intentId = (data as { intent_id: string }).intent_id;
  const db = adminClient();
  const { data: info } = await db.rpc("svc_payment_intent", { p_intent: intentId });
  let checkout: { url: string; orderId: string };
  try {
    checkout = await createCheckout(info as IntentInfo, lang, process.env.NEXT_PUBLIC_SITE_URL ?? "");
  } catch {
    fail(lang === "ar" ? "تعذر الاتصال ببوابة الدفع. حاول بعد قليل." : "Could not reach the payment gateway. Please try again shortly.");
  }
  // Attach before the patient can pay, so the callback always finds its intent. If another tab
  // already started this intent, stop here rather than create a second chargeable order.
  const { data: attached } = await db.rpc("svc_payment_intent_attach", { p_intent: intentId, p_provider: providerName(), p_order_id: checkout!.orderId });
  if (attached !== true) fail(lang === "ar" ? "عملية دفع أخرى لهذه الفاتورة قيد التنفيذ. أكملها أو انتظر 30 دقيقة." : "Another payment for this invoice is in progress. Finish it or wait 30 minutes.");
  redirect(checkout!.url);
}

// LOCAL SIMULATOR ONLY (PAYMENTS_MODE=dev): stands in for the gateway's signed callback.
export async function devGatewayResult(form: FormData) {
  const lang = langOf(form);
  if (paymentsMode() !== "dev") redirect(`/${lang}/portal/finance`);
  const { supabase } = await getPortal(lang);
  const intent = String(form.get("intent"));
  const { data: st, error } = await supabase.rpc("portal_payment_status", { p_intent: intent });   // ownership check
  if (error || !st) redirect(`/${lang}/portal/finance`);
  const ok = form.get("result") === "success";
  await adminClient().rpc("svc_payment_confirm", {
    p_provider: "dev", p_order_id: intent, p_txn_id: `dev-${randomUUID()}`, p_amount_cents: Math.round(Number((st as { amount: number }).amount) * 100),
    p_success: ok, p_error: ok ? null : "card declined (simulator)",
  });
  redirect(`/${lang}/portal/pay/return?intent=${intent}`);
}
