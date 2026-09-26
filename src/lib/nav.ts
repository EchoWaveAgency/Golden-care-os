import type { DictKey } from "./i18n";

// Navigation is built from the user's effective permissions, so each role gets its
// own workspace. The database still enforces every permission independently.

export type NavItem = { href: string; label: DictKey; section: DictKey; any: string[] };

export const NAV: NavItem[] = [
  { href: "/os/executive", label: "nav.executive", section: "nav.section.governance", any: ["dashboard.executive"] },
  { href: "/os/reception", label: "nav.reception", section: "nav.section.front", any: ["appointment.write"] },
  { href: "/os/leads", label: "nav.leads", section: "nav.section.front", any: ["lead.read"] },
  { href: "/os/tickets", label: "nav.tickets", section: "nav.section.front", any: ["ticket.read"] },
  { href: "/os/patients", label: "nav.patients", section: "nav.section.front", any: ["patient.read"] },
  { href: "/os/appointments/new", label: "nav.appointments", section: "nav.section.front", any: ["appointment.write"] },
  { href: "/os/doctor", label: "nav.doctor", section: "nav.section.clinical", any: ["clinical.write.own"] },
  { href: "/os/my-settlements", label: "nav.mySettlements", section: "nav.section.clinical", any: ["clinical.write.own"] },
  { href: "/os/billing", label: "nav.billing", section: "nav.section.finance", any: ["billing.read"] },
  { href: "/os/cashier", label: "nav.cashier", section: "nav.section.finance", any: ["cash.session", "cash.supervise"] },
  { href: "/os/refunds", label: "nav.refunds", section: "nav.section.finance", any: ["refund.request", "refund.approve"] },
  { href: "/os/settlements", label: "nav.settlements", section: "nav.section.finance", any: ["settlement.prepare", "settlement.approve", "settlement.pay", "contract.manage"] },
  { href: "/os/accounting", label: "nav.accounting", section: "nav.section.finance", any: ["accounting.read"] },
  { href: "/os/audit", label: "nav.audit", section: "nav.section.governance", any: ["audit.read"] },
  { href: "/os/content", label: "nav.content", section: "nav.section.web", any: ["content.edit", "content.medical_approve", "content.marketing_approve", "content.publish"] },
  { href: "/os/settings", label: "nav.settings", section: "nav.section.admin", any: ["settings.manage"] },
  { href: "/os/users", label: "nav.users", section: "nav.section.admin", any: ["users.manage"] },
  { href: "/os/messages", label: "nav.messages", section: "nav.section.admin", any: ["messages.manage"] },
];

export function navFor(perms: Set<string>): NavItem[] {
  return NAV.filter((i) => i.any.some((p) => perms.has(p)));
}

/** Landing page for a user: the first workspace their permissions open. */
export function homeFor(perms: Set<string>): string | null {
  const order = ["/os/executive", "/os/reception", "/os/doctor", "/os/cashier", "/os/billing", "/os/accounting", "/os/content", "/os/leads", "/os/patients", "/os/settings", "/os/audit"];
  const allowed = new Set(navFor(perms).map((i) => i.href));
  // Patient Relations (inquiries, no cash handling) starts in the inquiry inbox, not reception.
  if (allowed.has("/os/leads") && perms.has("lead.write") && !perms.has("payment.collect") && !allowed.has("/os/executive")) return "/os/leads";
  return order.find((h) => allowed.has(h)) ?? null;
}

export function canAccess(pathname: string, perms: Set<string>): boolean {
  const item = NAV.filter((i) => pathname === i.href || pathname.startsWith(i.href.replace(/\/new$/, "") + "/"))
    .sort((a, b) => b.href.length - a.href.length)[0];
  if (!item) return true; // pages without a nav entry check permissions themselves
  return item.any.some((p) => perms.has(p));
}
