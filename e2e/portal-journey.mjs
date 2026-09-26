// Milestone 3 journey: prescription with allergy check → release → patient OTP sign-in → portal → isolation.
import puppeteer from "puppeteer-core";
import chromium from "@sparticuz/chromium";
import { passMfa } from "./mfa.mjs";

const BASE = "http://localhost:3100";
const OUT = process.env.E2E_OUT ?? "/tmp/";
const PASS = "GoldenCare-Demo-2026";
const browser = await puppeteer.launch({ executablePath: await chromium.executablePath(), args: chromium.args.filter((a) => !["--single-process", "--no-zygote"].includes(a)).concat(["--no-sandbox"]), headless: "shell",
  defaultViewport: { width: 1440, height: 900, deviceScaleFactor: 1 } });

const shot = (p, n) => p.screenshot({ path: OUT + n + ".png" });
const text = (p) => p.evaluate(() => document.body.innerText);
const submit = (page, selector) => Promise.all([page.waitForNavigation({ waitUntil: "networkidle0" }), page.click(selector)]);
const check = (cond, msg) => { console.log((cond ? "OK   " : "FAIL ") + msg); if (!cond) process.exitCode = 1; };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function staff(email) {
  const ctx = await browser.createBrowserContext();
  const page = await ctx.newPage();
  page.on("pageerror", (e) => console.log("PAGEERROR", e.message));
  await page.goto(`${BASE}/os/login`, { waitUntil: "networkidle0" });
  await page.type("#email", email);
  await page.type("#password", PASS);
  await submit(page, "button[type=submit]");
  await page.waitForFunction(() => !["/os", "/os/login"].includes(location.pathname), { timeout: 15000 }).catch(() => {});
  await passMfa(page, email);
  return page;
}
async function patient(phone, lang = "ar", mobile = false) {
  const ctx = await browser.createBrowserContext();
  const page = await ctx.newPage();
  if (mobile) await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  page.on("pageerror", (e) => console.log("PAGEERROR", e.message));
  await page.goto(`${BASE}/${lang}/portal`, { waitUntil: "networkidle0" });
  await page.type("#phone", phone);
  await page.click("form button[type=submit]");
  await page.waitForSelector("#code", { timeout: 15000 });
  const code = await page.$eval(".border-dashed .num", (e) => e.textContent.trim()).catch(() => "");
  return { page, code };
}
async function clickIn(page, rowSel, contains, btnSel) {
  for (const h of await page.$$(rowSel)) {
    if ((await h.evaluate((e) => e.innerText)).includes(contains)) {
      const b = await h.$(btnSel);
      if (b) { await Promise.all([page.waitForNavigation({ waitUntil: "networkidle0" }), b.click()]); return true; }
    }
  }
  return false;
}

// ---------- Staff setup: new patient, visit, allergy, prescription
const rec = await staff("reception@demo.goldencare.local");
await rec.goto(`${BASE}/os/patients/new`, { waitUntil: "networkidle0" });
await rec.type("#first_name_ar", "سلمى");
await rec.type("#last_name_ar", "حسن");
await rec.type("#phone_raw", "01229990011");
await submit(rec, "button[type=submit]");
const patientUrl = rec.url();
const salmaId = patientUrl.split("/").pop();
check(/[0-9a-f-]{36}$/.test(salmaId), "synthetic patient registered");
await rec.goto(`${BASE}/os/appointments/new?patient=${salmaId}`, { waitUntil: "networkidle0" });
const hhmm = new Intl.DateTimeFormat("en-GB", { timeZone: "Africa/Cairo", hour: "2-digit", minute: "2-digit" }).format(new Date(Date.now() + 7 * 60000));
await rec.select("#doctor_id", await rec.$eval("#doctor_id option", (o) => o.value));
await rec.$eval("#time", (el, v) => { el.value = v; }, hhmm.slice(0, 4) + "5");
await submit(rec, "button[type=submit]");
await rec.goto(`${BASE}/os/reception`, { waitUntil: "networkidle0" });
check(await clickIn(rec, "tr", "سلمى حسن", "button"), "patient checked in");

