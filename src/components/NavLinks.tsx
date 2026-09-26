"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";

// Client-side so the active item follows navigation (layouts don't re-render between pages).
export type NavGroup = { section: string; items: { href: string; label: string }[] };

export function NavLinks({ groups, compact = false }: { groups: NavGroup[]; compact?: boolean }) {
  const path = usePathname();
  const isActive = (href: string) => path === href || path.startsWith(href.replace(/\/new$/, "") + "/");
  return (
    <>
      {groups.map((g) => (
        <div key={g.section} className={compact ? "contents" : "mb-5"}>
          {!compact && <p className="mb-2 px-3 text-[11px] font-medium uppercase tracking-wider text-ivory-300/70">{g.section}</p>}
          {g.items.map((i) => {
            const active = isActive(i.href);
            return (
              <Link
                key={i.href}
                href={i.href}
                aria-current={active ? "page" : undefined}
                className={
                  compact
                    ? `whitespace-nowrap rounded-full px-3 py-1.5 text-sm ${active ? "bg-gold-500 text-white" : "text-ivory-200"}`
                    : `block rounded-lg px-3 py-2 text-sm transition ${active ? "bg-white/10 text-white shadow-[inset_3px_0_0_theme(colors.gold.300)] rtl:shadow-[inset_-3px_0_0_theme(colors.gold.300)]" : "text-ivory-200 hover:bg-white/5 hover:text-white"}`
                }
              >
                {i.label}
              </Link>
            );
          })}
        </div>
      ))}
    </>
  );
}

export function BackField() {
  const path = usePathname();
  return <input type="hidden" name="back" value={path} />;
}
