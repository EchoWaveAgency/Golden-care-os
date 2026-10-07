import type { DictKey } from "./i18n";

// Navigation is built from the user's effective permissions, so each role gets its
// own workspace. The database still enforces every permission independently.

export type NavItem = { href: string; label: DictKey; section: DictKey; any: string[]; hideIf?: string[] };

export const NAV: NavItem[] = [
  { href: "/os/executive", label: "nav.executive", section: "nav.section.governance", any: ["dashboard.executive"] },
  { href: "/os/reception", label: "nav.reception", section: "nav.section.front", any: ["appointment.write"] },
  { href: "/os/leads", label: "nav.leads", section: "nav.section.front", any: ["lead.read"] },
  { href: "/os/care", label: "nav.care", section: "nav.section.front", any: ["care.read", "care.settings", "clinical.write.own"] },
  { href: "/os/tickets", label: "nav.tickets", section: "nav.section.front", any: ["ticket.read"] },
  { href: "/os/patients", label: "nav.patients", section: "nav.section.front", any: ["patient.read"] },
  { href: "/os/appointments/new", label: "nav.appointments", section: "nav.section.front", any: ["appointment.write"] },
  { href: "/os/doctor", label: "nav.doctor", section: "nav.section.clinical", any: ["clinical.write.own"] },
  { href: "/os/plans", label: "nav.plans", section: "nav.section.clinical", any: ["plan.write", "plan.accept", "billing.read"] },
  { href: "/os/lab", label: "nav.lab", section: "nav.section.clinical", any: ["lab.read", "lab.manage"] },
  { href: "/os/laser", label: "nav.laser", section: "nav.section.clinical", any: ["laser.operate"] },
  { href: "/os/my-settlements", label: "nav.mySettlements", section: "nav.section.clinical", any: ["clinical.write.own"] },
  { href: "/os/packages", label: "nav.packages", section: "nav.section.front", any: ["package.read", "package.manage", "package.sell"] },
  { href: "/os/billing", label: "nav.billing", section: "nav.section.finance", any: ["billing.read"] },
  { href: "/os/cashier", label: "nav.cashier", section: "nav.section.finance", any: ["cash.session", "cash.supervise"] },
  { href: "/os/refunds", label: "nav.refunds", section: "nav.section.finance", any: ["refund.request", "refund.approve"] },
  { href: "/os/settlements", label: "nav.settlements", section: "nav.section.finance", any: ["settlement.prepare", "settlement.approve", "settlement.pay", "contract.manage"] },
  { href: "/os/hr", label: "nav.hr", section: "nav.section.people", any: ["hr.read", "hr.manage", "attendance.manage", "leave.approve"] },
  { href: "/os/hr/performance", label: "nav.performance", section: "nav.section.people", any: ["performance.review"], hideIf: ["hr.read"] },
  { href: "/os/payroll", label: "nav.payroll", section: "nav.section.people", any: ["payroll.read", "payroll.prepare", "payroll.settings"] },
  { href: "/os/accounting", label: "nav.accounting", section: "nav.section.finance", any: ["accounting.read"] },
  { href: "/os/inventory", label: "nav.inventory", section: "nav.section.operations", any: ["inventory.read", "inventory.issue", "inventory.receive", "inventory.count", "inventory.approve", "inventory.manage"] },
  { href: "/os/devices", label: "nav.devices", section: "nav.section.operations", any: ["device.read", "device.manage", "device.maintain"] },
  { href: "/os/purchasing", label: "nav.purchasing", section: "nav.section.operations", any: ["purchase.read", "purchase.request", "purchase.approve"] },
  { href: "/os/suppliers", label: "nav.suppliers", section: "nav.section.finance", any: ["supplier.pay.request", "supplier.pay.approve"] },
  { href: "/os/reports/profitability", label: "nav.profitability", section: "nav.section.governance", any: ["reports.finance"] },
  { href: "/os/audit", label: "nav.audit", section: "nav.section.governance", any: ["audit.read"] },
  { href: "/os/content", label: "nav.content", section: "nav.section.web", any: ["content.edit", "content.medical_approve", "content.marketing_approve", "content.publish"] },
  { href: "/os/settings", label: "nav.settings", section: "nav.section.admin", any: ["settings.manage"] },
  { href: "/os/users", label: "nav.users", section: "nav.section.admin", any: ["users.manage"] },
  { href: "/os/messages", label: "nav.messages", section: "nav.section.admin", any: ["messages.manage"] },
];

export function navFor(perms: Set<string>): NavItem[] {
  return NAV.filter((i) => i.any.some((p) => perms.has(p)) && !(i.hideIf ?? []).some((p) => perms.has(p)));
}

/** Landing page for a user: the first workspace their permissions open. */
export function homeFor(perms: Set<string>): string | null {
  const order = ["/os/executive", "/os/reception", "/os/doctor", "/os/cashier", "/os/billing", "/os/accounting", "/os/hr", "/os/payroll", "/os/content", "/os/leads", "/os/patients", "/os/laser", "/os/inventory", "/os/devices", "/os/settings", "/os/audit"];
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
