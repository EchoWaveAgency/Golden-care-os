// End-to-end patient journey against the local stack, with screenshots.
import puppeteer from "puppeteer-core";
import chromium from "@sparticuz/chromium";
import { passMfa } from "./mfa.mjs";

const BASE = "http://localhost:3100";
const OUT = process.env.E2E_OUT ?? "/tmp/";
const PASS = "GoldenCare-Demo-2026";
const browser = await puppeteer.launch({ executablePath: await chromium.executablePath(), args: chromium.args.filter((a) => !["--single-process", "--no-zygote"].includes(a)).concat(["--no-sandbox"]), headless: "shell",
  defaultViewport: { width: 1440, height: 900, deviceScaleFactor: 1 } });

async function session(email) {
  const ctx = await browser.createBrowserContext();
  const page = await ctx.newPage();
  page.on("pageerror", (e) => console.log("PAGEERROR", e.message));
  await page.goto(`${BASE}/os/login`, { waitUntil: "networkidle0" });
  await page.type("#email", email);
  await page.type("#password", PASS);
  await Promise.all([page.waitForNavigation({ waitUntil: "networkidle0" }), page.click("button[type=submit]")]);
  await page.waitForFunction(() => !["/os", "/os/login"].includes(location.pathname), { timeout: 15000 }).catch(() => {});
  await page.waitForNetworkIdle({ idleTime: 400 }).catch(() => {});
  await passMfa(page, email);
  return page;
}
const shot = (p, n) => p.screenshot({ path: OUT + n + ".png" });
const text = (p) => p.evaluate(() => document.body.innerText);
const submit = async (page, selector) => {
  await Promise.all([page.waitForNavigation({ waitUntil: "networkidle0" }), page.click(selector)]);
};
const check = (cond, msg) => { console.log((cond ? "OK   " : "FAIL ") + msg); if (!cond) process.exitCode = 1; };

// --- Login screen
{
  const ctx = await browser.createBrowserContext();
  const p = await ctx.newPage();
  await p.goto(`${BASE}/os/login`, { waitUntil: "networkidle0" });
  await shot(p, "01-login");
  check((await p.evaluate(() => document.documentElement.dir)) === "rtl", "Arabic RTL by default");
  await ctx.close();
}

// --- Reception: today's list, register patient (with duplicate warning), book, check in
const rec = await session("reception@demo.goldencare.local");
check(rec.url().endsWith("/os/reception"), "front desk lands on reception: " + rec.url());
await shot(rec, "02-reception");
const nav = await text(rec);
check(!nav.includes("الحسابات") && !nav.includes("سجل التدقيق"), "front desk has no accounting/audit in menu");

await rec.goto(`${BASE}/os/patients/new`, { waitUntil: "networkidle0" });
await rec.type("#first_name_ar", "نورهان");
await rec.type("#last_name_ar", "عادل");
await rec.type("#phone_raw", "٠١٠٠١١١٠٠٠١"); // same phone as a demo patient, Arabic digits
await submit(rec, "button[type=submit]").catch(() => {});
await new Promise((r) => setTimeout(r, 800));
check((await text(rec)).includes("مرضى مشابهون"), "duplicate warning shown for existing phone");
await shot(rec, "03-duplicate-warning");

// register a genuinely new patient
await rec.goto(`${BASE}/os/patients/new`, { waitUntil: "networkidle0" });
await rec.type("#first_name_ar", "ليلى");
await rec.type("#last_name_ar", "مصطفى");
await rec.type("#phone_raw", "01229998877");
await rec.type("#national_id", "29203150101234");
await submit(rec, "button[type=submit]");
check(/\/os\/patients\/[0-9a-f-]{36}/.test(rec.url()), "new patient file opened");
const patientUrl = rec.url();

