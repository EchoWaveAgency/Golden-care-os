// Demo data for the finance screens added in session 13: a proposed dental treatment plan that the patient can accept
// and pay online from the portal (up to 3 monthly installments). Synthetic data, local stack only.
import { createClient } from "@supabase/supabase-js";
import { elevate } from "./local/totp.mjs";

const must = (r, w) => { if (r.error) throw new Error(`${w}: ${r.error.message}`); return r.data; };

export async function seedFinance({ db, url, PASSWORD, BRANCH }) {
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
    const pat = must(await db.from("patients").select("id").eq("phone", "+201001110002"), "patient")[0];
    if (!pat) return;
    if (must(await db.from("treatment_plans").select("id").eq("patient_id", pat.id), "plans").length) return;
    const svc = Object.fromEntries(must(await db.from("services").select("id, code"), "services").map((x) => [x.code, x.id]));
    const dr = await login("dr.dental@demo.goldencare.local");
    const plan = must(await dr.rpc("save_treatment_plan", { p: { patient_id: pat.id, branch_id: BRANCH, title: "حشو ضرسين وتنظيف جير",
      items: [{ service_id: svc["DENT-FILL"], tooth: "36", surfaces: "MO" }, { service_id: svc["DENT-FILL"], tooth: "46", surfaces: "O" }, { service_id: svc["DENT-SCALE"] }] } }), "plan");
    must(await dr.rpc("propose_plan", { p_plan: plan.id, p_valid_days: 30 }), "propose");
    const rec = await login("reception@demo.goldencare.local");
    must(await rec.rpc("set_plan_portal_options", { p_plan: plan.id, p_max_installments: 3 }), "portal options");
  } finally {
    for (const done of cleanups) await done().catch(() => {});
  }
}
