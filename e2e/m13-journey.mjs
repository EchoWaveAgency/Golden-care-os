// Milestone 13 journey (finance completion): doctor contract with withholding tax → purchasing limits and VAT →
// card settlement / loyalty settings → patient file loyalty and invite code → the patient accepts a dental plan in
// the portal and pays the first installment online → HR annual increment → trial balance still balanced.
// Run on a freshly seeded local stack (demo data includes a proposed plan for patient 01001110002).
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
const setVal = (p, sel, v) => p.$eval(sel, (e, val) => { e.value = val; }, v);

async function login(email) {
  const ctx = await browser.createBrowserContext();
  const page = await ctx.newPage();
  page.on("pageerror", (e) => console.log("PAGEERROR", e.message));
  page.on("dialog", (d) => d.accept());
  await page.goto(`${BASE}/os/login`, { waitUntil: "networkidle0" });
  await page.type("#email", email);
  await page.type("#password", PASS);
  await page.click("button[type=submit]");
  await page.waitForFunction(() => !["/os", "/os/login"].includes(location.pathname), { timeout: 15000 }).catch(() => {});
  await page.waitForNetworkIdle({ idleTime: 400 }).catch(() => {});
  await passMfa(page, email);
  return page;
}

// ---------- Doctor contract with withholding tax; withholding remittance section
const acc = await login("accountant@demo.goldencare.local");
await acc.goto(`${BASE}/os/settlements`, { waitUntil: "networkidle0" });
check(Boolean(await acc.$("[data-withholding]")), "settlements page shows the withholding tax section");
const derm = await acc.$$eval("tr", (rows) => rows.find((x) => x.innerText.includes("سارة منصور"))?.querySelector("a[href*='/contracts/']")?.getAttribute("href"));
await acc.goto(BASE + derm, { waitUntil: "networkidle0" });
await acc.type("#dp", "40");
await setVal(acc, "#wht", "5");
await acc.select("#basis", "collected");
await submit(acc, "form:has(#dp) button[type=submit]");
const ct = await text(acc);
check(ct.includes("تم حفظ العقد") && ct.includes("خصم من المنبع 5%") && ct.includes("عند التحصيل"), "contract saved: 40%, withholding 5%, due on collection");
await shot(acc, "m13-01-contract-wht");

// ---------- Purchasing limits and VAT treatment; VAT on a supplier invoice
await acc.goto(`${BASE}/os/purchasing`, { waitUntil: "networkidle0" });
await acc.$eval("[data-purchasing-settings]", (d) => { d.open = true; });
await setVal(acc, "[data-purchasing-settings] input[name=po_high_approval_above]", "20000");
await setVal(acc, "[data-purchasing-settings] input[name=payment_high_approval_above]", "15000");
await acc.select("[data-purchasing-settings] select[name=vat_treatment]", "recoverable");
await submit(acc, "[data-purchasing-settings] button[type=submit]");
check((await text(acc)).includes("تم حفظ إعدادات المشتريات"), "purchasing limits and VAT treatment saved (demo values)");
await acc.goto(`${BASE}/os/suppliers`, { waitUntil: "networkidle0" });
const supHref = await acc.$$eval("a[href^='/os/suppliers/']", (as) => as.find((a) => a.textContent.includes("المستلزمات الطبية"))?.getAttribute("href"));
await acc.goto(BASE + supHref, { waitUntil: "networkidle0" });
await acc.$eval("[data-receipt-vat]", (d) => { d.open = true; });
const vatRow = (await acc.$$("[data-receipt-vat] li"))[0];
await (await vatRow.$("input[name=vat]")).click({ clickCount: 3 });
await (await vatRow.$("input[name=vat]")).type("140");
await (await vatRow.$("input[name=tax_invoice_no]")).type("TAX-DEMO-1");
await Promise.all([acc.waitForNavigation({ waitUntil: "networkidle0" }), (await vatRow.$("button[type=submit]")).click()]);
check((await text(acc)).includes("تم تسجيل ضريبة القيمة المضافة"), "VAT from the supplier's tax invoice recorded");
await shot(acc, "m13-02-supplier-vat");