// book an appointment with the dermatologist now
await rec.goto(patientUrl.replace(/\/os\/patients\/(.+)$/, "/os/appointments/new?patient=$1"), { waitUntil: "networkidle0" });
const now = new Date(Date.now() + 5 * 60000);
const hhmm = new Intl.DateTimeFormat("en-GB", { timeZone: "Africa/Cairo", hour: "2-digit", minute: "2-digit" }).format(now);
await rec.select("#doctor_id", await rec.$eval("#doctor_id option", (o) => o.value));
await rec.$eval("#time", (el, v) => { el.value = v; }, hhmm.slice(0, 4) + "5");
await submit(rec, "button[type=submit]");
check((await text(rec)).includes("تم حجز الموعد"), "appointment booked");

// check in from reception, then send to consultation
await rec.goto(`${BASE}/os/reception`, { waitUntil: "networkidle0" });
const rowBtn = async (label) => {
  const handles = await rec.$$("tr");
  for (const h of handles) {
    const t = await h.evaluate((e) => e.innerText);
    if (t.includes("ليلى مصطفى")) {
      const btns = await h.$$("button");
      for (const b of btns) if ((await b.evaluate((e) => e.innerText)).trim() === label) return b;
    }
  }
  return null;
};
let b = await rowBtn("تسجيل وصول");
check(Boolean(b), "check-in button available");
await Promise.all([rec.waitForNavigation({ waitUntil: "networkidle0" }), b.click()]);
check((await text(rec)).includes("وصل"), "patient arrived with queue number");
await shot(rec, "04-reception-arrived");

// --- Doctor: opens encounter, records allergy, signs
const doc = await session("dr.derm@demo.goldencare.local");
check(doc.url().endsWith("/os/doctor"), "doctor lands on own clinic");
await shot(doc, "05-doctor");
const openBtns = await doc.$$("li");
for (const li of openBtns) {
  if ((await li.evaluate((e) => e.innerText)).includes("ليلى مصطفى")) {
    const btn = await li.$("button");
    await Promise.all([doc.waitForNavigation({ waitUntil: "networkidle0" }), btn.click()]);
    break;
  }
}
check(doc.url().includes("/encounters/"), "encounter opened");
await doc.type("#chief_complaint", "تصبغات بالوجه");
await doc.type("#assessment", "كلف سطحي");
await doc.type("#plan", "كريم واقي شمس + جلسة تقشير بعد أسبوعين");
await doc.$eval("details summary", (s) => s.click());
await doc.type("input[name=label]", "بنسلين");
await doc.select("select[name=severity]", "high");
await submit(doc, "form:has(input[name=label]) button[type=submit]");
check((await text(doc)).includes("بنسلين"), "allergy recorded");
// save content again (alert form reloaded page), then sign
await doc.type("#chief_complaint", "تصبغات بالوجه");
doc.on("dialog", (d) => d.accept());
await submit(doc, "button[value=sign]");
check((await text(doc)).includes("موقّع"), "encounter signed and locked");
await shot(doc, "06-encounter-signed");

// Reception can see an allergy flag but not the allergen
await rec.goto(patientUrl, { waitUntil: "networkidle0" });
const pt = await text(rec);
check(pt.includes("حساسية") && !pt.includes("بنسلين"), "reception sees allergy flag only");

// --- Billing: move to cashier, invoice, issue, pay cash
await rec.goto(`${BASE}/os/reception`, { waitUntil: "networkidle0" });
b = await rowBtn("للخزينة");
if (b) await Promise.all([rec.waitForNavigation({ waitUntil: "networkidle0" }), b.click()]);
b = await rowBtn("فاتورة جديدة");
check(Boolean(b), "invoice button for awaiting-payment patient");
await Promise.all([rec.waitForNavigation({ waitUntil: "networkidle0" }), b.click()]);
check(rec.url().includes("/billing/"), "draft invoice opened");
const invoiceUrl = rec.url();
const optVal = await rec.$$eval("select[name=service_id] option", (os) => os.find((o) => o.textContent.includes("LASER-AXILLA"))?.value);
await rec.select("select[name=service_id]", optVal);
await rec.$eval("input[name=discount]", (e) => { e.value = "100"; });
await submit(rec, "form:has(select[name=service_id]) button[type=submit]");
const cons = await rec.$$eval("select[name=service_id] option", (os) => os.find((o) => o.textContent.includes("DERM-CONS"))?.value);
await rec.select("select[name=service_id]", cons);
await submit(rec, "form:has(select[name=service_id]) button[type=submit]");
await submit(rec, "form:has(input[name=invoice_id]):not(:has(select)) button[type=submit]");
const inv = await text(rec);
check(/INV-\d{4}-\d{6}/.test(inv), "invoice issued with number");
check(inv.includes("1,300.00"), "net total 1,300 (1,400 - 100 discount on one line only)");

