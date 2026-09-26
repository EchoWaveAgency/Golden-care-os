import { requireAny } from "@/lib/session";
import { clinicToday, clinicLocalToIso, money } from "@/lib/format";
import { PageHeader } from "@/components/PageHeader";
import { Stat } from "@/components/Stat";

export const metadata = { title: "Command center" };
export const dynamic = "force-dynamic";

// Every figure is a live query over source records; nothing here is hard-coded.
export default async function ExecutivePage() {
  const ctx = await requireAny("dashboard.executive");
  const { t, locale } = ctx;
  const day = clinicToday();
  const from = clinicLocalToIso(day, "00:00");
  const to = new Date(new Date(from).getTime() + 24 * 3600_000).toISOString();

  const [apts, pays, open] = await Promise.all([
    ctx.can("appointment.read")
      ? ctx.supabase.from("appointments").select("status").overlaps("slot", `[${from},${to})`)
      : Promise.resolve({ data: null }),
    ctx.can("billing.read")
      ? ctx.supabase.from("payments").select("amount").gte("received_at", from).lt("received_at", to).eq("status", "posted")
      : Promise.resolve({ data: null }),
    ctx.can("billing.read")
      ? ctx.supabase.from("invoices").select("balance").in("status", ["issued", "partially_paid"])
      : Promise.resolve({ data: null }),
  ]);
  const a = (apts.data ?? []) as { status: string }[];
  const n = (f: (s: string) => boolean) => a.filter((x) => f(x.status)).length;
  const collections = ((pays.data ?? []) as { amount: string }[]).reduce((s, p) => s + Number(p.amount), 0);
  const outstanding = ((open.data ?? []) as { balance: string }[]).reduce((s, i) => s + Number(i.balance), 0);

  return (
    <>
      <PageHeader title={t("nav.executive")} subtitle={`${t("exec.today")} · ${day}`} />
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-6">
        {apts.data && <>
          <Stat label={t("exec.appointments")} value={n((s) => !["canceled", "no_show"].includes(s))} href="/os/reception" />
          <Stat label={t("exec.arrived")} value={n((s) => ["arrived", "waiting", "in_consultation", "procedure_in_progress", "awaiting_payment", "completed"].includes(s))} tone="teal" href="/os/reception" />
          <Stat label={t("exec.completed")} value={n((s) => s === "completed")} href="/os/reception" />
          <Stat label={t("exec.noShow")} value={n((s) => s === "no_show")} tone="danger" href="/os/reception" />
        </>}
        {pays.data && <Stat label={t("exec.collections")} value={money(collections, locale)} tone="gold" href="/os/billing?status=paid" />}
        {open.data && <Stat label={t("exec.outstanding")} value={money(outstanding, locale)} tone="navy" href="/os/billing?status=open" />}
      </div>
      <p className="mt-6 text-xs text-ink-300">{t("exec.drill")}</p>
    </>
  );
}
