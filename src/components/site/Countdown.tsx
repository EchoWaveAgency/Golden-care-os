"use client";
import { useEffect, useState } from "react";
import type { Lang } from "@/lib/site/api";
import { copy } from "@/lib/site/copy";

// Shown only when the landing page has a real, approved end date (enforced in the database).
export function Countdown({ endsAt, lang }: { endsAt: string; lang: Lang }) {
  const c = copy(lang);
  const [now, setNow] = useState<number | null>(null);
  useEffect(() => { setNow(Date.now()); const t = setInterval(() => setNow(Date.now()), 60_000); return () => clearInterval(t); }, []);
  if (now === null) return null;
  const ms = new Date(endsAt).getTime() - now;
  if (ms <= 0) return null;
  const d = Math.floor(ms / 86_400_000), h = Math.floor((ms % 86_400_000) / 3_600_000);
  return <p className="inline-flex items-center gap-2 rounded-full bg-white/10 px-4 py-2 text-sm">{c.endsIn} <span className="num font-semibold text-gold-300">{d}</span> {c.days} <span className="num font-semibold text-gold-300">{h}</span> {c.hoursShort}</p>;
}
