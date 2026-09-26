// Creates SYNTHETIC demo users and data for staging/demo environments only.
// Usage: node --env-file=.env.local scripts/demo-data.mjs
// Never run against production. Never use real patient data.
import { createClient } from "@supabase/supabase-js";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) throw new Error("NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required");
if (process.env.GC_ENV === "production") throw new Error("Refusing to seed demo data in production");

const db = createClient(url, key, { auth: { persistSession: false } });
const PASSWORD = process.env.DEMO_PASSWORD ?? "GoldenCare-Demo-2026";
const BRANCH = "00000000-0000-4000-8000-000000000101";

const must = (r, what) => { if (r.error) throw new Error(`${what}: ${r.error.message}`); return r.data; };

const people = [
  { email: "owner@demo.goldencare.local", ar: "مالك تجريبي", en: "Demo Owner", role: "owner", branch: null },
  { email: "director@demo.goldencare.local", ar: "مدير المركز", en: "Center Director", role: "center_director", branch: null },
  { email: "admin@demo.goldencare.local", ar: "مدير النظام", en: "System Admin", role: "system_admin", branch: null },
  { email: "reception@demo.goldencare.local", ar: "منى عبد الله", en: "Mona Abdallah", role: "front_desk", branch: BRANCH, kind: "reception" },
  { email: "relations@demo.goldencare.local", ar: "ريم سامي", en: "Reem Samy", role: "patient_relations", branch: BRANCH, kind: "patient_relations" },
  { email: "dr.derm@demo.goldencare.local", ar: "د. سارة منصور", en: "Dr. Sara Mansour", role: "doctor", branch: BRANCH, kind: "doctor", specialty: "derm" },
  { email: "dr.dental@demo.goldencare.local", ar: "د. كريم الشريف", en: "Dr. Karim El-Sherif", role: "doctor", branch: BRANCH, kind: "doctor", specialty: "dental" },
  { email: "dr.obgyn@demo.goldencare.local", ar: "د. هالة فوزي", en: "Dr. Hala Fawzy", role: "doctor", branch: BRANCH, kind: "doctor", specialty: "obgyn" },
  { email: "nurse@demo.goldencare.local", ar: "ممرضة نادية", en: "Nurse Nadia", role: "nurse", branch: BRANCH, kind: "nurse" },
  { email: "accountant@demo.goldencare.local", ar: "رئيس الحسابات", en: "Chief Accountant", role: "chief_accountant", branch: null, kind: "finance" },
  { email: "cashier@demo.goldencare.local", ar: "أمين الخزينة", en: "Cashier", role: "cashier", branch: BRANCH, kind: "finance" },
  { email: "auditor@demo.goldencare.local", ar: "المراجع المالي", en: "Financial Auditor", role: "financial_auditor", branch: null },
];

const specialties = must(await db.from("specialties").select("id, code"), "specialties");
const spec = Object.fromEntries(specialties.map((s) => [s.code, s.id]));

const existing = must(await db.auth.admin.listUsers({ perPage: 200 }), "list users").users;
const ids = {};
for (const p of people) {
  let u = existing.find((x) => x.email === p.email);
  if (!u) u = must(await db.auth.admin.createUser({ email: p.email, password: PASSWORD, email_confirm: true }), p.email).user;
  ids[p.email] = u.id;
  must(await db.from("profiles").upsert({ user_id: u.id, full_name_ar: p.ar, full_name_en: p.en }), "profile");
  const has = must(await db.from("user_roles").select("id").eq("user_id", u.id).eq("role_code", p.role), "roles");
  if (!has.length) must(await db.from("user_roles").insert({ user_id: u.id, role_code: p.role, branch_id: p.branch, reason: "demo" }), "grant");
  if (p.kind) {
    must(await db.from("staff").upsert({ user_id: u.id, branch_id: BRANCH, kind: p.kind, full_name_ar: p.ar, full_name_en: p.en,
      specialty_id: p.specialty ? spec[p.specialty] : null }, { onConflict: "user_id" }), "staff");
  }
}

