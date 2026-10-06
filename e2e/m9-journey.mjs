// Milestone 9 journey (master-prompt scenario 4): dental treatment plan → quotation → acceptance with installments →
// down payment as an advance → work done and billed from the advance → lab case and lab bill (confirmed by another
// person) → doctor settlement with lab cost share → second item billed → profitability with lab costs.
// Run on a freshly seeded local stack.
import puppeteer from "puppeteer-core";
import chromium from "@sparticuz/chromium";
import { passMfa } from "./mfa.mjs";

const BASE = "http://localhost:3100";
const OUT = process.env.E2E_OUT ?? "/tmp/";
const PASS = "GoldenCare-Demo-2026";
const browser = await puppeteer.launch({ executablePath: await chromium.executablePath(), args: chromium.args.filter((a) => !["--single-process", "--no-zygote"].includes(a)).concat(["--no-sandbox"]), headless: "shell",
  defaultViewport: { width: 1440, height: 900, deviceScaleFactor: 1 } });
const shot = async (p, n) => { await p.evaluate(() => window.scrollTo(0, 0)); const tall = await p.evaluate(() => document.documentElement.scrollHeight > window.innerHeight + 40); await p.screenshot({ path: OUT + n + ".png", fullPage: tall }); };
const text = (p) => p.evaluate(() => document.body.innerText);
const submit = (page, selector) => Promise.all([page.waitForNavigation({ waitUntil: "networkidle0" }), page.click(selector)]);
const check = (cond, msg) => { console.log((cond ? "OK   " : "FAIL ") + msg); if (!cond) process.exitCode = 1; };
const setReact = (page, selector, value) => page.$eval(selector, (el, v) => {
  const proto = el.tagName === "SELECT" ? HTMLSelectElement.prototype : HTMLInputElement.prototype;
  Object.getOwnPropertyDescriptor(proto, "value").set.call(el, v);
  el.dispatchEvent(new Event(el.tagName === "SELECT" ? "change" : "input", { bubbles: true }));
}, String(value));
const optionValue = (page, selector, textPart) => page.$$eval(`${selector} option`, (os, t) => os.find((o) => o.textContent.includes(t))?.value, textPart);
const clickButton = async (page, scope, label) => {
  const handles = await page.$$(`${scope} button`);
  for (const h of handles) if ((await h.evaluate((e) => e.innerText.trim())) === label) { await Promise.all([page.waitForNavigation({ waitUntil: "networkidle0" }), h.click()]); return true; }
  return false;
};

async function login(email) {
  const ctx = await browser.createBrowserContext();
  const page = await ctx.newPage();
  page.on("pageerror", (e) => console.log("PAGEERROR", e.message));
  await page.goto(`${BASE}/os/login`, { waitUntil: "networkidle0" });
  await page.type("#email", email);
  await page.type("#password", PASS);
  await page.click("button[type=submit]");
  await page.waitForFunction(() => !["/os", "/os/login"].includes(location.pathname), { timeout: 15000 }).catch(() => {});
  await page.waitForNetworkIdle({ idleTime: 400 }).catch(() => {});
  await passMfa(page, email);
  return page;
}

