// Golden Friday lead flow — the 12 acceptance tests through the real stack (signed Meta webhook → database → call
// center → dashboard). Run on a freshly seeded local stack with WHATSAPP_APP_SECRET set in .env.local.
// Synthetic data only.
import { readFileSync } from "node:fs";
import { createHmac } from "node:crypto";
import puppeteer from "puppeteer-core";
import { passMfa } from "./mfa.mjs";

const BASE = "http://localhost:3100";
const OUT = process.env.E2E_OUT ?? "/tmp/";
const PASS = "GoldenCare-Demo-2026";
const env = Object.fromEntries(readFileSync(new URL("../.env.local", import.meta.url), "utf8").split("\n").filter((l) => l.includes("=") && !l.startsWith("#"))
  .map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1)]));
const SECRET = env.WHATSAPP_APP_SECRET;
if (!SECRET) throw new Error("set WHATSAPP_APP_SECRET in .env.local");

let exe = process.env.CHROME_PATH;
if (!exe) { try { exe = await (await import("@sparticuz/chromium")).default.executablePath(); } catch { exe = "/usr/bin/google-chrome"; } }
const browser = await puppeteer.launch({ executablePath: exe, args: ["--no-sandbox", "--disable-dev-shm-usage"], headless: "shell",
  defaultViewport: { width: 1440, height: 900, deviceScaleFactor: 1 } });
const shot = async (p, n) => { await p.evaluate(() => window.scrollTo(0, 0)); await p.screenshot({ path: OUT + n + ".png", fullPage: true }); };
const text = (p) => p.evaluate(() => document.body.innerText);
const go = (p, url) => p.goto(BASE + url, { waitUntil: "networkidle0" });
const submit = (page, selector) => Promise.all([page.waitForNavigation({ waitUntil: "networkidle0" }), page.click(selector)]);
const check = (cond, msg) => { console.log((cond ? "OK   " : "FAIL ") + msg); if (!cond) process.exitCode = 1; };
const cairoDate = (d) => d.toLocaleDateString("en-CA", { timeZone: "Africa/Cairo" });
const cairoTime = (d) => d.toLocaleTimeString("en-GB", { timeZone: "Africa/Cairo", hour: "2-digit", minute: "2-digit" });

async function login(email) {
  const ctx = await browser.createBrowserContext();
  const page = await ctx.newPage();
  page.on("pageerror", (e) => console.log("PAGEERROR", e.message));
  page.on("dialog", (d) => d.accept());
  await go(page, "/os/login");
  await page.type("#email", email);
  await page.type("#password", PASS);
  await page.click("button[type=submit]");
  await page.waitForFunction(() => !["/os", "/os/login"].includes(location.pathname), { timeout: 15000 }).catch(() => {});
  await page.waitForNetworkIdle({ idleTime: 400 }).catch(() => {});
  await passMfa(page, email);
  return page;
}

/** Sends a Meta-format webhook, signed like Meta signs it. */
async function webhook(payload, { sign = true, badSig = false } = {}) {
  const raw = JSON.stringify(payload);
  const sig = "sha256=" + createHmac("sha256", badSig ? "wrong" : SECRET).update(raw).digest("hex");
  const res = await fetch(`${BASE}/api/webhooks/whatsapp`, { method: "POST", headers: { "Content-Type": "application/json", ...(sign ? { "X-Hub-Signature-256": sig } : {}) }, body: raw });
  return { status: res.status, body: await res.json().catch(() => null) };
}
const PHONE = "201009876543";
const msg = (id, body, extra = {}) => ({
  object: "whatsapp_business_account",
  entry: [{ id: "WABA", changes: [{ field: "messages", value: {
    messaging_product: "whatsapp", metadata: { display_phone_number: "201000000000", phone_number_id: "PNID" },
    contacts: [{ profile: { name: "نورهان (تجربة)" }, wa_id: PHONE }],
    messages: [{ from: PHONE, id, timestamp: String(Math.floor(Date.now() / 1000) - (extra.ago ?? 0)), type: "text", text: { body }, ...(extra.referral ? { referral: extra.referral } : {}) }],
  } }] }],
});

// ---------- Agents start their shift; the director opens the control page
const cc1 = await login("cc1@demo.goldencare.local");
check(cc1.url().endsWith("/os/calls"), "agent lands on the call center queue");
await submit(cc1, "form:has(input[name=on]) button");
check((await text(cc1)).includes("في الوردية"), "agent 1 on duty");
const cc2 = await login("cc2@demo.goldencare.local");
await submit(cc2, "form:has(input[name=on]) button");
check((await text(cc2)).includes("في الوردية"), "agent 2 on duty");
const boss = await login("director@demo.goldencare.local");
await go(boss, "/os/golden");
const totalBefore = Number(await boss.$eval("[data-dashboard] .num", (e) => e.textContent));

