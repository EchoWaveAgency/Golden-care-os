// Milestone 8 journey (master-prompt scenario 3): laser package sale → payment → check-in → laser session with
// pulse reconciliation → package redeemed, device counter moves → consumables issued → settlement and profitability.
// Also: device register, alerts, breakdown work order. Run on a freshly seeded local stack.
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
// Sets a React-controlled input so onChange fires.
const setReact = (page, selector, value) => page.$eval(selector, (el, v) => {
  const proto = el.tagName === "SELECT" ? HTMLSelectElement.prototype : HTMLInputElement.prototype;
  Object.getOwnPropertyDescriptor(proto, "value").set.call(el, v);
  el.dispatchEvent(new Event(el.tagName === "SELECT" ? "change" : "input", { bubbles: true }));
}, String(value));

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

// ---------- Device officer: register overview, alerts, breakdown work order
const dev = await login("devices@demo.goldencare.local");
await dev.goto(`${BASE}/os/devices`, { waitUntil: "networkidle0" });
const dl = await text(dev);
check(dl.includes("ليزر سينوشور إليت بلس") && dl.includes("جهاز تعقيم"), "device register lists the laser and the autoclave");
check(dl.includes("الضمان ينتهي"), "warranty-ending alert shown");
await shot(dev, "m8-01-devices");
await Promise.all([dev.waitForNavigation({ waitUntil: "networkidle0" }), dev.click("a[href^='/os/devices/']:not([href*='new'])")]);
const devUrl = dev.url().split("?")[0];
check((await text(dev)).includes("1,245,300"), "counter at registration reading");
await dev.select("#wo_kind", "breakdown");
await dev.type("#wo_problem", "رسالة خطأ في نظام التبريد");
await submit(dev, "form:has(#wo_problem) button[type=submit]");
check((await text(dev)).includes("تم فتح أمر الصيانة") && (await text(dev)).includes("متوقف"), "breakdown takes the laser out of service");

// ---------- Nurse cannot use a device that is down
const nurse = await login("nurse@demo.goldencare.local");

// ---------- Device officer closes the work order → back in service
await dev.goto(devUrl, { waitUntil: "networkidle0" });
await dev.type("[data-open-order] input[name=result]", "تغيير فلتر المياه وإعادة تشغيل");
await dev.$eval("[data-open-order] input[name=parts_cost]", (e) => { e.value = "900"; });
await submit(dev, "[data-open-order] form:has(input[name=result]) button[type=submit]");
check((await text(dev)).includes("تم إغلاق أمر الصيانة") && (await text(dev)).includes("في الخدمة"), "work order closed; laser back in service");
await shot(dev, "m8-02-device");

// ---------- Chief accountant: Dr. Sara's contract (40%, underarm laser fixed 250 per session)
const acc = await login("accountant@demo.goldencare.local");
await acc.goto(`${BASE}/os/settlements`, { waitUntil: "networkidle0" });
const derm = await acc.$$eval("tr", (rows) => { const r = rows.find((x) => x.innerText.includes("سارة منصور")); return r?.querySelector("a[href*='/contracts/']")?.getAttribute("href"); });
await acc.goto(BASE + derm, { waitUntil: "networkidle0" });
await acc.type("#dp", "40");
const laserRow = await acc.$$eval("form div.grid.grid-cols-5", (rows) => rows.findIndex((r) => r.innerText.includes("LASER-AXILLA")));
const rowsH = await acc.$$("form div.grid.grid-cols-5");
await (await rowsH[laserRow].$("select")).select("fixed");
await (await rowsH[laserRow].$("input")).type("250");
await acc.type("#notes", "عقد تجريبي — مرجع ورقي DEMO-08");
await submit(acc, "form:has(#dp) button[type=submit]");
check((await text(acc)).includes("تم حفظ العقد"), "doctor contract saved");

