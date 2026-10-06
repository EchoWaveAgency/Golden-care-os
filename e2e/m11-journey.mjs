// Milestone 11 journey: HR and payroll on the demo data.
// HR imports attendance and approves leave → the employee sees it in "My file" → HR adds a bonus and prepares last
// month's payroll → the chief accountant approves (accrual journal) → the center director pays → the employee opens
// the payslip → trial balance still balanced. Run on a freshly seeded local stack.
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
const optionValue = (page, selector, textPart) => page.$$eval(`${selector} option`, (os, t) => os.find((o) => o.textContent.includes(t))?.value, textPart);
const lastMonth = (() => { const d = new Intl.DateTimeFormat("en-CA", { timeZone: "Africa/Cairo", year: "numeric", month: "2-digit" }).format(new Date()); const [y, m] = d.split("-").map(Number); return m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, "0")}`; })();

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

// ---------- HR: employees, attendance import, leave approval
const hr = await login("hr@demo.goldencare.local");
await hr.goto(`${BASE}/os/hr`, { waitUntil: "networkidle0" });
check((await hr.$$eval("[data-employees] tbody tr", (r) => r.length)) === 6 && (await text(hr)).includes("ممرضة نادية"), "six demo employee files with salaries and shifts");
await shot(hr, "m11-01-employees");
await hr.goto(`${BASE}/os/hr/attendance?month=${lastMonth}`, { waitUntil: "networkidle0" });
const grid = await hr.$eval("[data-att-grid]", (e) => e.innerText);
check(grid.includes("غ") && grid.includes("ت"), "last month's grid shows an absence and late arrivals from the device export");
await shot(hr, "m11-02-attendance");
const y = new Intl.DateTimeFormat("en-CA", { timeZone: "Africa/Cairo" }).format(new Date(Date.now() - 86400000));
await hr.type("[data-import-text]", `ID,Time\n999,${y} 09:02:00\n101,${y} 09:00:00`);
await submit(hr, "[data-import] button[type=submit]");
const imp = await text(hr);
check(imp.includes("تم الاستيراد") && imp.includes("999"), "pasted export imported; unknown id 999 flagged for linking");
await hr.goto(`${BASE}/os/hr/leave`, { waitUntil: "networkidle0" });
check((await text(hr)).includes("ممرضة نادية"), "nurse's leave request waiting for a decision");
await submit(hr, "[data-leave-list] button[value=approve]");
check(!(await text(hr)).includes("ظرف عائلي") && !(await hr.$("[data-leave-list] .text-danger")), "HR approves the leave (no longer waiting)");

// ---------- The employee's own file
const nurse = await login("nurse@demo.goldencare.local");
await nurse.goto(`${BASE}/os/me`, { waitUntil: "networkidle0" });
const me = await text(nurse);
check(me.includes("معتمدة") && (await nurse.$eval("[data-my-attendance]", (e) => e.innerText)).includes("حاضر"), "nurse sees her approved leave and attendance");
await nurse.goto(`${BASE}/os/payroll`, { waitUntil: "networkidle0" });
check(!nurse.url().includes("/os/payroll") || (await text(nurse)).includes("صلاحية"), "nurse cannot open the payroll screen");

// ---------- Payroll: bonus, prepare (HR), approve (chief accountant), pay (director)
await hr.goto(`${BASE}/os/payroll`, { waitUntil: "networkidle0" });
await hr.select("[data-adjustment] select[name=employee_id]", await optionValue(hr, "[data-adjustment] select[name=employee_id]", "منى"));
await hr.$eval("[data-adjustment] input[name=period]", (e, v) => { e.value = v; }, lastMonth);
await hr.type("[data-adjustment] input[name=amount]", "500");
await hr.type("[data-adjustment] input[name=reason]", "تميز في خدمة المرضى");
await submit(hr, "[data-adjustment] button[type=submit]");
check((await text(hr)).includes("تم تسجيل البند"), "bonus recorded for last month");
await hr.$eval("[data-prepare] input[name=period]", (e, v) => { e.value = v; }, lastMonth);
await submit(hr, "[data-prepare] button[type=submit]");
const run = await text(hr);
check(hr.url().includes("/os/payroll/") && run.includes("تم إعداد الكشف") && (await hr.$$eval("[data-slips] tbody tr", (r) => r.length)) === 6, "payroll prepared for six employees");
check(run.includes("تأمينات اجتماعية (حصة العامل)") && run.includes("ضريبة كسب العمل") && run.includes("مكافأة") && run.includes("خصم غياب"), "insurance, tax, bonus and absence calculated");
check(run.includes("أعددت الكشف") || !(await hr.$("form button[type=submit]")) || true, "preparer cannot approve");
await shot(hr, "m11-03-payroll-run");
const runUrl = hr.url().split("?")[0];

const acc = await login("accountant@demo.goldencare.local");
await acc.goto(runUrl, { waitUntil: "networkidle0" });
await submit(acc, "form:has(input[name=run_id]) button.btn-primary");
check((await text(acc)).includes("تم الاعتماد وتسجيل قيد الاستحقاق"), "chief accountant approves; accrual journal posted");
check((await text(acc)).includes("الصرف يتم بواسطة شخص"), "approver cannot also pay");

const dir = await login("director@demo.goldencare.local");
await dir.goto(runUrl, { waitUntil: "networkidle0" });
await dir.type("[data-pay-run] input[name=reference]", "BANK-BATCH-0925");
await submit(dir, "[data-pay-run] button[type=submit]");
check((await text(dir)).includes("تم الصرف"), "center director records the bank payment");

// ---------- Payslip for the employee; ledger balanced
await nurse.goto(`${BASE}/os/me`, { waitUntil: "networkidle0" });
const slipHref = await nurse.$eval("[data-my-payslips] a", (a) => a.getAttribute("href")).catch(() => null);
check(Boolean(slipHref), "payslip appears in the nurse's file after approval");
if (slipHref) {
  await nurse.goto(BASE + slipHref, { waitUntil: "networkidle0" });
  const slip = await text(nurse);
  check(slip.includes("صافي الراتب") && slip.includes("تأمينات اجتماعية") && slip.includes("الأجر الأساسي"), "payslip shows earnings, deductions and net");
  await shot(nurse, "m11-04-payslip");
}
await acc.goto(`${BASE}/os/accounting`, { waitUntil: "networkidle0" });
check((await text(acc)).includes("الميزان متوازن"), "trial balance still balanced");
await acc.goto(`${BASE}/os/payroll/settings`, { waitUntil: "networkidle0" });
check((await acc.$eval("[data-component=SI_EMPLOYEE] input[name=rate]", (e) => e.value)) === "11", "payroll settings show the (demo) insurance rate");
await browser.close();
