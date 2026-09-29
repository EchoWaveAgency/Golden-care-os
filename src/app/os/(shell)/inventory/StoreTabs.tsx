import Link from "next/link";
import type { Loc } from "@/lib/inventory";

export function StoreTabs({ stores, current, base, ar }: { stores: Loc[]; current: Loc | null; base: string; ar: boolean }) {
  if (stores.length < 2) return null;
  return (
    <nav className="mb-4 flex flex-wrap gap-2">
      {stores.map((s) => (
        <Link key={s.id} href={`${base}?loc=${s.id}`} className={`rounded-full px-3 py-1.5 text-sm ${s.id === current?.id ? "bg-navy-700 text-white" : "bg-white text-ink-500 hover:bg-ivory-200"}`}>{ar ? s.name_ar : s.name_en}</Link>
      ))}
    </nav>
  );
}