// ---------- Reception: sell the underarm package with a discount, collect payment, book and check in
const rec = await login("reception@demo.goldencare.local");
await rec.goto(`${BASE}/os/patients?q=01001110005`, { waitUntil: "networkidle0" });
await Promise.all([rec.waitForNavigation({ waitUntil: "networkidle0" }), rec.click("a[href^='/os/patients/']:not([href$='/new'])")]);
const patientUrl = rec.url().split("?")[0];
const tplVal = await rec.$$eval("#template_id option", (os) => os.find((o) => o.textContent.includes("الإبط"))?.value);
await rec.select("#template_id", tplVal);
await rec.$eval("#discount", (e) => { e.value = "500"; });
await submit(rec, "[data-packages] form button[type=submit]");
const inv = await text(rec);
check(rec.url().includes("/os/billing/") && inv.includes("تم بيع الباقة") && inv.includes("4,000.00"), "package sold: invoice issued for 4,500 − 500 = 4,000");
await rec.select("#method", "card");
await rec.type("#reference", "POS-M8");
await submit(rec, "form:has(#method) button[type=submit]");
check((await text(rec)).includes("مدفوعة"), "package invoice paid");

await rec.goto(patientUrl.replace(/\/os\/patients\/(.+)$/, "/os/appointments/new?patient=$1"), { waitUntil: "networkidle0" });
const now = new Date(Date.now() + 10 * 60000);
const hhmm = new Intl.DateTimeFormat("en-GB", { timeZone: "Africa/Cairo", hour: "2-digit", minute: "2-digit" }).format(now);
await rec.select("#doctor_id", await rec.$$eval("#doctor_id option", (os) => os.find((o) => o.textContent.includes("سارة"))?.value));
await rec.$eval("#time", (el, v) => { el.value = v; }, hhmm.slice(0, 4) + "5");
await submit(rec, "button[type=submit]");
check((await text(rec)).includes("تم حجز الموعد"), "laser appointment booked with Dr. Sara");
await rec.goto(`${BASE}/os/reception`, { waitUntil: "networkidle0" });
let checkin = null;
for (const h of await rec.$$("tr")) {
  const t = await h.evaluate((e) => e.innerText);
  if (t.includes("دينا مجدي") && t.includes("سارة")) {
    for (const b of await h.$$("button")) if ((await b.evaluate((e) => e.innerText)).trim() === "تسجيل وصول") checkin = b;
  }
}
check(Boolean(checkin), "check-in available");
await Promise.all([rec.waitForNavigation({ waitUntil: "networkidle0" }), checkin.click()]);