// ---------- Reception books the patient with the dentist and checks them in
const rec = await login("reception@demo.goldencare.local");
await rec.goto(`${BASE}/os/patients?q=01001110004`, { waitUntil: "networkidle0" });
await Promise.all([rec.waitForNavigation({ waitUntil: "networkidle0" }), rec.click("a[href^='/os/patients/']:not([href$='/new'])")]);
const patientUrl = rec.url().split("?")[0];
const patientName = (await rec.$eval("h1", (e) => e.innerText)).trim();
await rec.goto(patientUrl.replace(/\/os\/patients\/(.+)$/, "/os/appointments/new?patient=$1"), { waitUntil: "networkidle0" });
const hhmm = new Intl.DateTimeFormat("en-GB", { timeZone: "Africa/Cairo", hour: "2-digit", minute: "2-digit" }).format(new Date(Date.now() + 10 * 60000));
await rec.select("#doctor_id", await optionValue(rec, "#doctor_id", "كريم"));
await rec.$eval("#time", (el, v) => { el.value = v; }, hhmm.slice(0, 4) + "5");
await submit(rec, "button[type=submit]");
check((await text(rec)).includes("تم حجز الموعد"), "appointment booked with the dentist");
await rec.goto(`${BASE}/os/reception`, { waitUntil: "networkidle0" });
let checkin = null;
for (const h of await rec.$$("tr")) {
  const t = await h.evaluate((e) => e.innerText);
  if (t.includes(patientName) && t.includes("كريم")) for (const b of await h.$$("button")) if ((await b.evaluate((e) => e.innerText)).trim() === "تسجيل وصول") checkin = b;
}
await Promise.all([rec.waitForNavigation({ waitUntil: "networkidle0" }), checkin.click()]);

// ---------- Dentist: opens the visit, creates the plan with two lines, issues the quotation
const dr = await login("dr.dental@demo.goldencare.local");
for (const li of await dr.$$("li")) {
  if ((await li.evaluate((e) => e.innerText)).includes(patientName)) { const b = await li.$("button"); if (b) { await Promise.all([dr.waitForNavigation({ waitUntil: "networkidle0" }), b.click()]); break; } }
}
check(dr.url().includes("/os/encounters/"), "dentist opens the visit");
await dr.type("#plan_title", "حشو وتاج زيركون");
await submit(dr, "[data-plans] form button[type=submit]");
check(dr.url().includes("/os/plans/") && (await text(dr)).includes("تم إنشاء مسودة الخطة"), "draft plan created from the visit");
const planUrl = dr.url().split("?")[0];
await setReact(dr, "[data-plan-service='0']", await optionValue(dr, "[data-plan-service='0']", "DENT-FILL"));
await setReact(dr, "[data-plan-tooth='0']", "16");
await setReact(dr, "[data-plan-surfaces='0']", "MO");
await setReact(dr, "[data-plan-discount='0']", "100");
await dr.click("[data-add-plan-row]");
await setReact(dr, "[data-plan-service='1']", await optionValue(dr, "[data-plan-service='1']", "DENT-CROWN"));
await setReact(dr, "[data-plan-tooth='1']", "36");
await dr.click("[data-plan-lab='1']");
await submit(dr, "form:has([data-plan-service]) button[type=submit]");
check((await text(dr)).includes("تم حفظ الخطة") && (await text(dr)).includes("7,100.00"), "plan saved: 1,200 − 100 + 6,000 = 7,100 from the price list");
await submit(dr, "form:has(#valid_days) button[type=submit]");
check((await text(dr)).includes("صدر عرض السعر") && /QT-\d{4}-\d+/.test(await text(dr)), "quotation issued with a number");
await shot(dr, "m9-01-quotation");

// ---------- Reception: acceptance with a down payment and two monthly installments; down payment collected
await rec.goto(planUrl, { waitUntil: "networkidle0" });
await setReact(rec, "#down", "3000");
check((await rec.$eval("[data-inst-check]", (e) => e.innerText)).includes("مطابق"), "schedule 3,000 + 2 monthly adds up to the total");
await submit(rec, "form:has(#down) button[type=submit]");
check((await text(rec)).includes("تم تسجيل موافقة المريض"), "patient acceptance and schedule recorded");
await rec.select("#dep_method", "card");
await rec.type("form:has(#dep_method) input[name=reference]", "POS-M9");
await submit(rec, "form:has(#dep_method) button[type=submit]");
const afterDep = await text(rec);
check(afterDep.includes("تم تحصيل الدفعة") && (await rec.$eval("[data-installment='1']", (e) => e.innerText)).includes("مدفوع"), "down payment received; installment 1 paid");

