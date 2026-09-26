import type { DictKey } from "./i18n";

// Navigation is built from the user's effective permissions, so each role gets its
// own workspace. The database still enforces every permission independently.

export type NavItem = { href: string; label: DictKey; section: DictKey; any: string[] };

export const NAV: NavItem[] = [
  { href: "/executive", label: "nav.executive", section: "nav.section.governance", any: ["dashboard.executive"] },
  { href: "/reception", label: "nav.reception", section: "nav.section.front", any: ["appointment.write"] },
  { href: "/patients", label: "nav.patients", section: "nav.section.front", any: ["patient.read"] },
  { href: "/appointments/new", label: "nav.appointments", section: "nav.section.front", any: ["appointment.write"] },
  { href: "/doctor", label: "nav.doctor", section: "nav.section.clinical", any: ["clinical.write.own"] },
  { href: "/billing", label: "nav.billing", section: "nav.section.finance", any: ["billing.read"] },
  { href: "/cashier", label: "nav.cashier", section: "nav.section.finance", any: ["cash.session", "cash.supervise"] },
  { href: "/accounting", label: "nav.accounting", section: "nav.section.finance", any: ["accounting.read"] },
  { href: "/audit", label: "nav.audit", section: "nav.section.governance", any: ["audit.read"] },
];

export function navFor(perms: Set<string>): NavItem[] {
  return NAV.filter((i) => i.any.some((p) => perms.has(p)));
}

/** Landing page for a user: the first workspace their permissions open. */
export function homeFor(perms: Set<string>): string | null {
  const order = ["/executive", "/reception", "/doctor", "/cashier", "/billing", "/accounting", "/patients", "/audit"];
  const allowed = new Set(navFor(perms).map((i) => i.href));
  return order.find((h) => allowed.has(h)) ?? null;
}

export function canAccess(pathname: string, perms: Set<string>): boolean {
  const item = NAV.filter((i) => pathname === i.href || pathname.startsWith(i.href.replace(/\/new$/, "") + "/"))
    .sort((a, b) => b.href.length - a.href.length)[0];
  if (!item) return true; // pages without a nav entry check permissions themselves
  return item.any.some((p) => perms.has(p));
}
