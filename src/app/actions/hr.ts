"use server";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { getContext } from "@/lib/session";
import { friendlyError } from "@/lib/errors";
import { parsePunchFile } from "@/lib/hr";

function go(path: string, error?: { message: string } | null, locale: "ar" | "en" = "ar", ok?: string): never {
  revalidatePath(path.split("?")[0]);
  const sep = path.includes("?") ? "&" : "?";
  redirect(`${path}${error ? `${sep}error=${encodeURIComponent(friendlyError(error.message, locale))}` : ok ? `${sep}ok=${ok}` : ""}`);
}
const s = (f: FormData, k: string) => String(f.get(k) ?? "").trim();
const back = (f: FormData, d: string) => s(f, "back") || d;

// ---------- Employees and shifts
export async function saveEmployee(form: FormData) {
  const ctx = await getContext();
  const id = s(form, "id");
  const p: Record<string, unknown> = {};
  for (const k of ["staff_id", "hire_date", "job_title_ar", "job_title_en", "department", "employment_type", "national_id", "insurance_no", "insured_wage",
    "payment_method", "bank_name", "bank_account", "biometric_id", "shift_id", "annual_leave_days", "basic_salary", "housing", "transport", "salary_from", "salary_note"]) {
    if (form.has(k)) p[k] = s(form, k);
  }
  if (id) p.id = id;
  if (form.has("payroll_flag")) p.payroll_eligible = form.get("payroll_eligible") === "on";
  const { data, error } = await ctx.supabase.rpc("save_employee", { p });
  if (error) go(id ? `/os/hr/employees/${id}` : "/os/hr", error, ctx.locale);
  go(`/os/hr/employees/${(data as { id: string }).id}`, null, ctx.locale, "saved");
}

export async function endEmployment(form: FormData) {
  const ctx = await getContext();
  const id = s(form, "id");
  const { error } = await ctx.supabase.rpc("end_employment", { p_employee: id, p_end: s(form, "end_date"), p_reason: s(form, "reason") });
  go(`/os/hr/employees/${id}`, error, ctx.locale, "ended");
}

export async function saveShift(form: FormData) {
  const ctx = await getContext();
  const weekdays = form.getAll("weekdays").map((v) => Number(v));
  const { error } = await ctx.supabase.rpc("save_shift", { p: {
    id: s(form, "id") || null, branch_id: ctx.branchId, code: s(form, "code"), name_ar: s(form, "name_ar"), name_en: s(form, "name_en"),
    start_time: s(form, "start_time"), end_time: s(form, "end_time"), break_minutes: s(form, "break_minutes"), grace_minutes: s(form, "grace_minutes"), weekdays,
  } });
  go("/os/hr/shifts", error, ctx.locale, "saved");
}

export async function setRoster(form: FormData) {
  const ctx = await getContext();
  const { error } = await ctx.supabase.rpc("set_roster", { p_employee: s(form, "employee_id"), p_day: s(form, "day"), p_shift: s(form, "shift_id") || null, p_note: s(form, "note") || null });
  go(back(form, "/os/hr/attendance"), error, ctx.locale, "roster");
}

// ---------- Attendance
export async function importAttendance(form: FormData) {
  const ctx = await getContext();
  const file = form.get("file");
  const text = file instanceof File && file.size > 0 ? await file.text() : s(form, "text");
  const { rows, skipped } = parsePunchFile(text);
  if (!rows.length) go("/os/hr/attendance", { message: "no punches found in the file" }, ctx.locale);
  const { data, error } = await ctx.supabase.rpc("import_attendance", { p_branch: ctx.branchId, p_rows: rows, p_batch: file instanceof File ? file.name : "paste" });
  if (error) go("/os/hr/attendance", error, ctx.locale);
  const r = data as { inserted: number; duplicates: number; unmatched: number; rejected: number };
  go(`/os/hr/attendance?imported=${r.inserted}&dup=${r.duplicates}&unmatched=${r.unmatched}&rejected=${r.rejected + skipped}`, null, ctx.locale, "imported");
}

export async function addManualPunch(form: FormData) {
  const ctx = await getContext();
  const at = new Date(`${s(form, "day")}T${s(form, "time")}:00+03:00`).toISOString();
  const { error } = await ctx.supabase.rpc("add_manual_punch", { p_employee: s(form, "employee_id"), p_at: at, p_reason: s(form, "reason") });
  go(back(form, "/os/hr/attendance"), error, ctx.locale, "punch_added");
}

export async function decideManualPunch(form: FormData) {
  const ctx = await getContext();
  const { error } = await ctx.supabase.rpc("decide_manual_punch", { p_punch: s(form, "id"), p_approve: form.get("decision") === "approve" });
  go("/os/hr/attendance", error, ctx.locale, "decided");
}

export async function approveOvertime(form: FormData) {
  const ctx = await getContext();
  const { error } = await ctx.supabase.rpc("approve_overtime", { p_employee: s(form, "employee_id"), p_day: s(form, "day"), p_minutes: Number(s(form, "minutes") || 0) });
  go(back(form, "/os/hr/attendance"), error, ctx.locale, "overtime");
}