const doc = await staff("dr.derm@demo.goldencare.local");
for (const li of await doc.$$("li")) {
  if ((await li.evaluate((e) => e.innerText)).includes("سلمى حسن")) {
    const b = await li.$("button");
    if (b) { await Promise.all([doc.waitForNavigation({ waitUntil: "networkidle0" }), b.click()]); break; }
  }
}
check(doc.url().includes("/encounters/"), "doctor opened the encounter");
const encUrl = doc.url();
await doc.type("#chief_complaint", "حب شباب");
await doc.type("#assessment", "حب شباب التهابي متوسط");
await doc.type("#plan", "مضاد حيوي موضعي ومتابعة بعد 4 أسابيع");
await submit(doc, "button[value=save]");
await doc.$eval("details summary", (s) => s.click());
await doc.type("input[name=label]", "Penicillin");
await doc.select("select[name=severity]", "high");
await submit(doc, "form:has(input[name=label]) button[type=submit]");
// create prescription
const newRx = await doc.$$eval("button", (bs) => bs.findIndex((b) => b.innerText.includes("روشتة جديدة")));
if (newRx >= 0) await Promise.all([doc.waitForNavigation({ waitUntil: "networkidle0" }), doc.$$("button").then((bs) => bs[newRx].click())]);
check(await doc.$("input[name=drug]") !== null, "draft prescription created");
const addItem = async (drug, dose, freq, dur) => {
  await doc.type("input[name=drug]", drug); await doc.type("input[name=dose]", dose);
  await doc.type("input[name=frequency]", freq); await doc.type("input[name=duration]", dur);
  await submit(doc, "form:has(input[name=drug]) button[type=submit]");
};
await addItem("Fusidic acid cream — 2% cream", "طبقة رقيقة", "مرتين يوميًا", "10 أيام");
await addItem("Amoxicillin — 500 mg capsule", "كبسولة", "كل 8 ساعات", "7 أيام");
check((await text(doc)).includes("500 mg capsule"), "items stored with strength and form from the catalogue");
// sign without acknowledging the allergy → refused
await submit(doc, "form:has(input[name=prescription_id]):not(:has(input[name=drug])) button[type=submit]");
check((await text(doc)).includes("حساسية مسجلة"), "signing refused until the allergy is acknowledged");
await doc.click("input[name=ack]");
await submit(doc, "form:has(input[name=ack]) button[type=submit]");
check((await text(doc)).includes("موقّعة"), "prescription signed with allergy acknowledgement");
await submit(doc, "form:has(input[name=kind][value=prescription]) button[type=submit]");
check((await text(doc)).includes("ظاهرة للمريض"), "prescription released to the patient portal");
// sign the encounter, then release a plain-language summary
await doc.type("#chief_complaint", " ");
doc.on("dialog", (d) => d.accept());
await submit(doc, "button[value=sign]");
await doc.type("textarea[name=summary]", "حب شباب بسيط إلى متوسط. العلاج موضعي مع كبسولات لمدة أسبوع.");
await doc.type("textarea[name=instructions]", "اغسلي الوجه مرتين يوميًا بغسول لطيف. موعد المتابعة بعد 4 أسابيع.");
await submit(doc, "form:has(input[name=kind][value=encounter]) button[type=submit]");
check((await text(doc)).includes("ظاهر في حساب المريض"), "visit summary released");
await shot(doc, "portal-01-encounter-rx");
const rxHref = await doc.$eval("a[href*='/os/prescriptions/']", (a) => a.getAttribute("href"));
await doc.goto(BASE + rxHref, { waitUntil: "networkidle0" });
await shot(doc, "portal-02-rx-print-staff");

// invoice (unpaid) so the portal shows a balance
await rec.goto(`${BASE}/os/reception`, { waitUntil: "networkidle0" });
await clickIn(rec, "tr", "سلمى حسن", "button:not([disabled])").catch(() => {});
await rec.goto(`${BASE}/os/reception`, { waitUntil: "networkidle0" });
let billed = false;
for (const h of await rec.$$("tr")) {
  if ((await h.evaluate((e) => e.innerText)).includes("سلمى حسن")) {
    for (const b of await h.$$("button")) if ((await b.evaluate((e) => e.innerText)).includes("فاتورة")) { await Promise.all([rec.waitForNavigation({ waitUntil: "networkidle0" }), b.click()]); billed = true; break; }
  }
  if (billed) break;
}
if (billed) {
  const cons = await rec.$$eval("select[name=service_id] option", (os) => os.find((o) => o.textContent.includes("DERM-CONS"))?.value);
  await rec.select("select[name=service_id]", cons);
  await submit(rec, "form:has(select[name=service_id]) button[type=submit]");
  await submit(rec, "form:has(input[name=invoice_id]):not(:has(select)) button[type=submit]");
}
check(billed && /INV-\d{4}-\d{6}/.test(await text(rec)), "invoice issued for the visit");

