"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { duration } from "@/lib/leads-flow";

/** Refreshes the server-rendered page every `seconds` (new leads appear without reloading). Pauses while the
 *  user is typing or has an action form open, and when the tab is hidden. */
export function AutoRefresh({ seconds = 15 }: { seconds?: number }) {
  const router = useRouter();
  useEffect(() => {
    const t = setInterval(() => {
      if (document.hidden) return;
      const a = document.activeElement;
      if (a && ["INPUT", "TEXTAREA", "SELECT"].includes(a.tagName)) return;
      if (document.querySelector("details[data-form][open]")) return;
      router.refresh();
    }, seconds * 1000);
    return () => clearInterval(t);
  }, [router, seconds]);
  return null;
}

/** "Waiting 7 min" counting up from a timestamp. */
export function Since({ at, ar, className }: { at: string; ar: boolean; className?: string }) {
  const [now, setNow] = useState<number | null>(null);
  useEffect(() => {
    setNow(Date.now());
    const t = setInterval(() => setNow(Date.now()), 10_000);
    return () => clearInterval(t);
  }, []);
  const s = now == null ? null : (now - new Date(at).getTime()) / 1000;
  return <span className={`num ${className ?? ""}`} suppressHydrationWarning>{s == null ? "…" : duration(s, ar)}</span>;
}
