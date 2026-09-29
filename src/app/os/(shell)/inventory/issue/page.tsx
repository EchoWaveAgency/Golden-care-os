import { randomUUID } from "node:crypto";
import Link from "next/link";
import { requireAny } from "@/lib/session";
import { storesFor } from "@/lib/inventory";
import { rangeStart, timeOnly } from "@/lib/format";
import { PageHeader } from "@/components/PageHeader";
import { Banner } from "@/components/Banner";
import { SubmitButton } from "@/components/SubmitButton";
import { StockLines } from "@/components/StockLines";
import { issueStock } from "@/app/actions/inventory";
import { StoreTabs } from "../StoreTabs";

export const dynamic = "force-dynamic";

type Apt = { id: string; ref: string; slot: string; patient_id: string; doctor: { full_name_ar: string; full_name_en: string | null } | null };

export default async function IssuePage({ searchParams }: { searchParams: { loc?: string; appointment?: string; error?: string; ok?: string } }) {
  const ctx = await requireAny("inventory.issue");
  const ar = ctx.locale === "ar";
  const { list, current } = await storesFor(ctx, searchParams.loc);
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Africa/Cairo" }).format(new Date());
  const [{ data: items }, { data: lots }, { data: apts }] = await Promise.all([
    ctx.supabase.from("inv_items").select("id, code, name_ar, name_en, unit, is_controlled").eq("is_active", true).order("code"),
    current ? ctx.supabase.from("inv_lots").select("item_id, qty_on_hand, expiry").eq("location_id", current.id).gt("qty_on_hand", 0) : Promise.resolve({ data: [] }),
    current ? ctx.supabase.from("appointments").select("id, ref, slot, patient_id, doctor:staff(full_name_ar, full_name_en)").eq("branch_id", current.branch_id)
      .overlaps("slot", `[${today}T00:00:00+03:00,${today}T23:59:59+03:00)`).not("status", "in", "(canceled,no_show)").order("slot").returns<Apt[]>() : Promise.resolve({ data: [] as Apt[] }),
  ]);
  const usable = new Map<string, number>();
  for (const l of (lots ?? []) as { item_id: string; qty_on_hand: number; expiry: string | null }[]) {
    if (!l.expiry || l.expiry > today) usable.set(l.item_id, (usable.get(l.item_id) ?? 0) + Number(l.qty_on_hand));
  }
  const { data: dir } = (apts ?? []).length ? await ctx.supabase.rpc("patient_directory", { p_ids: (apts ?? []).map((a) => a.patient_id) }) : { data: [] };
  const names = new Map(((dir ?? []) as { id: string; full_name_ar: string }[]).map((p) => [p.id, p.full_name_ar]));

  // Prefill from the consumable templates of the services on this appointment's invoice.
  let initial: { item_id: string; qty: string }[] | undefined;
  const apt = (apts ?? []).find((a) => a.id === searchParams.appointment);
  if (apt) {
    const { data: tpl } = await ctx.supabase.rpc("issue_template", { p_appointment: apt.id });
    const t = (tpl ?? []) as { item_id: string; qty: number }[];
    if (t.length) initial = t.map((x) => ({ item_id: x.item_id, qty: String(Number(x.qty)) }));
  }
  const [okKind, okRef] = (searchParams.ok ?? "").split(":");

  return (
    <>
      <PageHeader title={ar ? "صرف مستهلكات" : "Issue consumables"} subtitle={ar ? "يُصرف من التشغيلة الأقرب انتهاءً أولًا. المنتهي لا يُصرف. التكلفة تُحمّل على الجلسة ويُرحّل القيد تلقائيًا." : "First-expiry-first-out; expired stock is never issued. Cost is charged to the session and posted automatically."}
        actions={ctx.can("inventory.read") ? <Link href={`/os/inventory?loc=${current?.id ?? ""}`} className="btn-ghost">{ctx.t("common.back")}</Link> : undefined} />
      <Banner error={searchParams.error} success={okKind === "issued" ? (ar ? `تم الصرف ${okRef}.` : `Issued ${okRef}.`) : undefined} />
      <StoreTabs stores={list} current={current} base="/os/inventory/issue" ar={ar} />
      {!current ? <p className="text-sm text-ink-500">{ar ? "لا يوجد مخزن." : "No store."}</p> : (<>
        <nav className="mb-4 flex flex-wrap gap-2 text-sm">
          <span className="text-ink-500">{ar ? "مواعيد اليوم:" : "Today:"}</span>
          {(apts ?? []).map((a) => (
            <Link key={a.id} href={`/os/inventory/issue?loc=${current.id}&appointment=${a.id}`}
              className={`rounded-full px-3 py-1 ${a.id === apt?.id ? "bg-teal-700 text-white" : "bg-white text-navy-700 hover:bg-teal-50"}`}>
              <span className="whitespace-nowrap">{timeOnly(rangeStart(a.slot), ctx.locale)}</span> · {names.get(a.patient_id) ?? a.ref}
            </Link>
          ))}
        </nav>
        <form key={`${apt?.id ?? "none"}-${searchParams.ok ?? ""}-${searchParams.error ?? ""}`} action={issueStock} className="card space-y-4 p-5">
          <input type="hidden" name="location_id" value={current.id} />
          <input type="hidden" name="idempotency_key" value={randomUUID()} />
          <input type="hidden" name="appointment_id" value={apt?.id ?? ""} />
          {apt ? <p className="rounded-lg bg-teal-50 px-3 py-2 text-sm text-teal-900">{ar ? "الصرف على موعد" : "Issuing for"} {names.get(apt.patient_id)} · <span className="num">{apt.ref}</span>{initial ? (ar ? " — تم ملء الأصناف من قالب الخدمة، راجِع الكميات." : " — prefilled from the service template; check quantities.") : ""}</p>
            : <div><label className="label" htmlFor="reason">{ar ? "سبب الصرف (إن لم يكن على موعد)" : "Purpose (if not for an appointment)"}</label><input id="reason" name="reason" className="input" /></div>}
          <StockLines ar={ar} mode="issue" initial={initial}
            items={(items ?? []).map((i) => ({ id: i.id, code: i.code, name: ar ? i.name_ar : i.name_en, unit: i.unit, controlled: i.is_controlled, available: usable.get(i.id) ?? 0 }))} />
          <SubmitButton pendingLabel="…" className="btn-primary">{ar ? "تسجيل الصرف" : "Post issue"}</SubmitButton>
        </form>
      </>)}
    </>
  );
}