// ---------- Dentist: filling done; lab case for the crown
await dr.goto(planUrl, { waitUntil: "networkidle0" });
await submit(dr, "form[data-item-done='1'] button[type=submit]");
check((await text(dr)).includes("تم تسجيل تنفيذ البند"), "filling recorded as done");
await dr.click("[data-lab-open='2']");
await dr.type("tr[data-plan-item='2'] input[name=shade]", "A2");
await submit(dr, "tr[data-plan-item='2'] form:has(input[name=work_type]) button[type=submit]");
check((await text(dr)).includes("تم إنشاء طلب المعمل"), "lab case created for the crown");

// ---------- Reception: bill the completed filling, paid from the advance
await rec.goto(planUrl, { waitUntil: "networkidle0" });
await Promise.all([rec.waitForNavigation({ waitUntil: "networkidle0" }), rec.click("form:has(input[name=plan_id]) button.btn-primary")]);
const inv1 = await text(rec);
check(rec.url().includes("/os/billing/") && inv1.includes("تمت فوترة البنود") && inv1.includes("1,100.00") && inv1.includes("مدفوعة"), "filling invoiced (1,100) and paid from the advance");
await shot(rec, "m9-02-invoice-from-advance");

// ---------- Lab: sent → returned → delivered; lab bill recorded by the accountant, confirmed by the director
await dr.goto(`${BASE}/os/lab`, { waitUntil: "networkidle0" });
check(await clickButton(dr, "article[data-lab-case]", "أُرسل للمعمل"), "lab case sent");
check(await clickButton(dr, "article[data-lab-case]", "عاد من المعمل"), "lab case returned");
const acc = await login("accountant@demo.goldencare.local");
await acc.goto(`${BASE}/os/lab`, { waitUntil: "networkidle0" });
await acc.click("[data-lab-bill]");
await acc.type("article[data-lab-case] input[name=bill_no]", "LB-M9-1");
await acc.type("article[data-lab-case] input[name=amount]", "1500");
await submit(acc, "article[data-lab-case] form:has(input[name=bill_no]) button[type=submit]");
check((await text(acc)).includes("تم تسجيل فاتورة المعمل"), "lab bill 1,500 recorded (Dr lab costs / Cr suppliers payable)");
await shot(acc, "m9-03-lab");
// A bill entered by mistake is voided (journal reversed, case cost back to 1,500)
await acc.click("[data-lab-bill]");
await acc.type("article[data-lab-case] input[name=bill_no]", "LB-M9-WRONG");
await acc.type("article[data-lab-case] input[name=amount]", "999");
await submit(acc, "article[data-lab-case] form:has(input[name=bill_no]) button[type=submit]");
await acc.goto(`${BASE}/os/suppliers`, { waitUntil: "networkidle0" });
const labHrefAcc = await acc.$$eval("a[href^='/os/suppliers/']", (as) => as.find((a) => a.innerText.includes("معمل الأسنان"))?.getAttribute("href"));
await acc.goto(BASE + labHrefAcc, { waitUntil: "networkidle0" });
await acc.click("[data-void-bill='LB-M9-WRONG']");
const voidForm = await acc.$eval("[data-void-bill='LB-M9-WRONG']", (e) => e.closest("details").querySelector("button").getAttribute("form"));
await acc.type(`input[form='${voidForm}']`, "رقم فاتورة مكرر");
await submit(acc, `button[form='${voidForm}']`);
const afterVoid = await text(acc);
check(afterVoid.includes("تم إلغاء الفاتورة") && !afterVoid.includes("LB-M9-WRONG"), "wrong lab bill voided and off the supplier statement");
await acc.goto(`${BASE}/os/lab`, { waitUntil: "networkidle0" });
check((await acc.$eval("article[data-lab-case]", (e) => e.innerText)).includes("1,500.00"), "lab case cost back to 1,500 after the void");
await dr.goto(`${BASE}/os/lab`, { waitUntil: "networkidle0" });
check(await clickButton(dr, "article[data-lab-case]", "سُلّم للمريض"), "crown delivered to the patient");

