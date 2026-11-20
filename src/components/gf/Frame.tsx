import Link from "next/link";
import { CC_STATUS, type CcStatus } from "@/lib/leads-flow";

const FLOW: [string, string][] = [["AD", "إعلان"], ["WHATSAPP", "واتساب"], ["LEAD CAPTURE", "التقاط العميل"], ["LEAD LOG", "سجل العملاء"],
  ["CALL CENTER", "الكول سنتر"], ["FOLLOW-UP", "المتابعة"], ["BOOKING", "الحجز"], ["REPORT", "التقرير"]];

export function GfHeader({ ar, title, subtitle, actions, tabs }: {
  ar: boolean; title: string; subtitle?: string; actions?: React.ReactNode; tabs?: { href: string; label: string; active: boolean; count?: number }[];
}) {
  return (
    <header className="mb-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-gold-300">Golden Friday · {ar ? "الجمعة الذهبية" : "Golden Care"}</p>
          <h1 className="mt-1 text-2xl font-semibold text-ivory-50">{title}</h1>
          {subtitle && <p className="gf-muted mt-1 text-sm">{subtitle}</p>}
        </div>
        {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
      </div>
      {tabs && (
        <nav className="mt-4 flex gap-2 overflow-x-auto pb-1">
          {tabs.map((t) => (
            <Link key={t.href} href={t.href}
              className={`whitespace-nowrap rounded-full px-4 py-2 text-sm font-medium ${t.active ? "bg-gold-300 text-coal-950" : "bg-coal-800 text-ivory-200 hover:bg-coal-700"}`}>
              {t.label}{t.count != null && <span className="ms-2 inline-block rounded-full bg-coal-950/30 px-1.5 text-xs"><span className="num">{t.count}</span></span>}
            </Link>
          ))}
        </nav>
      )}
    </header>
  );
}

export function GfFlow({ ar }: { ar: boolean }) {
  return (
    <section className="gf-card mb-5 p-4" aria-label="Core workflow">
      <ol className="flex flex-wrap items-center gap-x-1 gap-y-2 text-[11px] font-semibold tracking-wide sm:text-xs">
        {FLOW.map(([en, a], i) => (
          <li key={en} className="flex items-center gap-1">
            <span className="rounded-md border border-gold-500/40 bg-coal-900 px-2 py-1 text-gold-100" title={a}>{ar ? a : en}</span>
            {i < FLOW.length - 1 && <span className="text-gold-500" aria-hidden>{ar ? "←" : "→"}</span>}
          </li>
        ))}
      </ol>
      <p className="mt-3 text-xs text-ivory-300/80">
        {ar ? "لكل عميل: مصدر · مسؤول · حالة." : "Every lead has a source. Every lead has an owner. Every lead has a status."}
      </p>
    </section>
  );
}

export function CcPill({ status, ar }: { status: string; ar: boolean }) {
  const s = CC_STATUS[status as CcStatus];
  if (!s) return null;
  return <span className={`inline-flex items-center rounded-md px-2 py-0.5 text-[11px] font-bold tracking-wide ${s.tone}`}>{ar ? s.ar : s.en}</span>;
}

export function GfBanner({ error, ok, ar }: { error?: string; ok?: string; ar: boolean }) {
  if (error) return <p role="alert" className="mb-4 rounded-lg border border-red-400/40 bg-red-500/10 px-4 py-3 text-sm text-red-200">{error}</p>;
  if (ok) return <p role="status" className="mb-4 rounded-lg border border-emerald-400/30 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-200">{ar ? "تم الحفظ." : "Saved."}</p>;
  return null;
}

export function Kpi({ label, value, hint, tone = "gold" }: { label: string; value: string | number; hint?: string; tone?: "gold" | "red" | "green" | "plain" | "orange" }) {
  const c = { gold: "text-gold-300", red: "text-red-300", green: "text-emerald-300", plain: "text-ivory-50", orange: "text-orange-300" }[tone];
  return (
    <div className="gf-card p-4">
      <p className="text-[11px] font-semibold uppercase tracking-wide text-ivory-300/70">{label}</p>
      <p className={`num mt-2 text-2xl font-semibold ${c}`}>{value}</p>
      {hint && <p className="mt-1 text-[11px] text-ivory-300/60">{hint}</p>}
    </div>
  );
}