// cash without session is refused with a clear message
await rec.select("#method", "cash");
await rec.$eval("#amount", (e) => { e.value = "500"; });
await rec.click("form:has(#method) button[type=submit]");
await new Promise((r) => setTimeout(r, 1200));
check((await text(rec)).includes("افتح وردية"), "cash refused without open cashier session");

await rec.goto(`${BASE}/os/cashier`, { waitUntil: "networkidle0" });
await rec.$eval("#opening_float", (e) => { e.value = "200"; });
await submit(rec, "form:has(#opening_float) button[type=submit]");
await rec.goto(invoiceUrl, { waitUntil: "networkidle0" });
await rec.select("#method", "cash");
await rec.$eval("#amount", (e) => { e.value = "500"; });
await submit(rec, "form:has(#method) button[type=submit]");
check((await text(rec)).includes("تم تسجيل الدفعة"), "partial cash payment recorded");
await rec.select("#method", "instapay");
await rec.type("#reference", "IP-20260926-7781");
await submit(rec, "form:has(#method) button[type=submit]");
const paid = await text(rec);
check(paid.includes("مدفوعة") && !paid.includes("مدفوعة جزئيًا") && /RCT-\d{4}-\d{6}/.test(paid), "invoice fully paid with receipts");
await shot(rec, "07-invoice-paid");

await rec.goto(`${BASE}/os/cashier`, { waitUntil: "networkidle0" });
await shot(rec, "08-cashier");
await rec.type("#counted", "650");
await rec.click("form:has(#counted) button[type=submit]");
await new Promise((r) => setTimeout(r, 1200));
check((await text(rec)).includes("اكتب ملاحظة"), "cash difference requires a note");
await rec.type("#note", "نقص 50 جنيه - قيد المراجعة");
await submit(rec, "form:has(#counted) button[type=submit]");
check((await text(rec)).includes("تم إقفال الوردية"), "cashier session closed with difference");

// --- Finance: trial balance balances; no patient file access
const acc = await session("accountant@demo.goldencare.local");
check(acc.url().endsWith("/os/cashier") || acc.url().endsWith("/os/billing") || acc.url().endsWith("/os/accounting"), "accountant lands in finance: " + acc.url());
await acc.goto(`${BASE}/os/accounting`, { waitUntil: "networkidle0" });
const tb = await text(acc);
check(tb.includes("الميزان متوازن"), "trial balance is balanced");
await acc.$$eval("details", (ds) => ds.slice(0, 2).forEach((d) => (d.open = true)));
await shot(acc, "09-accounting");
await acc.goto(patientUrl, { waitUntil: "networkidle0" });
check(!(await text(acc)).includes("29203150101234"), "accountant cannot open the patient file");

// --- Owner: command center with live figures, English view
const own = await session("owner@demo.goldencare.local");
check(own.url().endsWith("/os/executive"), "owner lands on command center");
await shot(own, "10-executive-ar");
await own.click("aside form:has(input[name=locale]) button");
await own.waitForNavigation({ waitUntil: "networkidle0" });
check((await own.evaluate(() => document.documentElement.dir)) === "ltr", "English switches to LTR");
await shot(own, "11-executive-en");

// --- Mobile reception
await rec.setViewport({ width: 390, height: 844, deviceScaleFactor: 2 });
await rec.goto(`${BASE}/os/reception`, { waitUntil: "networkidle0" });
await shot(rec, "12-reception-mobile");

await browser.close();
