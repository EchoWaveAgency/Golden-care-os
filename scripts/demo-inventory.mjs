// Synthetic demo inventory: store, suppliers, items, service templates, and one goods receipt posted
// through the real RPC by the demo inventory controller. Local/demo only.
import { createClient } from "@supabase/supabase-js";
import { randomUUID } from "node:crypto";

export async function seedInventory({ db, url, PASSWORD, BRANCH }) {
  const must = (r, w) => { if (r.error) throw new Error(`${w}: ${r.error.message}`); return r.data; };
  let loc = must(await db.from("inv_locations").select("id").eq("branch_id", BRANCH).eq("code", "MAIN"), "loc")[0];
  if (!loc) loc = must(await db.from("inv_locations").insert({ branch_id: BRANCH, code: "MAIN", name_ar: "المخزن الرئيسي", name_en: "Main store" }).select("id").single(), "loc");
  const items = [
    ["GLOVE-M", "جوانتي طبي مقاس M", "Exam gloves (M)", "زوج", "consumable", 50],
    ["GAUZE-10", "شاش معقم 10×10", "Sterile gauze 10×10", "عبوة", "consumable", 20],
    ["GEL-US", "جل تبريد الليزر", "Laser cooling gel", "زجاجة", "consumable", 5],
    ["ANES-CRM", "كريم مخدر موضعي", "Topical numbing cream", "أنبوب", "drug", 5],
    ["LSR-TIP", "طرف جهاز الليزر (قطعة غيار)", "Laser handpiece tip", "قطعة", "laser_part", 1],
    ["COMP-A2", "حشو كومبوزيت A2", "Composite A2", "سرنجة", "dental_material", 3],
  ];
  must(await db.from("inv_items").upsert(items.map(([code, ar, en, unit, category, reorder_level]) => ({ code, name_ar: ar, name_en: en, unit, category, reorder_level })), { onConflict: "code" }), "items");
  const it = Object.fromEntries(must(await db.from("inv_items").select("id, code"), "items read").map((x) => [x.code, x.id]));
  let sup = must(await db.from("suppliers").select("id").eq("name_ar", "شركة المستلزمات الطبية (تجريبي)"), "sup")[0];
  if (!sup) sup = must(await db.from("suppliers").insert({ name_ar: "شركة المستلزمات الطبية (تجريبي)", name_en: "Medical Supplies Co. (demo)", phone: "0220000000" }).select("id").single(), "sup");
  const svc = Object.fromEntries(must(await db.from("services").select("id, code"), "services").map((x) => [x.code, x.id]));
  const tpl = [["DERM-CONS", "GLOVE-M", 1], ["LASER-AXILLA", "GEL-US", 1], ["LASER-AXILLA", "ANES-CRM", 1], ["LASER-AXILLA", "GLOVE-M", 1],
               ["DENT-FILL", "COMP-A2", 1], ["DENT-FILL", "GAUZE-10", 1], ["DENT-SCALE", "GAUZE-10", 1]];
  must(await db.from("service_consumables").upsert(tpl.filter(([s]) => svc[s]).map(([s, i, q]) => ({ service_id: svc[s], item_id: it[i], qty: q }))), "templates");

  const already = must(await db.from("goods_receipts").select("id").eq("supplier_invoice_no", "DEMO-INV-001"), "grn check");
  if (already.length) return;
  const c = createClient(url, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY, { auth: { persistSession: false } });
  const s = await c.auth.signInWithPassword({ email: "inventory@demo.goldencare.local", password: PASSWORD });
  if (s.error) throw new Error(`inventory login: ${s.error.message}`);
  const d = (days) => new Date(Date.now() + days * 86400000).toISOString().slice(0, 10);
  must(await c.rpc("receive_goods", { p_location: loc.id, p_supplier: sup.id, p_supplier_invoice_no: "DEMO-INV-001", p_idempotency_key: randomUUID(), p_lines: [
    { item_id: it["GLOVE-M"], lot_no: "GL-2609", qty: 200, unit_cost: 3.5 },
    { item_id: it["GAUZE-10"], lot_no: "GZ-2609", qty: 60, unit_cost: 12, expiry: d(700) },
    { item_id: it["GEL-US"], lot_no: "GEL-A", qty: 4, unit_cost: 85 },
    { item_id: it["ANES-CRM"], lot_no: "AN-SOON", qty: 3, unit_cost: 140, expiry: d(25) },
    { item_id: it["ANES-CRM"], lot_no: "AN-LATE", qty: 10, unit_cost: 150, expiry: d(400) },
    { item_id: it["COMP-A2"], lot_no: "CMP-11", qty: 8, unit_cost: 420, expiry: d(500) },
    { item_id: it["LSR-TIP"], lot_no: "TIP-1", qty: 2, unit_cost: 2800 },
  ] }), "receipt");
}