// ---------- Nurse: laser session with pulse reconciliation and package redemption
await nurse.goto(`${BASE}/os/laser`, { waitUntil: "networkidle0" });
let startHref = null;
for (const li of await nurse.$$("li")) {
  const t = await li.evaluate((e) => e.innerText);
  if (t.includes("دينا مجدي") && t.includes("سارة")) startHref = await li.$eval("a[data-laser-apt]", (a) => a.getAttribute("href")).catch(() => null);
}
check(Boolean(startHref), "arrived laser appointment listed for the nurse");
await nurse.goto(BASE + startHref, { waitUntil: "networkidle0" });
const sessUrl = nurse.url().split("?")[0];
await nurse.select("#service_id", await nurse.$$eval("#service_id option", (os) => os.find((o) => o.textContent.includes("LASER-AXILLA"))?.value));
const pkgOpt = await nurse.$$eval("#patient_package_id option", (os) => os.find((o) => o.textContent.includes("PKG-"))?.value);
check(Boolean(pkgOpt) && (await nurse.$$eval("#patient_package_id option", (os) => os.some((o) => o.textContent.includes("6/6")))), "paid package offered with 6/6 sessions left");
await nurse.select("#patient_package_id", pkgOpt);
await nurse.select("#fitzpatrick", "3");
await nurse.$$eval("input[type=radio][value=no]", (rs) => rs.forEach((r) => { r.checked = true; }));
await setReact(nurse, "[data-area='0']", "axilla");
await setReact(nurse, "[data-wave='0']", "755");
await setReact(nurse, "[data-fluence='0']", "18");
await setReact(nurse, "[data-spot='0']", "15");
await setReact(nurse, "[data-pulses='0']", "180");
await setReact(nurse, "#counter_after", "1245490");
check((await nurse.$eval("[data-reconcile]", (e) => e.innerText)).includes("غير مطابق"), "live check: 180 pulses vs counter difference 190 → mismatch");
await submit(nurse, "button[value=sign]");
check((await text(nurse)).includes("لا يساوي فرق العداد"), "signing refused when pulses do not match the counter");
await setReact(nurse, "#counter_after", "1245480");
check((await nurse.$eval("[data-reconcile]", (e) => e.innerText)).includes("مطابق"), "draft reloaded; counter corrected → matches");
await nurse.$$eval("input[type=radio][value=no]", (rs) => rs.forEach((r) => { r.checked = true; }));
await nurse.type("#outcome", "تحمل جيد. تجنب الشمس 48 ساعة.");
await submit(nurse, "button[value=sign]");
const signed = await text(nurse);
check(signed.includes("تم توقيع الجلسة") && signed.includes("1,245,300 → 1,245,480"), "session signed with counter 1,245,300 → 1,245,480");
check(signed.includes("PKG-"), "package recorded on the session");
await shot(nurse, "m8-03-laser-session");

// ---------- Stock impact: consumables for the session from the service template
await Promise.all([nurse.waitForNavigation({ waitUntil: "networkidle0" }), nurse.click("a[href*='/os/inventory/issue?appointment=']")]);
check((await text(nurse)).includes("تم ملء الأصناف من قالب الخدمة"), "issue screen prefilled from the underarm laser template");
await submit(nurse, "form button.btn-primary");
check((await text(nurse)).includes("تم الصرف"), "consumables issued to the session (stock and cost)");

// ---------- Balances: device counter and package
await dev.goto(devUrl, { waitUntil: "networkidle0" });
check((await text(dev)).includes("1,245,480"), "device counter moved to 1,245,480");
await rec.goto(patientUrl, { waitUntil: "networkidle0" });
check((await text(rec)).includes("5/6"), "patient file shows 5 of 6 sessions left");

// ---------- Settlement and profitability
const month = new Intl.DateTimeFormat("en-CA", { timeZone: "Africa/Cairo" }).format(new Date()).slice(0, 7);
await acc.goto(`${BASE}/os/settlements?m=${month}`, { waitUntil: "networkidle0" });
for (const r of await acc.$$("tr")) {
  if ((await r.evaluate((e) => e.innerText)).includes("سارة منصور")) { const b = await r.$("button"); await Promise.all([acc.waitForNavigation({ waitUntil: "networkidle0" }), b.click()]); break; }
}
const stmt = await text(acc);
check(stmt.includes("جلسة من باقة") && stmt.includes("666.66") && stmt.includes("250.00"), "settlement: package session at its net value 4,000 ÷ 6 = 666.66, doctor fixed fee 250");
await shot(acc, "m8-04-settlement");
await acc.goto(`${BASE}/os/reports/profitability`, { waitUntil: "networkidle0" });
const rep = await text(acc);
check(rep.includes("LASER-AXILLA") && !rep.includes("PKG-LSR-AX-6"), "profitability: revenue on the session, not on the package sale");
await acc.goto(`${BASE}/os/packages`, { waitUntil: "networkidle0" });
check((await text(acc)).includes("3,333.34"), "deferred balance: net 4,000 − 666.66 = 3,333.34");
await shot(acc, "m8-05-packages");
await acc.goto(`${BASE}/os/accounting`, { waitUntil: "networkidle0" });
check((await text(acc)).includes("الميزان متوازن"), "trial balance still balanced");
await browser.close();