// ---------- Patient signs in with a WhatsApp code
const unknown = await patient("01000000999");
check((await text(unknown.page)).includes("إذا كان الرقم مسجلًا") && !unknown.code, "unknown number gets the same neutral message and no code");
const { page: pt, code } = await patient("01229990011");
check(/^\d{6}$/.test(code), "code issued (dev display) for a registered number");
await shot(pt, "portal-03-otp");
await pt.type("#code", "000000");
await pt.click("form button[type=submit]");
await sleep(1500);
check((await text(pt)).includes("الرمز غير صحيح"), "wrong code rejected");
await pt.$eval("#code", (e) => { e.value = ""; });
await pt.type("#code", code);
await submit(pt, "form button[type=submit]");
check(pt.url().endsWith("/ar/portal/home"), "patient signed in → portal home");
await shot(pt, "portal-04-home");
const home = await text(pt);
check(home.includes("500.00") && home.includes("Penicillin"), "home shows balance due and recorded allergy");

await pt.goto(`${BASE}/ar/portal/medical`, { waitUntil: "networkidle0" });
const med = await text(pt);
check(med.includes("Amoxicillin") && med.includes("حب شباب بسيط") && !med.includes("حب شباب التهابي متوسط"), "patient sees released Rx + summary, never the internal assessment");
await shot(pt, "portal-05-medical");
const rxLink = await pt.$eval("a[href*='/portal/medical/rx/']", (a) => a.getAttribute("href"));
await pt.goto(BASE + rxLink, { waitUntil: "networkidle0" });
check((await text(pt)).includes("Fusidic acid cream"), "printable prescription in the portal");
await shot(pt, "portal-06-rx-print");

await pt.goto(`${BASE}/ar/portal/finance`, { waitUntil: "networkidle0" });
check(/INV-\d{4}-\d{6}/.test(await text(pt)), "invoice visible in the portal");
await shot(pt, "portal-07-finance");

// book from live availability next week, then cancel
await pt.goto(`${BASE}/ar/portal/appointments/book`, { waitUntil: "networkidle0" });
const docBtns = await pt.$$("section button.rounded-xl");
await docBtns[0].click();
await pt.waitForSelector("button[aria-pressed]", { timeout: 15000 }).catch(() => {});
await pt.click("button[aria-label='الأسبوع التالي']");
await sleep(2000);
await pt.waitForSelector("button[aria-pressed]", { timeout: 15000 }).catch(() => {});
const slotBtn = await pt.$("button[aria-pressed]");
check(Boolean(slotBtn), "free slots listed from the doctor's schedule");
if (!slotBtn) { await pt.screenshot({ path: OUT + "dbg-fail.png", fullPage: false }); console.log(pt.url(), (await text(pt)).slice(0, 600)); }
if (slotBtn) {
  await slotBtn.click();
  await shot(pt, "portal-08-book");
  await pt.click("form button[type=submit]");
  await pt.waitForFunction(() => /[?&](ok|error)=/.test(location.search), { timeout: 15000 }).catch(() => {});
  await pt.waitForNetworkIdle({ idleTime: 300 }).catch(() => {});
  const booked = await text(pt);
  check(booked.includes("تم إرسال طلب الحجز"), "booking request created (time held) " + (booked.includes("تم إرسال") ? "" : pt.url()));
  await shot(pt, "portal-09-appointments");
  const hasCancel = await pt.$("details summary");
  if (hasCancel) {
    await pt.$eval("details summary", (s) => s.click());
    await pt.type("input[name=reason]", "ظرف طارئ");
    await submit(pt, "details form button[type=submit]");
    check((await text(pt)).includes("تم إلغاء الموعد"), "patient cancelled online (outside the cancellation window)");
  }
}

