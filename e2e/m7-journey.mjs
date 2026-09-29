// Milestone 7 journey: purchase order → approval by another person → partial receipt (over-receipt refused)
// → close short → direct receipt confirmed by an approver → supplier payment request → release by another person → profitability report + CSV export.
// Run on a freshly seeded local stack.
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
const pickItem = async (page, row, code) => {
  const v = await page.$eval(`[data-row-item='${row}']`, (s, c) => Array.from(s.options).find((o) => o.textContent.startsWith(c))?.value, code);
  await page.select(`[data-row-item='${row}']`, v);
};

// ---------- Store keeper creates and submits a purchase order
const st = await login("inventory@demo.goldencare.local");
await st.goto(`${BASE}/os/purchasing/new`, { waitUntil: "networkidle0" });
await st.select("#supplier_id", await st.$$eval("#supplier_id option", (os) => os.find((o) => o.textContent.includes("المستلزمات الطبية"))?.value));
await pickItem(st, 0, "GEL-US");
await st.type("[data-row-qty='0']", "10");
await st.type("[data-row-cost='0']", "85");
await st.click("[data-add-row]");
await pickItem(st, 1, "GLOVE-M");
await st.type("[data-row-qty='1']", "100");
await st.type("[data-row-cost='1']", "3.5");
await submit(st, "form button[type=submit].btn-primary");
check(st.url().includes("/os/purchasing/") && (await text(st)).includes("1,200.00"), "draft PO saved (850 + 350)");
const poUrl = st.url().split("?")[0];
await submit(st, "form:has(input[name=po_id]) button.btn-primary");
check((await text(st)).includes("أُرسل للاعتماد"), "submitted for approval");
check(!(await text(st)).includes("استلام الآن"), "cannot receive before approval");

// ---------- Center director approves (two-factor sign-in)
const dir = await login("director@demo.goldencare.local");
await dir.goto(poUrl, { waitUntil: "networkidle0" });
await submit(dir, "form:has(input[name=po_id]) button.btn-primary");
check((await text(dir)).includes("تم اعتماد أمر الشراء"), "approved by the center director");
await shot(dir, "m7-01-po-approved");

// ---------- Partial receipt; over-receipt refused
await st.goto(poUrl, { waitUntil: "networkidle0" });
const setQty = async (code, v) => {
  for (const row of await st.$$("tbody tr")) {
    if ((await row.evaluate((e) => e.innerText)).includes(code)) {
      const q = await row.$("input[name^=qty_]"); await q.evaluate((e, val) => { e.value = val; }, String(v));
      const lot = await row.$("input[name^=lot_]"); if (lot) await lot.evaluate((e, val) => { e.value = val; }, `${code}-M7`);
    }
  }
};
await setQty("GEL-US", 6);
await setQty("GLOVE-M", 100);
await st.type("input[name=supplier_invoice_no]", "SUP-M7-1");
await st.click("form:has(input[name=supplier_invoice_no]) button.btn-gold");
await st.waitForFunction(() => /[?&](ok|error)=/.test(location.search), { timeout: 15000 }).catch(async () => {
  await shot(st, "m7-debug"); console.log(await st.evaluate(() => [...document.querySelectorAll("input")].filter((i) => !i.checkValidity()).map((i) => `${i.name}:${i.validationMessage}:${i.value}`).join(" | ")));
});
const rec = await text(st);
check(rec.includes("تم الاستلام على أمر الشراء") && rec.includes("استلام جزئي"), "partial receipt posted (6 gel, 100 gloves)");
await st.$eval("input[name^=qty_]", (e) => { e.removeAttribute("max"); });
await setQty("GEL-US", 5);
await st.type("input[name=supplier_invoice_no]", "SUP-M7-2");
await submit(st, "form:has(input[name=supplier_invoice_no]) button.btn-gold");
check((await text(st)).includes("أكبر من المتبقي"), "receiving more than ordered is refused");
await shot(st, "m7-02-po-partial");
await st.goto(poUrl, { waitUntil: "networkidle0" });
await st.type("form:has(input[name=reason]) input[name=reason]", "المورد لا يملك باقي الكمية");
await submit(st, "form:has(input[name=reason]) button.btn-ghost");
check((await text(st)).includes("تم إغلاق الأمر") && !(await text(st)).includes("استلام الآن"), "order closed short at the received quantities");

