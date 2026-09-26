"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";

export function PortalNav({ items }: { items: { href: string; label: string }[] }) {
  const path = usePathname();
  return (
    <nav aria-label="portal" className="no-print -mx-4 flex gap-1 overflow-x-auto px-4 pb-1 md:mx-0 md:flex-col md:overflow-visible md:px-0">
      {items.map((i) => {
        const active = path === i.href || path.startsWith(`${i.href}/`);
        return (
          <Link key={i.href} href={i.href} aria-current={active ? "page" : undefined}
            className={`whitespace-nowrap rounded-full px-4 py-2 text-sm transition md:rounded-lg ${active ? "bg-teal-700 text-white" : "bg-white text-navy-700 hover:bg-teal-50 md:bg-transparent"}`}>
            {i.label}
          </Link>
        );
      })}
    </nav>
  );
}
