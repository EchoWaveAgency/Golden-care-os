// Milestone 5 journey: two-factor sign-in → doctor contract → invoice → settlement prepare/approve/pay → doctor statement.
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

async function login(email, mfa = true, password = PASS) {
  const ctx = await browser.createBrowserContext();
  const page = await ctx.newPage();
  page.on("pageerror", (e) => console.log("PAGEERROR", e.message));
  await page.goto(`${BASE}/os/login`, { waitUntil: "networkidle0" });
  await page.type("#email", email);
  await page.type("#password", password);
  await page.click("button[type=submit]");
  await page.waitForFunction(() => !["/os", "/os/login"].includes(location.pathname), { timeout: 15000 }).catch(() => {});
  await page.waitForNetworkIdle({ idleTime: 400 }).catch(() => {});
  if (mfa) await passMfa(page, email);
  return page;
}

// ---------- Two-factor sign-in for a privileged role
const dir0 = await login("director@demo.goldencare.local", false);
check(dir0.url().endsWith("/os/mfa"), "privileged user is stopped at two-factor setup after the password");
check((await text(dir0)).includes("فعّل التحقق الثنائي"), "first time: enrollment screen");
await dir0.goto(`${BASE}/os/executive`, { waitUntil: "networkidle0" });
check(dir0.url().endsWith("/os/mfa"), "no page is reachable before the second factor");
await dir0.click("form button[type=submit]");
await dir0.waitForSelector("[data-totp-secret]");
await shot(dir0, "m5-01-mfa-enroll");
await passMfa(dir0, "director@demo.goldencare.local");
check(dir0.url().endsWith("/os/executive"), "after the code the director lands on the command center");
const dir = await login("director@demo.goldencare.local");
check(dir.url().endsWith("/os/executive"), "next sign-in: password + code from the app");

// ---------- Contract for the dermatologist (40%, laser fixed 250), entered by the chief accountant
const acc = await login("accountant@demo.goldencare.local");
const dirPage = dir;
{ const dir = acc;
await dir.goto(`${BASE}/os/settlements`, { waitUntil: "networkidle0" });
const derm = await dir.$$eval("tr", (rows) => { const r = rows.find((x) => x.innerText.includes("سارة منصور")); return r?.querySelector("a[href*='/contracts/']")?.getAttribute("href"); });
check(Boolean(derm), "no contract yet → link to contracts");
await dir.goto(BASE + derm, { waitUntil: "networkidle0" });
await dir.type("#dp", "40");
const laserRow = await dir.$$eval("form div.grid.grid-cols-5", (rows) => rows.findIndex((r) => r.innerText.includes("LASER-AXILLA")));
const rowsH = await dir.$$("form div.grid.grid-cols-5");
await (await rowsH[laserRow].$("select")).select("fixed");
await (await rowsH[laserRow].$("input")).type("250");
await dir.type("#notes", "عقد تجريبي — مرجع ورقي DEMO-01");
await submit(dir, "form:has(#dp) button[type=submit]");
check((await text(dir)).includes("تم حفظ العقد"), "contract saved (audited)");
await shot(dir, "m5-02-contract");
}
void dirPage;

// ---------- Reception invoices consultation + laser for Dr. Sara, patient pays
const rec = await login("reception@demo.goldencare.local");
await rec.goto(`${BASE}/os/patients?q=01001110001`, { waitUntil: "networkidle0" });
await Promise.all([rec.waitForNavigation({ waitUntil: "networkidle0" }), rec.click("a[href^='/os/patients/']:not([href$='/new'])")]);
await submit(rec, "form:has(input[name=patient_id]) button.btn-gold");
const addLine = async (code) => {
  const sv = await rec.$$eval("select[name=service_id] option", (os, c) => os.find((o) => o.textContent.includes(c))?.value, code);
  await rec.select("select[name=service_id]", sv);
  const dv = await rec.$$eval("select[name=doctor_id] option", (os) => os.find((o) => o.textContent.includes("سارة"))?.value);
  await rec.select("select[name=doctor_id]", dv);
  await submit(rec, "form:has(select[name=service_id]) button[type=submit]");
};
await addLine("DERM-CONS");
await addLine("LASER-AXILLA");
await submit(rec, "form:has(input[name=invoice_id]):not(:has(select)) button[type=submit]");
await rec.select("#method", "card");
await rec.type("#reference", "POS-M5");
await submit(rec, "form:has(#method) button[type=submit]");
check((await text(rec)).includes("مدفوعة"), "invoice 1,400 issued and paid");

