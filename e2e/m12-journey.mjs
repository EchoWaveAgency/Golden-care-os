// Milestone 12 journey: package refund and transfer, supplier return, e-receipt queue, thermal receipt, day sheet.
// Chief accountant switches e-receipts on → reception sells two packages (documents blocked: no tax codes yet) and
// prints the 80mm receipt → refund of the first package (reception requests, chief approves, cashier pays) → the
// second package moves to another patient → store returns gloves to the supplier, chief approves → chief sets the
// service codes, re-sends, the local simulator accepts → the reprinted receipt carries the e-receipt id → reception
// prints the day sheet → trial balance still balanced. Run on a freshly seeded local stack (EINVOICE_MODE=dev).
import { readFileSync } from "node:fs";
import puppeteer from "puppeteer-core";
import chromium from "@sparticuz/chromium";
import { passMfa } from "./mfa.mjs";

const BASE = "http://localhost:3100";
const OUT = process.env.E2E_OUT ?? "/tmp/";
const PASS = "GoldenCare-Demo-2026";
const ENV = Object.fromEntries(readFileSync(new URL("../.env.local", import.meta.url), "utf8").split("\n").filter((l) => /^[A-Z_]+=/.test(l)).map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1)]));
const browser = await puppeteer.launch({ executablePath: await chromium.executablePath(), args: chromium.args.filter((a) => !["--single-process", "--no-zygote"].includes(a)).concat(["--no-sandbox"]), headless: "shell",
  defaultViewport: { width: 1440, height: 900, deviceScaleFactor: 1 } });
const shot = async (p, n) => { await p.evaluate(() => window.scrollTo(0, 0)); const tall = await p.evaluate(() => document.documentElement.scrollHeight > window.innerHeight + 40); await p.screenshot({ path: OUT + n + ".png", fullPage: tall }); };
const text = (p) => p.evaluate(() => document.body.innerText);
const submit = (page, selector) => Promise.all([page.waitForNavigation({ waitUntil: "networkidle0" }), page.click(selector)]);
const check = (cond, msg) => { console.log((cond ? "OK   " : "FAIL ") + msg); if (!cond) process.exitCode = 1; };
const dispatch = () => fetch(`${BASE}/api/jobs/dispatch`, { method: "POST", headers: { authorization: `Bearer ${ENV.CRON_SECRET}` } }).then((r) => r.json());

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

// ---------- Chief accountant switches e-receipts on (taxpayer data are test placeholders)
const acc = await login("accountant@demo.goldencare.local");
await acc.goto(`${BASE}/os/accounting/einvoice?tab=settings`, { waitUntil: "networkidle0" });
check((await acc.$eval("[data-einvoice-mode]", (e) => e.innerText)).includes("المحاكاة"), "local simulator mode shown");
await acc.click("[data-einvoice-settings] input[name=enabled]");
for (const [n, v] of [["taxpayer_rin", "123456789"], ["taxpayer_name", "Golden Care (test)"], ["activity_code", "8620"], ["branch_code", "0"], ["pos_serial", "POS-DEMO-1"]]) await acc.type(`[data-einvoice-settings] input[name=${n}]`, v);
await submit(acc, "[data-einvoice-settings] button[type=submit]");
check((await text(acc)).includes("تم الحفظ"), "e-receipt settings saved and preparation enabled");

// ---------- Reception sells two packages and collects; prints the thermal receipt
const rec = await login("reception@demo.goldencare.local");
await rec.goto(`${BASE}/os/patients?q=01001110005`, { waitUntil: "networkidle0" });
await Promise.all([rec.waitForNavigation({ waitUntil: "networkidle0" }), rec.click("a[href^='/os/patients/']:not([href$='/new'])")]);
const patientUrl = rec.url().split("?")[0];
const invoices = [];
for (const ref of ["POS-M12A", "POS-M12B"]) {
  await rec.goto(patientUrl, { waitUntil: "networkidle0" });
  await rec.select("#template_id", await rec.$$eval("#template_id option", (os) => os.find((o) => o.textContent.includes("الإبط"))?.value));
  await submit(rec, "form:has(#template_id) button[type=submit]");
  invoices.push(rec.url().split("?")[0]);
  await rec.select("#method", "card");
  await rec.type("#reference", ref);
  await submit(rec, "form:has(#method) button[type=submit]");
}
check((await text(rec)).includes("مدفوعة") && invoices.length === 2, "two underarm packages sold and paid (4,500 each)");
await Promise.all([rec.waitForNavigation({ waitUntil: "networkidle0" }), rec.click("[data-thermal-link]")]);
const receipt = await rec.$eval("[data-thermal-receipt]", (e) => e.innerText);
check(receipt.includes("INV-") && receipt.includes("4,500.00") && receipt.includes("POS-M12B") && !(await rec.$("[data-ereceipt-uuid]")), "80mm receipt: invoice, total, card reference; no e-receipt id yet");
await rec.setViewport({ width: 420, height: 900 });
await shot(rec, "m12-01-thermal-receipt");
await rec.setViewport({ width: 1440, height: 900 });