// ---------- Card settlement page and loyalty programme (demo values)
await acc.goto(`${BASE}/os/accounting/clearing`, { waitUntil: "networkidle0" });
check((await acc.$$("[data-clearing-balances] > *")).length === 4, "four clearing accounts with their uncleared balances");
await acc.click("[data-loyalty-settings] input[name=enabled]");
await setVal(acc, "[data-loyalty-settings] input[name=points_per_egp]", "0.1");
await setVal(acc, "[data-loyalty-settings] input[name=egp_per_point]", "0.5");
await setVal(acc, "[data-loyalty-settings] input[name=referral_bonus_points]", "100");
await submit(acc, "[data-loyalty-settings] button[type=submit]");
check((await text(acc)).includes("تم حفظ إعدادات الولاء"), "loyalty programme switched on");
await shot(acc, "m13-03-clearing-loyalty");

// ---------- Patient file: loyalty card and invite code
const rec = await login("reception@demo.goldencare.local");
await rec.goto(`${BASE}/os/patients?q=01001110002`, { waitUntil: "networkidle0" });
await Promise.all([rec.waitForNavigation({ waitUntil: "networkidle0" }), rec.click("a[href^='/os/patients/']:not([href$='/new'])")]);
check(Boolean(await rec.$("[data-loyalty]")), "patient file shows loyalty points");
await submit(rec, "[data-loyalty] form:not([data-set-referrer]) button");
check(/GC[0-9A-F]{6}/.test(await rec.$eval("[data-loyalty]", (e) => e.innerText)), "invite code created");

// ---------- Portal: the patient accepts the dental plan and pays the first installment online
const ctx = await browser.createBrowserContext();
const pt = await ctx.newPage();
pt.on("pageerror", (e) => console.log("PAGEERROR", e.message));
await pt.goto(`${BASE}/ar/portal`, { waitUntil: "networkidle0" });
await pt.type("#phone", "01001110002");
await pt.click("form button[type=submit]");
await pt.waitForSelector("#code");
await pt.type("#code", await pt.$eval(".border-dashed .num", (e) => e.textContent.trim()));
await submit(pt, "form button[type=submit]");
await pt.goto(`${BASE}/ar/portal/plans`, { waitUntil: "networkidle0" });
const pl = await text(pt);
check(pl.includes("حشو ضرسين") && pl.includes("بانتظار موافقتك") && pl.includes("3,200.00"), "patient sees the proposed plan: 1,200 × 2 + 800 = 3,200");
await shot(pt, "m13-04-portal-plan");
await pt.select("[data-accept-plan] select[name=installments]", "3");
await pt.click("[data-accept-plan] input[type=checkbox]");
await submit(pt, "[data-accept-plan] button[type=submit]");
const acc2 = await text(pt);
check(acc2.includes("تم تسجيل موافقتك") && (await pt.$$("[data-portal-installments] li")).length === 3, "accepted with 3 monthly installments");
await submit(pt, "form:has(input[name=plan]) button");
check(pt.url().includes("/portal/pay/dev/") && (await text(pt)).includes("1,066.66"), "checkout for the first installment (3,200 ÷ 3 = 1,066.66)");
await submit(pt, "button[value=success]");
const ret = await text(pt);
check(ret.includes("تم الدفع بنجاح") && /DEP-\d{4}-\d{6}/.test(ret), "paid online; receipt is an advance deposit");
await pt.goto(`${BASE}/ar/portal/plans`, { waitUntil: "networkidle0" });
check((await pt.$eval("[data-portal-installments]", (e) => e.innerText)).includes("مدفوع"), "first installment shows as paid");
await shot(pt, "m13-05-portal-installment-paid");

// ---------- HR: annual increment
const hr = await login("hr@demo.goldencare.local");
await hr.goto(`${BASE}/os/hr`, { waitUntil: "networkidle0" });
await hr.$eval("[data-increment]", (d) => { d.open = true; });
const next = (() => { const d = new Intl.DateTimeFormat("en-CA", { timeZone: "Africa/Cairo", year: "numeric", month: "2-digit" }).format(new Date()); const [y, m] = d.split("-").map(Number); return m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, "0")}`; })();
await setVal(hr, "[data-increment] input[name=month]", next);
await setVal(hr, "[data-increment] input[name=percent]", "7.5");
await submit(hr, "[data-increment] button[type=submit]");
check(/تم تطبيق الزيادة على [1-9]/.test(await text(hr)), "increment applied to the active employees from next month");

await acc.goto(`${BASE}/os/accounting`, { waitUntil: "networkidle0" });
check((await text(acc)).includes("الميزان متوازن"), "trial balance still balanced");
await browser.close();