export async function recomputeAttendance(form: FormData) {
  const ctx = await getContext();
  const { error } = await ctx.supabase.rpc("recompute_attendance", { p_branch: ctx.branchId, p_from: s(form, "from"), p_to: s(form, "to") });
  go(back(form, "/os/hr/attendance"), error, ctx.locale, "recomputed");
}

// ---------- Leave
export async function requestLeave(form: FormData) {
  const ctx = await getContext();
  const emp = s(form, "employee_id") || null;
  const { error } = await ctx.supabase.rpc("request_leave", { p_type: s(form, "leave_type"), p_from: s(form, "from"), p_to: s(form, "to"),
    p_reason: s(form, "reason") || null, p_employee: emp });
  go(back(form, "/os/me"), error, ctx.locale, "leave_requested");
}

export async function decideLeave(form: FormData) {
  const ctx = await getContext();
  const { error } = await ctx.supabase.rpc("decide_leave", { p_request: s(form, "id"), p_approve: form.get("decision") === "approve", p_note: s(form, "note") || null });
  go("/os/hr/leave", error, ctx.locale, "decided");
}

export async function cancelLeave(form: FormData) {
  const ctx = await getContext();
  const { error } = await ctx.supabase.rpc("cancel_leave", { p_request: s(form, "id"), p_reason: s(form, "reason") || null });
  go(back(form, "/os/me"), error, ctx.locale, "leave_cancelled");
}

// ---------- Loans
export async function requestLoan(form: FormData) {
  const ctx = await getContext();
  const { error } = await ctx.supabase.rpc("request_loan", { p_employee: s(form, "employee_id"), p_amount: Number(s(form, "amount")),
    p_installments: Number(s(form, "installments")), p_start: `${s(form, "start")}-01`, p_reason: s(form, "reason") });
  go(back(form, "/os/payroll"), error, ctx.locale, "loan_requested");
}
export async function decideLoan(form: FormData) {
  const ctx = await getContext();
  const { error } = await ctx.supabase.rpc("decide_loan", { p_loan: s(form, "id"), p_approve: form.get("decision") === "approve", p_note: s(form, "note") || null });
  go("/os/payroll", error, ctx.locale, "loan_decided");
}
export async function disburseLoan(form: FormData) {
  const ctx = await getContext();
  const { error } = await ctx.supabase.rpc("disburse_loan", { p_loan: s(form, "id"), p_method: s(form, "method"), p_reference: s(form, "reference") });
  go("/os/payroll", error, ctx.locale, "loan_paid");
}

// ---------- Payroll
export async function saveAdjustment(form: FormData) {
  const ctx = await getContext();
  const { error } = await ctx.supabase.rpc("save_payroll_adjustment", { p_employee: s(form, "employee_id"), p_period: `${s(form, "period")}-01`,
    p_code: s(form, "component"), p_amount: Number(s(form, "amount")), p_reason: s(form, "reason") });
  go("/os/payroll", error, ctx.locale, "adjustment");
}

export async function preparePayroll(form: FormData) {
  const ctx = await getContext();
  const { data, error } = await ctx.supabase.rpc("prepare_payroll", { p_branch: ctx.branchId, p_period: `${s(form, "period")}-01` });
  if (error) go("/os/payroll", error, ctx.locale);
  go(`/os/payroll/${(data as { id: string }).id}`, null, ctx.locale, "prepared");
}

async function runStep(form: FormData, fn: string, args: Record<string, unknown>, ok: string) {
  const ctx = await getContext();
  const id = s(form, "run_id");
  const { error } = await ctx.supabase.rpc(fn, { p_run: id, ...args });
  go(`/os/payroll/${id}`, error, ctx.locale, ok);
}
export async function approvePayroll(form: FormData) { await runStep(form, "approve_payroll", {}, "approved"); }
export async function payPayroll(form: FormData) { await runStep(form, "pay_payroll", { p_method: s(form, "method"), p_reference: s(form, "reference") }, "paid"); }
export async function cancelPayroll(form: FormData) { await runStep(form, "cancel_payroll", { p_reason: s(form, "reason") }, "cancelled"); }

export async function payLiability(form: FormData) {
  const ctx = await getContext();
  const { error } = await ctx.supabase.rpc("pay_payroll_liability", { p_branch: ctx.branchId, p_kind: s(form, "kind"), p_period: `${s(form, "period")}-01`,
    p_amount: Number(s(form, "amount")), p_reference: s(form, "reference") });
  go("/os/payroll", error, ctx.locale, "liability_paid");
}