// complaint → staff resolves → patient sees the resolution
await pt.goto(`${BASE}/ar/portal/support`, { waitUntil: "networkidle0" });
await pt.select("#kind", "complaint");
await pt.type("#subject", "تأخير في موعد الكشف");
await pt.type("#body", "انتظرت 40 دقيقة بعد موعدي.");
await submit(pt, "form button[type=submit]");
const tk = (await text(pt)).match(/TK-\d{4}-\d{6}/)?.[0];
check(Boolean(tk), "complaint received with reference " + tk);

const rel = await staff("relations@demo.goldencare.local");
await rel.goto(`${BASE}/os/tickets`, { waitUntil: "networkidle0" });
check((await text(rel)).includes("تأخير في موعد الكشف"), "patient relations sees the complaint with its deadline");
await shot(rel, "portal-10-staff-tickets");
await rel.type("input[name=resolution]", "نعتذر عن التأخير. تمت مراجعة جدول الطبيب وإضافة وقت احتياطي بين الكشوفات.");
await rel.select("select[name=status]", "resolved");
await submit(rel, "form:has(input[name=resolution]) button[type=submit]");
await pt.goto(`${BASE}/ar/portal/support`, { waitUntil: "networkidle0" });
check((await text(pt)).includes("وقت احتياطي"), "patient sees the resolution");

// messages outbox (operations / admin)
const adm = await staff("admin@demo.goldencare.local");
await adm.goto(`${BASE}/os/messages`, { waitUntil: "networkidle0" });
const msgs = await text(adm);
check(msgs.includes("تأكيد موعد") && msgs.includes("إلغاء موعد"), "confirmation + cancellation messages queued in the outbox");
check(!msgs.includes("01229990011"), "outbox masks phone numbers");

// ---------- Isolation: another patient cannot see this file
const { page: other, code: c2 } = await patient("01001110001");
await other.type("#code", c2);
await submit(other, "form button[type=submit]");
check(other.url().endsWith("/portal/home"), "second patient signed in");
await other.goto(BASE + rxLink, { waitUntil: "networkidle0" });
check(!(await text(other)).includes("Fusidic acid cream"), "second patient cannot open the first patient's prescription");
await other.setCookie({ name: "gc_portal_for", value: salmaId, url: BASE });
await other.goto(`${BASE}/ar/portal/medical`, { waitUntil: "networkidle0" });
check(!(await text(other)).includes("Amoxicillin"), "tampered 'acting for' cookie is ignored");

// ---------- Sharing: Salma shares appointments-only access with the second patient
const mrn2 = await (async () => {
  await rec.goto(`${BASE}/os/patients?q=01001110001`, { waitUntil: "networkidle0" });
  return ((await text(rec)).match(/P-\d{6}/) ?? [""])[0];
})();
await pt.goto(`${BASE}/ar/portal/family`, { waitUntil: "networkidle0" });
await pt.type("#mrn", mrn2);
await pt.type("#sphone", "01001110001");
await submit(pt, "form:has(#mrn) button[type=submit]");
check((await text(pt)).includes("تمت المشاركة"), `shared access with file ${mrn2}`);
await shot(pt, "portal-11-family");
await other.deleteCookie({ name: "gc_portal_for", url: BASE });
await other.goto(`${BASE}/ar/portal/home`, { waitUntil: "networkidle0" });
check(await other.$("#acting") !== null, "family switcher appears for the grantee");
await other.select("#acting", salmaId);
await submit(other, "form:has(#acting) button");
const fam = await text(other);
check(fam.includes("سلمى حسن") && fam.includes("المواعيد فقط") && !fam.includes("الزيارات والروشتات"), "grantee sees appointments only, no medical/finance");
await other.goto(`${BASE}/ar/portal/medical`, { waitUntil: "networkidle0" });
check(other.url().endsWith("/portal/home"), "medical page redirects for appointments-only access");

// English + mobile
const { page: en, code: c3 } = await patient("01229990011", "en", true);
await en.type("#code", c3);
await submit(en, "form button[type=submit]");
check((await en.evaluate(() => document.documentElement.dir)) === "ltr" && (await text(en)).includes("Amount due"), "English portal (LTR) on mobile");
await shot(en, "portal-12-home-en-mobile");
await submit(en, "form:has(input[name=lang]) button.rounded-lg.border");
check(en.url().endsWith("/en/portal"), "sign out");

await browser.close();