// ---------- Package refund: reception requests (fee 300), chief approves, cashier pays out by card
await rec.goto(patientUrl, { waitUntil: "networkidle0" });
await rec.$$eval("[data-package-actions]", (ds) => ds.forEach((d) => { d.open = true; }));
const unused = await rec.$eval("[data-package-refund]", (e) => e.innerText);
check(unused.includes("4,500.00"), "unused value of the first package is the full 4,500");
await rec.$eval("[data-package-refund] input[name=fee]", (e) => { e.value = "300"; });
await rec.select("[data-package-refund] select[name=method]", "card");
await rec.type("[data-package-refund] input[name=reason]", "سفر المريضة للخارج");
await submit(rec, "[data-package-refund] button[type=submit]");
check((await text(rec)).includes("تم إرسال طلب استرداد الباقة"), "package refund requested");
await acc.goto(`${BASE}/os/refunds`, { waitUntil: "networkidle0" });
const pr = await acc.$eval("[data-package-refunds]", (e) => e.innerText);
check(pr.includes("4,200.00") && pr.includes("300.00"), "refund = 4,500 unused − 300 fee = 4,200");
await shot(acc, "m12-02-package-refund");
await submit(acc, "[data-package-refunds] button[value=approve]");
const cashier = await login("cashier@demo.goldencare.local");
await cashier.goto(`${BASE}/os/refunds`, { waitUntil: "networkidle0" });
await cashier.type("[data-package-refunds] input[name=reference]", "POS-RF-M12");
await submit(cashier, "[data-package-refunds] button[type=submit]");
check((await text(cashier)).includes("تم صرف") || !(await cashier.$("[data-package-refunds]")), "cashier paid the package refund");
await rec.goto(patientUrl, { waitUntil: "networkidle0" });
check((await rec.$eval("[data-packages]", (e) => e.innerText)).includes("مسترد"), "first package shows as refunded");

// ---------- Transfer the second package to another patient (center director)
const dir = await login("director@demo.goldencare.local");
await dir.goto(`${BASE}/os/patients?q=01001110006`, { waitUntil: "networkidle0" });
const mrn = ((await text(dir)).match(/P-\d{6}/) ?? [])[0];
await dir.goto(patientUrl, { waitUntil: "networkidle0" });
await dir.$$eval("[data-package-actions]", (ds) => ds.forEach((d) => { d.open = true; }));
const transferForm = (await dir.$$("[data-package-transfer]")).at(-1);
await (await transferForm.$("input[name=mrn]")).type(mrn ?? "");
await (await transferForm.$("input[name=reason]")).type("هدية لأخيها بموافقة المريضة");
await Promise.all([dir.waitForNavigation({ waitUntil: "networkidle0" }), (await transferForm.$("button[type=submit]")).click()]);
check(Boolean(mrn) && (await text(dir)).includes("تم تحويل الجلسات المتبقية"), `second package transferred to ${mrn}`);
await dir.goto(`${BASE}/os/patients?q=01001110006`, { waitUntil: "networkidle0" });
await Promise.all([dir.waitForNavigation({ waitUntil: "networkidle0" }), dir.click("a[href^='/os/patients/']:not([href$='/new'])")]);
check((await dir.$eval("[data-packages]", (e) => e.innerText)).includes("6/6"), "receiving patient now holds the package with 6/6 sessions");