// ---------- Supplier payment: requested by the chief accountant, released by the director
const acc = await login("accountant@demo.goldencare.local");
await acc.goto(`${BASE}/os/suppliers`, { waitUntil: "networkidle0" });
check((await text(acc)).includes("13,500.00"), "owed to suppliers: 12,640 demo receipt + 860 new receipt");
const supHref = await acc.$$eval("a[href^='/os/suppliers/']", (as) => as.find((a) => a.innerText.includes("المستلزمات الطبية"))?.getAttribute("href"));
await acc.goto(BASE + supHref, { waitUntil: "networkidle0" });
const supUrl = acc.url().split("?")[0];
check((await text(acc)).includes("غير مؤكد") && (await acc.$$("input[name^=pay_]")).length === 1, "receipt without an order is flagged and cannot be paid until confirmed");
await dir.goto(supUrl, { waitUntil: "networkidle0" });
await submit(dir, "button[data-confirm-receipt]");
check((await text(dir)).includes("تم تأكيد الاستلام"), "director (not the receiver) confirms the direct receipt");
await acc.goto(supUrl, { waitUntil: "networkidle0" });
const payInputs = await acc.$$("input[name^=pay_]");
check(payInputs.length === 2, "confirmed receipt is now payable");
await payInputs[0].type("5000");
await acc.type("#reference", "TRF-M7-0929");
await submit(acc, "form:has(#reference) button[type=submit]");
check((await text(acc)).includes("تم طلب الدفعة"), "payment requested");
check((await text(acc)).includes("طلبتها"), "requester cannot release it");
await dir.goto(supUrl, { waitUntil: "networkidle0" });
await submit(dir, "button[value=approve]");
check((await text(dir)).includes("تم صرف الدفعة"), "released by the director and posted");
await shot(dir, "m7-03-supplier");

// ---------- Profitability report + CSV export
const recp = await login("reception@demo.goldencare.local");
await recp.goto(`${BASE}/os/patients?q=01001110002`, { waitUntil: "networkidle0" });
await Promise.all([recp.waitForNavigation({ waitUntil: "networkidle0" }), recp.click("a[href^='/os/patients/']:not([href$='/new'])")]);
await submit(recp, "form:has(input[name=patient_id]) button.btn-gold");
const sv = await recp.$$eval("select[name=service_id] option", (os) => os.find((o) => o.textContent.includes("DERM-CONS"))?.value);
await recp.select("select[name=service_id]", sv);
const dv = await recp.$$eval("select[name=doctor_id] option", (os) => os.find((o) => o.textContent.includes("سارة"))?.value);
await recp.select("select[name=doctor_id]", dv);
await submit(recp, "form:has(select[name=service_id]) button[type=submit]");
await submit(recp, "form:has(input[name=invoice_id]):not(:has(select)) button[type=submit]");
await acc.goto(`${BASE}/os/reports/profitability`, { waitUntil: "networkidle0" });
const rep = await text(acc);
check(rep.includes("كشف جلدية") && rep.includes("صافي الإيراد"), "report lists the invoiced service");
await shot(acc, "m7-04-profitability");
const csv = await acc.evaluate(async () => { const r = await fetch(document.querySelector("a[href*='/export']").getAttribute("href")); return { type: r.headers.get("content-type"), body: await r.text() }; });
check(csv.type.includes("text/csv") && csv.body.includes("DERM-CONS"), "CSV export downloads under the user's session");
const anon = await (await browser.createBrowserContext()).newPage();
const res = await anon.goto(`${BASE}/os/reports/profitability/export`, { waitUntil: "networkidle0" });
check(anon.url().includes("/os/login") || res.status() === 401, "export requires sign-in");
await acc.goto(`${BASE}/os/accounting`, { waitUntil: "networkidle0" });
check((await text(acc)).includes("الميزان متوازن"), "trial balance still balanced");
await browser.close();