// Services and prices (illustrative — replace with Golden Care's approved price list)
const accounts = must(await db.from("accounts").select("id, code"), "accounts");
const acc = Object.fromEntries(accounts.map((a) => [a.code, a.id]));
const services = [
  ["DERM-CONS", "derm", "كشف جلدية", "Dermatology consultation", 500, null],
  ["LASER-AXILLA", "derm", "ليزر إزالة شعر - الإبط", "Laser hair removal - underarm", 900, "4110"],
  ["LASER-FULL", "derm", "ليزر إزالة شعر - الجسم كامل", "Laser hair removal - full body", 4500, "4110"],
  ["DENT-CONS", "dental", "كشف أسنان", "Dental consultation", 400, "4120"],
  ["DENT-SCALE", "dental", "تنظيف جير", "Scaling & polishing", 800, "4120"],
  ["DENT-FILL", "dental", "حشو كومبوزيت", "Composite filling", 1200, "4120"],
  ["OBGYN-CONS", "obgyn", "كشف نساء وتوليد", "OB/GYN consultation", 600, null],
  ["OBGYN-US", "obgyn", "سونار", "Ultrasound", 700, null],
];
must(await db.from("services").upsert(services.map(([code, s, ar, en, , rev]) => ({ code, specialty_id: spec[s], name_ar: ar, name_en: en, revenue_account_id: rev ? acc[rev] : null })), { onConflict: "code" }), "services");
const svc = must(await db.from("services").select("id, code"), "services read");
let pl = must(await db.from("price_lists").select("id").eq("branch_id", BRANCH).eq("is_default", true), "price list")[0];
if (!pl) pl = must(await db.from("price_lists").insert({ branch_id: BRANCH, code: "STD", name_ar: "الأسعار الأساسية", name_en: "Standard", is_default: true }).select("id").single(), "pl");
const priced = new Set(must(await db.from("price_list_items").select("service_id").eq("price_list_id", pl.id), "prices").map((r) => r.service_id));
const year = new Date().getFullYear();
const newPrices = services.map(([code, , , , price]) => ({ price_list_id: pl.id, service_id: svc.find((x) => x.code === code).id, price, effective: `[${year}-01-01,)` }))
  .filter((r) => !priced.has(r.service_id));
if (newPrices.length) must(await db.from("price_list_items").insert(newPrices), "price items");

// Synthetic patients and today's appointments
const names = [["نورهان", "عادل", "01001110001"], ["محمد", "السيد", "01001110002"], ["ياسمين", "طارق", "01001110003"],
  ["عمر", "خالد", "01001110004"], ["دينا", "مجدي", "01001110005"], ["حسام", "رمضان", "01001110006"]];
const patients = [];
for (const [f, l, ph] of names) {
  const found = must(await db.from("patients").select("id").eq("phone", "+2" + ph), "p find")[0];
  patients.push(found ?? must(await db.from("patients").insert({ branch_id: BRANCH, first_name_ar: f, last_name_ar: l, phone_raw: ph }).select("id").single(), "patient"));
}
const doctors = must(await db.from("staff").select("id, specialty_id, full_name_en").eq("kind", "doctor"), "doctors");
const day = new Intl.DateTimeFormat("en-CA", { timeZone: "Africa/Cairo" }).format(new Date());
const already = must(await db.from("appointments").select("id").overlaps("slot", `[${day}T00:00:00+03:00,${day}T23:59:00+03:00)`), "apts");
if (!already.length) {
  const slots = ["10:00", "10:30", "11:00", "12:00", "13:00", "14:00"];
  for (let i = 0; i < patients.length; i++) {
    const d = doctors[i % doctors.length];
    const start = new Date(`${day}T${slots[i]}:00+03:00`);
    const end = new Date(start.getTime() + 20 * 60000);
    must(await db.from("appointments").insert({ branch_id: BRANCH, patient_id: patients[i].id, doctor_id: d.id, specialty_id: d.specialty_id,
      slot: `[${start.toISOString()},${end.toISOString()})`, channel: i % 2 ? "whatsapp" : "phone" }), "appointment");
  }
}
console.log(`Demo ready. ${people.length} users (password: ${PASSWORD}), ${patients.length} patients, today's schedule created.`);
for (const p of people) console.log(`  ${p.role.padEnd(18)} ${p.email}`);