// ---------- Supplier return: the store records 20 gloves, the chief accountant approves
const inv = await login("inventory@demo.goldencare.local");
await inv.goto(`${BASE}/os/inventory/returns`, { waitUntil: "networkidle0" });
await inv.select("[data-new-return] select[name=receipt]", await inv.$$eval("[data-new-return] select[name=receipt] option", (os) => os.find((o) => o.textContent.includes("DEMO-INV-001"))?.value));
await submit(inv, "[data-new-return] form:not([action]) button");
const gloveRow = await inv.$$eval("[data-new-return] tbody tr", (rows) => rows.findIndex((r) => r.innerText.includes("GL-2609")));
const rows = await inv.$$("[data-new-return] tbody tr");
const qty = await rows[gloveRow].$("input");
await qty.click({ clickCount: 3 });
await qty.type("20");
await inv.type("[data-new-return] input[name=reason]", "عبوة تالفة من المورد");
await submit(inv, "[data-new-return] button[type=submit]");
check((await text(inv)).includes("تم تسجيل المرتجع"), "store recorded the return of 20 gloves");
check(!(await inv.$("[data-returns] button[value=approve]")), "the store keeper cannot approve their own return");
await acc.goto(`${BASE}/os/inventory/returns`, { waitUntil: "networkidle0" });
await submit(acc, "[data-returns] button[value=approve]");
const ret = await acc.$eval("[data-returns]", (e) => e.innerText);
check(ret.includes("معتمد") && ret.includes("70.00"), "return approved at lot cost 20 × 3.50 = 70.00");
await shot(acc, "m12-03-supplier-return");

// ---------- E-receipt queue: blocked until codes exist → codes set → re-sent → accepted by the simulator
await acc.goto(`${BASE}/os/accounting/einvoice`, { waitUntil: "networkidle0" });
const blocked = await acc.$$eval("[data-einvoice-doc=blocked]", (es) => es.map((e) => e.innerText));
check(blocked.length >= 3, `documents blocked with reasons (${blocked.length}: two sales and the package refund)`);
await shot(acc, "m12-04-einvoice-blocked");
const codes = [...new Set(blocked.join("\n").match(/ETA code of ([A-Z0-9-]+)/g)?.map((x) => x.replace("ETA code of ", "")) ?? [])];
await acc.goto(`${BASE}/os/accounting/einvoice?tab=services`, { waitUntil: "networkidle0" });
for (const code of codes) {
  const items = await acc.$$("[data-service-tax] li");
  for (const li of items) {
    if (!(await li.evaluate((e, c) => e.innerText.split("\n")[0].trim() === c, code))) continue;
    await (await li.$("select[name=eta_item_type]")).select("EGS");
    await (await li.$("input[name=eta_item_code]")).type(`EG-123456789-${code}`);
    await (await li.$("input[name=tax_type]")).type("T1");
    await (await li.$("input[name=tax_subtype]")).type("V009");
    await (await li.$("input[name=tax_rate]")).type("0");
    await Promise.all([acc.waitForNavigation({ waitUntil: "networkidle0" }), (await li.$("button[type=submit]")).click()]);
    break;
  }
}
check(codes.length > 0 && (await text(acc)).includes("تم حفظ بيانات الخدمة"), `test codes set for ${codes.join(", ")}`);
await acc.goto(`${BASE}/os/accounting/einvoice`, { waitUntil: "networkidle0" });
while (await acc.$("[data-einvoice-doc=blocked] button[type=submit]")) await submit(acc, "[data-einvoice-doc=blocked] button[type=submit]");
const d = await dispatch();
check((d.einvoice?.accepted ?? 0) >= 3, `simulator accepted the queued documents (${JSON.stringify(d.einvoice)})`);
await acc.goto(`${BASE}/os/accounting/einvoice`, { waitUntil: "networkidle0" });
const q = await acc.$eval("[data-einvoice-docs]", (e) => e.innerText);
check((await acc.$$("[data-einvoice-doc=accepted]")).length >= 3 && q.includes("مرتجع") && q.includes("4,200.00"), "sales and the refund (a return document for the 4,200 paid back) accepted");
await shot(acc, "m12-05-einvoice-accepted");

// ---------- Reprinted receipt carries the e-receipt id; day sheet; ledger
await cashier.goto(`${invoices[1].replace("/os/billing/", "/os/print/receipt/")}`, { waitUntil: "networkidle0" });
check(Boolean(await cashier.$("[data-ereceipt-uuid]")), "reprinted receipt shows the e-receipt id");
await rec.goto(`${BASE}/os/reception`, { waitUntil: "networkidle0" });
await Promise.all([rec.waitForNavigation({ waitUntil: "networkidle0" }), rec.click("[data-day-sheet-link]")]);
const sheets = await rec.$$("[data-day-sheet]");
check(sheets.length >= 1 && (await text(rec)).includes("حضر"), `day sheet printed: ${sheets.length} doctor page(s) with arrival and payment tick boxes`);
await shot(rec, "m12-06-day-sheet");
await acc.goto(`${BASE}/os/accounting`, { waitUntil: "networkidle0" });
check((await text(acc)).includes("الميزان متوازن"), "trial balance still balanced");
await browser.close();
