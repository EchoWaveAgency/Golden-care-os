// Demo HR data: shifts, employee files, salaries, biometric punches for last month and this month, demo payroll
// settings. Synthetic data, local stack only. The rates and tax brackets below are DEMO values for the screens —
// the chief accountant must enter the ones in force.
import { createClient } from "@supabase/supabase-js";
import { elevate } from "./local/totp.mjs";

const must = (r, w) => { if (r.error) throw new Error(`${w}: ${r.error.message}`); return r.data; };

export async function seedHr({ db, url, PASSWORD, BRANCH }) {
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  const cleanups = [];
  const login = async (email) => {
    const c = createClient(url, anonKey, { auth: { persistSession: false } });
    const { error } = await c.auth.signInWithPassword({ email, password: PASSWORD });
    if (error) throw new Error(`${email}: ${error.message}`);
    const { data: u } = await c.auth.getUser();
    const { data: old } = await db.auth.admin.mfa.listFactors({ userId: u.user.id });
    for (const f of old?.factors ?? []) await db.auth.admin.mfa.deleteFactor({ id: f.id, userId: u.user.id });
    cleanups.push(await elevate(c, "demo-seed"));
    return c;
  };
  try {
    if (must(await db.from("employees").select("id").limit(1), "check").length) return;
    const hr = await login("hr@demo.goldencare.local");
    const shift = must(await hr.rpc("save_shift", { p: { branch_id: BRANCH, code: "AM", name_ar: "الوردية الصباحية", name_en: "Morning shift",
      start_time: "09:00", end_time: "17:00", break_minutes: 30, grace_minutes: 10, weekdays: [6, 0, 1, 2, 3, 4] } }), "shift");
    must(await hr.rpc("save_shift", { p: { branch_id: BRANCH, code: "PM", name_ar: "الوردية المسائية", name_en: "Evening shift",
      start_time: "14:00", end_time: "22:00", break_minutes: 30, grace_minutes: 10, weekdays: [6, 0, 1, 2, 3, 4] } }), "shift pm");

    const cairo = (d) => new Intl.DateTimeFormat("en-CA", { timeZone: "Africa/Cairo" }).format(d);
    const today = cairo(new Date());
    const [y, m] = today.split("-").map(Number);
    const firstPrev = `${m === 1 ? y - 1 : y}-${String(m === 1 ? 12 : m - 1).padStart(2, "0")}-01`;
    const hire = `${y - 1}-01-01`;
    const plan = [
      // email, title, basic, housing, transport, insured, biometric
      ["reception@demo.goldencare.local", "موظفة استقبال", 7000, 800, 500, 6000, "101"],
      ["relations@demo.goldencare.local", "أخصائية علاقات مرضى", 8000, 900, 500, 7000, "102"],
      ["nurse@demo.goldencare.local", "ممرضة", 7500, 800, 500, 6500, "103"],
      ["cashier@demo.goldencare.local", "أمين خزينة", 6500, 700, 500, 5500, "104"],
      ["inventory@demo.goldencare.local", "أمين مخزن", 6000, 600, 500, 5000, "105"],
      ["devices@demo.goldencare.local", "مسؤول أجهزة", 9000, 1000, 600, 8000, "106"],
    ];
    const { data: users } = await db.auth.admin.listUsers({ perPage: 200 });
    const emps = [];
    for (const [email, title, basic, housing, transport, insured, bio] of plan) {
      const uid = users.users.find((u) => u.email === email)?.id;
      const staff = must(await db.from("staff").select("id").eq("user_id", uid), "staff")[0];
      if (!staff) continue;
      const e = must(await hr.rpc("save_employee", { p: { staff_id: staff.id, hire_date: hire, job_title_ar: title, insured_wage: insured, biometric_id: bio,
        shift_id: shift.id, basic_salary: basic, housing, transport, annual_leave_days: 21, bank_name: "بنك تجريبي", bank_account: `EG00DEMO${bio}`, payroll_flag: "1" } }), "employee");
      emps.push({ id: e.id, bio });
    }

    // Punches: every working day from the first of last month to yesterday; a few late arrivals, one absence, some overtime.
    const rows = [];
    const start = new Date(`${firstPrev}T12:00:00Z`);
    for (let d = new Date(start); cairo(d) < today; d = new Date(d.getTime() + 86400000)) {
      const day = cairo(d);
      if (new Date(`${day}T12:00:00Z`).getUTCDay() === 5) continue; // Friday off
      emps.forEach(({ bio }, i) => {
        const n = Number(day.slice(8)) + i;
        if (bio === "104" && day.endsWith("-07")) return;                     // one absence
        const inMin = n % 9 === 0 ? 35 : n % 5 === 0 ? 14 : -(n % 7);          // some late arrivals
        const outMin = n % 11 === 0 ? 75 : (n % 4) * 3;                        // some overtime
        const at = (h, mins) => { const t = new Date(Date.UTC(0, 0, 1, h, 0) + mins * 60000); return `${day} ${String(t.getUTCHours()).padStart(2, "0")}:${String(t.getUTCMinutes()).padStart(2, "0")}:00`; };
        rows.push({ biometric_id: bio, at: at(9, inMin) }, { biometric_id: bio, at: at(17, outMin) });
      });
    }
    must(await hr.rpc("import_attendance", { p_branch: BRANCH, p_rows: rows, p_batch: "demo-device-export" }), "punches");

    // A leave request waiting for approval.
    const nurseEmp = emps.find((e) => e.bio === "103");
    if (nurseEmp) {
      const next = new Date(Date.now() + 9 * 86400000);
      const nurse = await login("nurse@demo.goldencare.local");   // the employee asks; someone else approves
      must(await nurse.rpc("request_leave", { p_type: "ANNUAL", p_from: cairo(next), p_to: cairo(new Date(next.getTime() + 86400000)), p_reason: "ظرف عائلي" }), "leave");
    }

    // DEMO payroll settings (not legal advice; to be replaced by the chief accountant).
    const acc = await login("accountant@demo.goldencare.local");
    for (const [code, rate] of [["SI_EMPLOYEE", 11], ["SI_EMPLOYER", 18.75], ["OVERTIME", 1.35], ["LATE", 1]]) {
      must(await acc.rpc("save_payroll_component", { p_code: code, p: { rate } }), code);
    }
    must(await acc.rpc("save_payroll_setting", { p_key: "tax_personal_exemption", p_value: 20000, p_note: "قيمة تجريبية" }), "exemption");
    must(await acc.rpc("save_tax_brackets", { p_effective: `${y - 1}-01-01`, p_rows: [
      { from: 0, to: 40000, rate: 0 }, { from: 40000, to: 55000, rate: 10 }, { from: 55000, to: 70000, rate: 15 }, { from: 70000, to: 200000, rate: 20 },
      { from: 200000, to: 400000, rate: 22.5 }, { from: 400000, to: 1200000, rate: 25 }, { from: 1200000, to: null, rate: 27.5 }] }), "brackets");
  } finally {
    for (const done of cleanups) await done().catch(() => {});
  }
}