// ---------- Webhook security
check((await webhook(msg("wamid.E2E0", "x"), { sign: false })).status === 401, "unsigned webhook rejected (401)");
check((await webhook(msg("wamid.E2E0", "x"), { badSig: true })).status === 401, "forged signature rejected (401)");

// ---------- TEST 1–3: a Click-to-WhatsApp message arrives (7 minutes ago) → lead created, campaign detected
const referral = { source_url: "https://fb.me/2xYz", source_id: "120219999000001", source_type: "ad", headline: "الجمعة الذهبية — ليزر", ctwa_clid: "ARAkTestClick" };
const r1 = await webhook(msg("wamid.E2E1", "مرحبًا، عايزة تفاصيل GF26-LASER", { referral, ago: 7 * 60 }));
check(r1.status === 200, "TEST 1: WhatsApp message accepted (200)");
const code = r1.body?.leads?.[0];
check(/^GF26-[2-9A-HJ-NP-Z]{6}$/.test(code ?? ""), `TEST 2: lead created with id ${code}`);
const r1b = await webhook(msg("wamid.E2E1", "مرحبًا، عايزة تفاصيل GF26-LASER", { referral }));
const r2 = await webhook(msg("wamid.E2E2", "السعر كام؟"));
check(r1b.status === 200 && r1b.body.leads[0] === code && r2.body.leads[0] === code, "TEST 11: Meta retry + follow-up message → same lead");

// ---------- TEST 4–5: appears instantly in exactly one agent's queue (auto-assigned)
await go(cc1, "/os/calls"); await go(cc2, "/os/calls");
const in1 = Boolean(await cc1.$(`[data-lead="${code}"]`)), in2 = Boolean(await cc2.$(`[data-lead="${code}"]`));
check(in1 !== in2, "TEST 5: assigned to exactly one agent (round-robin)");
const owner = in1 ? cc1 : cc2, other = in1 ? cc2 : cc1;
const card = await owner.$eval(`[data-lead="${code}"]`, (e) => e.innerText);
check(card.includes("GF26-LASER") && card.includes("نورهان") && card.includes("عاجل"), "TEST 4: card shows id, name, campaign and 🔴 URGENT (waiting 7 min)");
await shot(owner, "gf-01-call-center-urgent");
await go(boss, "/os/golden");
check((await boss.$eval("[data-alert=urgent]", (e) => e.innerText)).includes(code), "control page lists it under 🔴 URGENT");
const totalAfter = Number(await boss.$eval("[data-dashboard] .num", (e) => e.textContent));
check(totalAfter === totalBefore + 1, `TEST 10a: total leads on the dashboard ${totalBefore} → ${totalAfter}`);

// ---------- TEST 12: isolation
await go(other, `/os/calls/${await owner.$eval(`[data-lead="${code}"] a`, (a) => a.getAttribute("href").split("/").pop())}`);
check((await text(other)).includes("غير مسند لك"), "TEST 12a: the other agent cannot open the lead");
const anon = await (await browser.createBrowserContext()).newPage();
await anon.goto(`${BASE}/os/calls`, { waitUntil: "networkidle0" });
check(anon.url().includes("/os/login"), "TEST 12b: signed-out visitor is sent to login");
const rest = await fetch(`http://localhost:54321/rest/v1/leads?select=code,phone`, { headers: { apikey: env.NEXT_PUBLIC_SUPABASE_ANON_KEY, Authorization: `Bearer ${env.NEXT_PUBLIC_SUPABASE_ANON_KEY}` } });
const restBody = await rest.text();
check(!restBody.includes(code), `TEST 12c: public API key cannot read leads (HTTP ${rest.status})`);
const nurse = await login("nurse@demo.goldencare.local");
await go(nurse, "/os/calls");
check(!nurse.url().includes("/os/calls"), "TEST 12d: a nurse cannot open the call center");
const mkt = await login("marketing@demo.goldencare.local");
const exp = await mkt.goto(`${BASE}/os/golden/export`, { waitUntil: "networkidle0" }).catch(() => null);
check(exp && exp.status() === 403, "TEST 12e: marketing cannot export (403)");

// ---------- TEST 6–7: agent marks CONTACTED → response time
await go(owner, "/os/calls");
await submit(owner, `[data-lead="${code}"] form:has(input[name=status][value=contacted]) button`);
const leadUrl = await owner.$eval(`[data-lead="${code}"] a`, (a) => a.getAttribute("href"));
await go(owner, leadUrl);
const t6 = await text(owner);
check(t6.includes("تم التواصل"), "TEST 6: status CONTACTED");
check(/زمن الرد\s*\n?\s*7 د/.test(t6) && t6.includes("✗"), "TEST 7: response time 7 min, SLA ✗ (target 5)");