const dir = await login("director@demo.goldencare.local");
await dir.goto(`${BASE}/os/suppliers`, { waitUntil: "networkidle0" });
const labHref = await dir.$$eval("a[href^='/os/suppliers/']", (as) => as.find((a) => a.innerText.includes("معمل الأسنان"))?.getAttribute("href"));
await dir.goto(BASE + labHref, { waitUntil: "networkidle0" });
check((await text(dir)).includes("فاتورة معمل") && (await text(dir)).includes("غير مؤكدة"), "lab bill on the supplier statement, unconfirmed");
await submit(dir, "button[data-confirm-receipt]");
check((await text(dir)).includes("تم تأكيد الفاتورة"), "director confirms the lab bill (not the person who recorded it)");

// ---------- Contract with a lab cost share; settlement shows the deduction
await acc.goto(`${BASE}/os/settlements`, { waitUntil: "networkidle0" });
const karim = await acc.$$eval("tr", (rows) => { const r = rows.find((x) => x.innerText.includes("كريم")); return r?.querySelector("a[href*='/contracts/']")?.getAttribute("href"); });
await acc.goto(BASE + karim, { waitUntil: "networkidle0" });
const first = new Intl.DateTimeFormat("en-CA", { timeZone: "Africa/Cairo" }).format(new Date()).slice(0, 8) + "01";
await acc.$eval("#from", (e, v) => { e.value = v; }, first);
await acc.type("#dp", "40");
await acc.$eval("#lab_pct", (e) => { e.value = "50"; });
await acc.type("#notes", "عقد تجريبي — نصيب المعمل 50%");
await submit(acc, "form:has(#dp) button[type=submit]");
check((await text(acc)).includes("تم حفظ العقد") && (await text(acc)).includes("معمل 50%"), "contract: 40% of services, 50% of lab costs");
const month = first.slice(0, 7);
await acc.goto(`${BASE}/os/settlements?m=${month}`, { waitUntil: "networkidle0" });
for (const r of await acc.$$("tr")) {
  if ((await r.evaluate((e) => e.innerText)).includes("كريم")) { const b = await r.$("button"); await Promise.all([acc.waitForNavigation({ waitUntil: "networkidle0" }), b.click()]); break; }
}
const stmt = await text(acc);
check(stmt.includes("نصيب الطبيب من فاتورة المعمل") && stmt.includes("440.00") && stmt.includes("750.00"), "statement: 40% × 1,100 = 440, lab share −750");
await shot(acc, "m9-04-settlement");

// ---------- Crown done → billed; the remaining 1,900 advance applied
await dr.goto(planUrl, { waitUntil: "networkidle0" });
await submit(dr, "form[data-item-done='2'] button[type=submit]");
check((await text(dr)).includes("مكتملة"), "plan completed");
await rec.goto(planUrl, { waitUntil: "networkidle0" });
await Promise.all([rec.waitForNavigation({ waitUntil: "networkidle0" }), rec.click("form:has(input[name=plan_id]) button.btn-primary")]);
const inv2 = await text(rec);
check(inv2.includes("6,000.00") && inv2.includes("مدفوعة جزئيًا") && inv2.includes("4,100.00"), "crown invoiced 6,000; 1,900 from the advance; 4,100 to collect");
await rec.goto(patientUrl, { waitUntil: "networkidle0" });
check((await rec.$eval("[data-advance-balance]", (e) => e.innerText)).includes("0.00"), "advance balance used up");
await rec.goto(planUrl, { waitUntil: "networkidle0" });
await shot(rec, "m9-05-plan");

// ---------- Profitability with lab costs; ledger balanced
await acc.goto(`${BASE}/os/reports/profitability`, { waitUntil: "networkidle0" });
const rep = await text(acc);
check(rep.includes("DENT-CROWN") && rep.includes("1,500.00"), "profitability shows the crown's lab cost");
await acc.goto(`${BASE}/os/accounting`, { waitUntil: "networkidle0" });
check((await text(acc)).includes("الميزان متوازن"), "trial balance still balanced");
await browser.close();