// ---------- Payroll settings
export async function saveComponent(form: FormData) {
  const ctx = await getContext();
  const { error } = await ctx.supabase.rpc("save_payroll_component", { p_code: s(form, "code"), p: { rate: s(form, "rate"), is_active: form.get("is_active") === "on" } });
  go("/os/payroll/settings", error, ctx.locale, "saved");
}
export async function saveSetting(form: FormData) {
  const ctx = await getContext();
  const v = s(form, "value");
  const { error } = await ctx.supabase.rpc("save_payroll_setting", { p_key: s(form, "key"), p_value: v === "" ? null : Number(v), p_note: null });
  go("/os/payroll/settings", error, ctx.locale, "saved");
}
export async function saveBrackets(form: FormData) {
  const ctx = await getContext();
  const rows: { from: number; to: number | null; rate: number }[] = [];
  for (let i = 0; i < 10; i++) {
    const from = s(form, `from_${i}`), rate = s(form, `rate_${i}`);
    if (from === "" || rate === "") continue;
    const to = s(form, `to_${i}`);
    rows.push({ from: Number(from), to: to === "" ? null : Number(to), rate: Number(rate) });
  }
  const { error } = await ctx.supabase.rpc("save_tax_brackets", { p_effective: s(form, "effective"), p_rows: rows });
  go("/os/payroll/settings", error, ctx.locale, "saved");
}

export async function saveDevice(form: FormData) {
  const ctx = await getContext();
  const { error } = await ctx.supabase.rpc("save_attendance_device", { p_branch: ctx.branchId, p_serial: s(form, "serial_no"), p_name: s(form, "name"),
    p_active: form.get("is_active") !== "off" });
  go("/os/hr/attendance", error, ctx.locale, "device");
}

// ---------- Annual increments and end of service
export async function applySalaryIncrement(form: FormData) {
  const ctx = await getContext();
  const { data, error } = await ctx.supabase.rpc("apply_salary_increment", { p_branch: ctx.branchId, p_effective: `${s(form, "month")}-01`,
    p_percent: Number(s(form, "percent") || 0), p_component: s(form, "component") || "BASIC", p_employees: null, p_note: s(form, "note") || null });
  go("/os/hr", error, ctx.locale, `increment_${data ?? 0}`);
}

export async function prepareEos(form: FormData) {
  const ctx = await getContext();
  const id = s(form, "employee_id");
  const { error } = await ctx.supabase.rpc("prepare_eos", { p_employee: id, p_encash_leave: form.get("encash") === "on",
    p_gratuity: Number(s(form, "gratuity") || 0), p_other_earnings: Number(s(form, "other_earnings") || 0), p_tax: Number(s(form, "tax") || 0),
    p_other_deductions: Number(s(form, "other_deductions") || 0), p_note: s(form, "note") || null });
  go(`/os/hr/employees/${id}`, error, ctx.locale, "eos_prepared");
}

export async function decideEos(form: FormData) {
  const ctx = await getContext();
  const id = s(form, "employee_id");
  const { error } = await ctx.supabase.rpc("decide_eos", { p_id: s(form, "eos_id"), p_approve: s(form, "decision") === "approve", p_reason: s(form, "reason") || null });
  go(`/os/hr/employees/${id}`, error, ctx.locale, s(form, "decision") === "approve" ? "eos_approved" : "eos_cancelled");
}

export async function payEos(form: FormData) {
  const ctx = await getContext();
  const id = s(form, "employee_id");
  const { error } = await ctx.supabase.rpc("pay_eos", { p_id: s(form, "eos_id"), p_method: s(form, "method"), p_reference: s(form, "reference") });
  go(`/os/hr/employees/${id}`, error, ctx.locale, "eos_paid");
}

// ---------- Performance
export async function saveReviewCriterion(form: FormData) {
  const ctx = await getContext();
  const { error } = await ctx.supabase.rpc("save_review_criterion", { p_code: s(form, "code"), p: {
    name_ar: s(form, "name_ar"), name_en: s(form, "name_en"), applies_to: s(form, "applies_to"), weight: s(form, "weight"), is_active: form.get("is_active") !== "off" } });
  go(`/os/hr/performance?m=${s(form, "m")}`, error, ctx.locale, "criterion");
}

export async function savePerformanceReview(form: FormData) {
  const ctx = await getContext();
  const scores: Record<string, number> = {};
  for (const [k, v] of Array.from(form.entries())) { const m = /^score_([A-Z][A-Z0-9_]+)$/.exec(k); if (m && String(v)) scores[m[1]] = Number(v); }
  const { data, error } = await ctx.supabase.rpc("save_performance_review", { p: {
    id: s(form, "id") || null, employee_id: s(form, "employee_id"), period_from: s(form, "period_from"), period_to: s(form, "period_to"), scores,
    strengths: s(form, "strengths"), improvements: s(form, "improvements"), goals: s(form, "goals") }, p_submit: s(form, "submit") === "1" });
  const id = (data as { id?: string } | null)?.id;
  go(`/os/hr/performance?m=${s(form, "m")}${id && s(form, "submit") !== "1" ? `&review=${id}` : ""}`, error, ctx.locale, s(form, "submit") === "1" ? "review_submitted" : "review_saved");
}

export async function acknowledgeReview(form: FormData) {
  const ctx = await getContext();
  const { error } = await ctx.supabase.rpc("acknowledge_review", { p_id: s(form, "id"), p_comment: s(form, "comment") });
  go("/os/me", error, ctx.locale, "review_ack");
}
