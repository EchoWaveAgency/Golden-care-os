import Link from "next/link";

const TABS = [
  { key: "employees", href: "/os/hr", ar: "الموظفون", en: "Employees", any: ["hr.read", "hr.manage"] },
  { key: "attendance", href: "/os/hr/attendance", ar: "الحضور والانصراف", en: "Attendance", any: ["hr.read", "attendance.manage"] },
  { key: "leave", href: "/os/hr/leave", ar: "الإجازات", en: "Leave", any: ["hr.read", "leave.approve"] },
  { key: "shifts", href: "/os/hr/shifts", ar: "الورديات", en: "Shifts", any: ["hr.read", "hr.manage"] },
  { key: "performance", href: "/os/hr/performance", ar: "الأداء", en: "Performance", any: ["performance.review"] },
  { key: "payroll", href: "/os/payroll", ar: "الرواتب", en: "Payroll", any: ["payroll.read", "payroll.prepare"] },
];

export function HrTabs({ active, ar, can }: { active: string; ar: boolean; can: (p: string) => boolean }) {
  return (
    <nav className="mb-5 flex flex-wrap gap-2 text-sm">
      {TABS.filter((t) => t.any.some(can)).map((t) => (
        <Link key={t.key} href={t.href} className={`rounded-full px-3 py-1 ${t.key === active ? "bg-teal-700 text-white" : "bg-white text-navy-700 hover:bg-teal-50"}`}>{ar ? t.ar : t.en}</Link>))}
    </nav>
  );
}
