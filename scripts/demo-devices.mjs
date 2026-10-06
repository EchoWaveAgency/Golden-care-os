// Demo devices, maintenance history and laser packages (synthetic data, local stack only).
import { createClient } from "@supabase/supabase-js";
import { elevate } from "./local/totp.mjs";

const must = (r, w) => { if (r.error) throw new Error(`${w}: ${r.error.message}`); return r.data; };

export async function seedDevices({ db, url, PASSWORD, BRANCH }) {
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
    // A laser room for the branch.
    let room = must(await db.from("rooms").select("id").eq("branch_id", BRANCH).eq("code", "LSR1"), "room")[0];
    if (!room) room = must(await db.from("rooms").insert({ branch_id: BRANCH, code: "LSR1", name_ar: "غرفة الليزر 1", name_en: "Laser room 1", kind: "laser" }).select("id").single(), "room");
    let agent = must(await db.from("suppliers").select("id").eq("name_ar", "الوكيل المعتمد لأجهزة الليزر (تجريبي)"), "agent")[0];
    if (!agent) agent = must(await db.from("suppliers").insert({ name_ar: "الوكيل المعتمد لأجهزة الليزر (تجريبي)", name_en: "Authorised laser agent (demo)", phone: "0221111111" }).select("id").single(), "agent");

    // A dental laboratory supplier (synthetic).
    const lab = must(await db.from("suppliers").select("id").eq("name_ar", "معمل الأسنان (تجريبي)"), "lab")[0];
    if (!lab) must(await db.from("suppliers").insert({ name_ar: "معمل الأسنان (تجريبي)", name_en: "Dental lab (demo)", phone: "0222222222", is_lab: true }), "lab");

    const already = must(await db.from("devices").select("id").eq("asset_no", "LSR-ELITE-01"), "device check");
    if (!already.length) {
      const dev = await login("devices@demo.goldencare.local");
      const d = (days) => new Date(Date.now() + days * 86400000).toISOString().slice(0, 10);
      const elite = must(await dev.rpc("save_device", { p: {
        asset_no: "LSR-ELITE-01", branch_id: BRANCH, room_id: room.id, name_ar: "ليزر سينوشور إليت بلس", name_en: "Cynosure Elite+ laser", category: "laser",
        manufacturer: "Cynosure", model: "Elite+", serial_no: "DEMO-EP-0001", supplier_id: agent.id, purchase_date: d(-700), purchase_cost: 2400000,
        warranty_until: d(20), counter_unit: "pulses", counter_value: 1245300, expected_life: 3000000, service_every: 250000,
        pm_interval_days: 90, calibration_interval_days: 180,
        params: { wavelengths: [755, 1064], spot_mm: [6, 8, 10, 12, 15, 18], fluence: { 755: [2, 50], 1064: [2, 300] }, pulse_width_ms: [0.35, 300] },
        notes: "جهاز تجريبي — الإعدادات المعتمدة يحددها المدير الطبي.",
      } }), "elite");
      must(await dev.rpc("save_device", { p: {
        asset_no: "STER-AUTO-01", branch_id: BRANCH, name_ar: "جهاز تعقيم (أوتوكلاف)", name_en: "Autoclave steriliser", category: "sterilization",
        manufacturer: "Demo", model: "B-Class 23L", serial_no: "DEMO-AC-0001", pm_interval_days: 30, calibration_interval_days: 365,
      } }), "autoclave");
      // History: a preventive visit closed with costs.
      const wo = must(await dev.rpc("open_work_order", { p_device: elite.id, p_kind: "preventive", p_problem: "صيانة وقائية ربع سنوية", p_device_down: true }), "wo");
      must(await dev.rpc("close_work_order", { p_order: wo.id, p: { result: "تنظيف الفلاتر وفحص نظام التبريد ومعايرة الطاقة", technician: "مهندس الوكيل",
        vendor_id: agent.id, parts: "فلتر مياه", parts_cost: 1800, labor_cost: 1200 } }), "wo close");
    }

    const tplHas = must(await db.from("package_templates").select("id").eq("code", "LSR-AX-6"), "tpl check");
    if (!tplHas.length) {
      const acc = await login("accountant@demo.goldencare.local");
      const svc = Object.fromEntries(must(await db.from("services").select("id, code"), "services").map((x) => [x.code, x.id]));
      must(await acc.rpc("save_package_template", { p: { code: "LSR-AX-6", name_ar: "ليزر الإبط — 6 جلسات", name_en: "Underarm laser — 6 sessions",
        service_id: svc["LASER-AXILLA"], sessions: 6, price: 4500, validity_days: 365, terms_ar: "صالحة سنة من تاريخ الشراء. غير قابلة للتحويل." } }), "tpl ax");
      must(await acc.rpc("save_package_template", { p: { code: "LSR-FULL-6", name_ar: "ليزر الجسم كامل — 6 جلسات", name_en: "Full body laser — 6 sessions",
        service_id: svc["LASER-FULL"], sessions: 6, price: 22500, validity_days: 365 } }), "tpl full");
    }
  } finally {
    for (const done of cleanups) await done().catch(() => {});
  }
}
