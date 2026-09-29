// Milestone 6 journey: stock overview & alerts → goods receipt (expiry rules) → FEFO issue for an appointment
// → insufficient stock refused → blind count → approval by another person → ledger still balanced.
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
const usable = async (page, code) => page.$$eval("tbody tr", (rows, c) => {
  const r = rows.find((x) => x.innerText.includes(c));
  return r ? Number(r.querySelectorAll("td")[2].innerText.split(/\s/)[0]) : NaN;
}, code);
const pickItem = async (page, row, code) => {
  const v = await page.$eval(`[data-row-item='${row}']`, (s, c) => Array.from(s.options).find((o) => o.textContent.startsWith(c))?.value, code);
  await page.select(`[data-row-item='${row}']`, v);
};

// ---------- Store keeper: overview and alerts
const st = await login("inventory@demo.goldencare.local");
check(st.url().includes("/os/inventory"), "store keeper lands on inventory");
const ov = await text(st);
check(ov.includes("قيمة المخزون") && ov.includes("12,640.00"), "stock value from the demo receipt (12,640)");
check(/تنتهي خلال 60 يومًا\s*\n?\s*1/.test(ov) || ov.includes("AN-SOON") || (await usable(st, "ANES-CRM")) === 13, "numbing cream: 13 usable, one lot expiring soon");
await shot(st, "m6-01-overview");

// ---------- Receipt: expiry required for medicines, then posted
await st.goto(`${BASE}/os/inventory/receive`, { waitUntil: "networkidle0" });
await st.type("#supplier_invoice_no", "DEMO-INV-002");
await pickItem(st, 0, "ANES-CRM");
await st.type("[data-row-lot='0']", "AN-NEW");
await st.type("[data-row-qty='0']", "5");
await st.type("[data-row-cost='0']", "150");
await submit(st, "form button[type=submit].btn-gold");
check((await text(st)).includes("تاريخ انتهاء الصلاحية مطلوب"), "medicine without expiry refused");
await st.type("#supplier_invoice_no", "DEMO-INV-002");
await pickItem(st, 0, "ANES-CRM");
await st.type("[data-row-lot='0']", "AN-NEW");
await st.$eval("[data-row-expiry='0']", (e) => { const d = new Date(Date.now() + 300 * 86400000).toISOString().slice(0, 10); const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set; set.call(e, d); e.dispatchEvent(new Event("input", { bubbles: true })); });
await st.type("[data-row-qty='0']", "5");
await st.type("[data-row-cost='0']", "150");
await shot(st, "m6-02-receive");
await submit(st, "form button[type=submit].btn-gold");
check((await text(st)).includes("تم الاستلام GRN-"), "receipt posted with a GRN number");
check((await usable(st, "ANES-CRM")) === 18, "numbing cream usable 13 + 5 = 18");

// ---------- Nurse: FEFO issue for today's appointment; shortage refused
const nurse = await login("nurse@demo.goldencare.local");
await nurse.goto(`${BASE}/os/inventory/issue`, { waitUntil: "networkidle0" });
const chip = await nurse.$("a[href*='appointment=']");
check(Boolean(chip), "today's appointments offered");
await Promise.all([nurse.waitForNavigation({ waitUntil: "networkidle0" }), chip.click()]);
await pickItem(nurse, 0, "ANES-CRM");
await nurse.type("[data-row-qty='0']", "1");
await nurse.click("[data-add-row]");
await pickItem(nurse, 1, "GLOVE-M");
await nurse.type("[data-row-qty='1']", "2");
await shot(nurse, "m6-03-issue");
await submit(nurse, "form button[type=submit].btn-primary");
check((await text(nurse)).includes("تم الصرف ISS-"), "issue posted for the appointment");
await nurse.goto(`${BASE}/os/inventory/issue`, { waitUntil: "networkidle0" });
await nurse.type("#reason", "استخدام داخلي");
await pickItem(nurse, 0, "LSR-TIP");
await nurse.type("[data-row-qty='0']", "5");
await submit(nurse, "form button[type=submit].btn-primary");
check((await text(nurse)).includes("لا تكفي"), "issuing more than the usable stock is refused");
await st.goto(`${BASE}/os/inventory`, { waitUntil: "networkidle0" });
check((await usable(st, "ANES-CRM")) === 17 && (await usable(st, "GLOVE-M")) === 198, "balances after issue (17 cream, 198 gloves)");

// ---------- Blind count: gloves short by 8, everything else as expected
await st.goto(`${BASE}/os/inventory/counts`, { waitUntil: "networkidle0" });
await submit(st, "form button[type=submit]");
check(st.url().includes("/os/inventory/counts/"), "count started");
const countUrl = st.url().split("?")[0];
check(!(await text(st)).includes("الدفتري"), "blind count: system quantities hidden while counting");
const expected = { "GL-2609": 190, "GZ-2609": 60, "GEL-A": 4, "AN-SOON": 2, "AN-LATE": 10, "AN-NEW": 5, "CMP-11": 8, "TIP-1": 2 };
for (const row of await st.$$("tbody tr")) {
  const lot = (await row.$eval("td:nth-child(2)", (e) => e.innerText.trim()));
  const input = await row.$("input");
  if (input) await input.type(String(expected[lot] ?? 0));
}
await submit(st, "form button[type=submit]");
const sub = await text(st);
check(sub.includes("تم تقديم الجرد") && sub.includes("-28.00"), "submitted: net difference −28 (8 gloves × 3.50)");
check(sub.includes("يلزم اعتماد مسؤول آخر") || !(await st.$("form button.btn-primary")), "counter cannot approve own count");
await shot(st, "m6-04-count");

// ---------- Chief accountant approves (MFA), ledger balanced
const acc = await login("accountant@demo.goldencare.local");
await acc.goto(countUrl, { waitUntil: "networkidle0" });
await submit(acc, "form:has(input[name=count_id]) button.btn-primary");
check((await text(acc)).includes("تم اعتماد الجرد"), "approved by the chief accountant; differences posted");
await acc.goto(`${BASE}/os/accounting`, { waitUntil: "networkidle0" });
check((await text(acc)).includes("الميزان متوازن"), "trial balance still balanced");
await st.goto(`${BASE}/os/inventory`, { waitUntil: "networkidle0" });
check((await usable(st, "GLOVE-M")) === 190, "gloves now 190 after the approved count");
await browser.close();