// ---------- TEST 8: follow-up
const later = new Date(Date.now() + 2 * 3600_000);
await owner.click("details:has(input[name=status][value=follow_up]) summary");
await owner.$eval("input[name=fu_date]", (e, v) => { e.value = v; }, cairoDate(later));
await owner.$eval("input[name=fu_time]", (e, v) => { e.value = v; }, cairoTime(later));
await owner.select("details:has(input[name=status][value=follow_up]) select[name=reason]", "يفكر / يستشير");
await owner.type("details:has(input[name=status][value=follow_up]) textarea[name=notes]", "تستشير زوجها — كلمها بعد العصر");
await submit(owner, "details:has(input[name=status][value=follow_up]) button[type=submit]");
const t8 = await text(owner);
check(t8.includes("متابعة") && t8.includes("يفكر / يستشير"), "TEST 8: follow-up saved with reason");
await go(owner, "/os/calls?view=followups");
check(Boolean(await owner.$(`[data-lead="${code}"]`)), "TEST 8b: listed in today's follow-ups");

// WhatsApp reply from the system (dev messaging: logged, not sent)
await go(owner, leadUrl);
await owner.type("form:has(input[name=id]) textarea[name=body][placeholder]", "أهلاً نورهان، تفاصيل العرض: جلسة ليزر كاملة بخصم الجمعة الذهبية.");
await submit(owner, "form:has(textarea[placeholder]) button[type=submit]");
check((await text(owner)).includes("بخصم الجمعة الذهبية"), "reply from the system appears in the conversation history");

// ---------- TEST 9: booked
const day = new Date(Date.now() + 2 * 86400_000);
await owner.click("details:has(input[name=status][value=booked]) summary");
await owner.$eval("input[name=bk_date]", (e, v) => { e.value = v; }, cairoDate(day));
await owner.$eval("input[name=bk_time]", (e) => { e.value = "17:30"; });
const svc = await owner.$eval("details:has(input[name=status][value=booked]) input[name=service]", (e) => e.value);
await owner.type("details:has(input[name=status][value=booked]) textarea[name=notes]", "دفعت عربون");
await submit(owner, "details:has(input[name=status][value=booked]) button[type=submit]");
const t9 = await text(owner);
check(t9.includes("تم الحجز") && t9.includes("17:30") && svc === "Laser", "TEST 9: BOOKED with date/time and the campaign's service prefilled");
await shot(owner, "gf-02-lead-workspace-booked");

// Booked customer writes again → same lead
const r3 = await webhook(msg("wamid.E2E3", "تأكيد الموعد GF26-LASER"));
check(r3.body.leads[0] === code, "TEST 11b: message after booking still joins the same lead");

// ---------- TEST 10: dashboard and reports updated from the database
await go(boss, "/os/golden");
const dash = await text(boss);
const campRow = await boss.$$eval("table tr", (rows) => rows.map((r) => r.innerText).find((t) => t.includes("GF26-LASER")) ?? "");
const campFlat = campRow.replace(/\s+/g, " ");
check(/GF26-LASER .* 1 1 1 1 1 100% 7 د 0%/.test(campFlat), `TEST 10b: campaign row = 1 lead · 1 contacted · 1 interested · 1 follow-up · 1 booked · 100% · 7 min · SLA 0% (${campFlat})`);
check(dash.includes("أحمد — كول سنتر") || dash.includes("منة — كول سنتر"), "TEST 10c: agent report shows the agent");
check(!(await boss.$eval("[data-alert=urgent]", (e) => e.innerText)).includes(code), "TEST 10d: no longer urgent");
await shot(boss, "gf-03-control-dashboard");
const csv = await boss.evaluate(async () => (await fetch("/os/golden/export")).text());
check(csv.includes(code) && csv.includes("booked") && csv.includes("GF26-LASER") && csv.includes("120219999000001"), "export CSV contains the lead, status, campaign and ad id");

await go(boss, "/os/golden/settings");
check((await text(boss)).includes("/api/webhooks/whatsapp"), "settings show the webhook URL and integration checklist");
await shot(boss, "gf-04-settings");

// Mobile view of the call center
await owner.setViewport({ width: 390, height: 844, deviceScaleFactor: 2 });
await go(owner, "/os/calls?view=booked");
await shot(owner, "gf-05-call-center-mobile");

await browser.close();