// ---------- Accountant prepares, cannot approve own; director approves; accountant pays
const month = new Intl.DateTimeFormat("en-CA", { timeZone: "Africa/Cairo" }).format(new Date()).slice(0, 7);
await acc.goto(`${BASE}/os/settlements?m=${month}`, { waitUntil: "networkidle0" });
const prepared = await acc.$$("tr");
for (const r of prepared) {
  if ((await r.evaluate((e) => e.innerText)).includes("سارة منصور")) { const b = await r.$("button"); await Promise.all([acc.waitForNavigation({ waitUntil: "networkidle0" }), b.click()]); break; }
}
const stmt = await text(acc);
check(acc.url().includes("/os/settlements/") && stmt.includes("450.00"), "statement: 40% × 500 + 250 fixed = 450");
check(stmt.includes("أعددت هذا الكشف"), "preparer is told another approver is required");
const runUrl = acc.url().split("?")[0];
await shot(acc, "m5-03-statement-draft");
await dir.goto(runUrl, { waitUntil: "networkidle0" });
await submit(dir, "button.btn-primary");
check((await text(dir)).includes("تم اعتماد الكشف"), "director approves → accrual posted");
await acc.goto(runUrl, { waitUntil: "networkidle0" });
await acc.type("input[name=reference]", "BANK-TRF-M5-001");
await submit(acc, "form:has(input[name=reference]) button[type=submit]");
check((await text(acc)).includes("تم تسجيل الصرف"), "payment recorded by bank transfer");
await acc.goto(`${BASE}/os/accounting`, { waitUntil: "networkidle0" });
check((await text(acc)).includes("الميزان متوازن"), "trial balance still balanced");

// ---------- The doctor sees only their own approved statement
const doc = await login("dr.derm@demo.goldencare.local");
await doc.goto(`${BASE}/os/my-settlements`, { waitUntil: "networkidle0" });
const mine = await text(doc);
check(mine.includes("450.00") && mine.includes("40%"), "doctor sees own statement and contract");
await Promise.all([doc.waitForNavigation({ waitUntil: "networkidle0" }), doc.click("a[href^='/os/my-settlements/']")]);
check((await text(doc)).includes("INV-"), "statement lines carry invoice numbers for reconciliation");
await shot(doc, "m5-04-doctor-statement");
await doc.goto(runUrl, { waitUntil: "networkidle0" });
check(!(await text(doc)).includes("450.00") || doc.url().includes("denied"), "doctor cannot open the finance screens");

// ---------- Lost phone: admin resets the director's second factor
const adm = await login("admin@demo.goldencare.local");
await adm.goto(`${BASE}/os/users?q=director@demo`, { waitUntil: "networkidle0" });
await adm.$eval("details summary", (s) => s.click());
await adm.type("input[placeholder='سبب إعادة الضبط']", "فقد الهاتف");
await adm.click("form:has(input[placeholder='سبب إعادة الضبط']) button[type=submit]");
await adm.waitForSelector("[data-temp-password]", { timeout: 15000 }).catch(() => {});
const temp = await adm.$eval("[data-temp-password]", (e) => e.textContent.trim()).catch(() => "");
check(temp.length > 10, "reset ends sessions and issues a one-time password");
const old = await login("director@demo.goldencare.local", false);
check(old.url().includes("/os/login"), "the old password no longer works");
const dir2 = await login("director@demo.goldencare.local", false, temp);
check(dir2.url().endsWith("/os/password"), "with the one-time password: must set a new password first");
await dir2.type("#password", "Director-New-Pass-2026");
await dir2.type("#confirm", "Director-New-Pass-2026");
await Promise.all([dir2.waitForNavigation({ waitUntil: "networkidle0" }), dir2.click("form button[type=submit]")]);
await dir2.waitForFunction(() => location.pathname === "/os/mfa", { timeout: 10000 }).catch(() => {});
check((await text(dir2)).includes("فعّل التحقق الثنائي"), "then enrolls a new authenticator");
await shot(adm, "m5-05-users-2fa");
await browser.close();
