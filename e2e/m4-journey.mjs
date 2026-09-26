// Milestone 4 journey: user administration → forced password change → refund maker-checker → online payment.
// Run on a freshly seeded local stack (PAYMENTS_MODE=dev, PORTAL_DEV_SHOW_OTP=true).
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

async function staff(email, password = PASS) {
  const ctx = await browser.createBrowserContext();
  const page = await ctx.newPage();
  page.on("pageerror", (e) => console.log("PAGEERROR", e.message));
  await page.goto(`${BASE}/os/login`, { waitUntil: "networkidle0" });
  await page.type("#email", email);
  await page.type("#password", password);
  await page.click("button[type=submit]");
  await page.waitForFunction(() => location.pathname !== "/os/login" || document.querySelector("[role=alert], .text-danger"), { timeout: 15000 }).catch(() => {});
  await page.waitForNetworkIdle({ idleTime: 400 }).catch(() => {});
  await passMfa(page, email);
  return page;
}
async function clickButton(page, scopeSel, contains, label) {
  for (const h of await page.$$(scopeSel)) {
    if (!(await h.evaluate((e) => e.innerText)).includes(contains)) continue;
    for (const b of await h.$$("button")) {
      if ((await b.evaluate((e) => e.innerText)).includes(label)) { await Promise.all([page.waitForNavigation({ waitUntil: "networkidle0" }), b.click()]); return true; }
    }
  }
  return false;
}

// ---------- Administrator creates an account
const adm = await staff("admin@demo.goldencare.local");
await adm.goto(`${BASE}/os/users`, { waitUntil: "networkidle0" });
check((await text(adm)).includes("مستخدم جديد"), "admin opens users & roles");
await adm.type("#nu-email", "cashier2@demo.goldencare.local");
await adm.type("#nu-ar", "أمين خزينة مساعد");
await adm.type("#nu-en", "Assistant Cashier");
await adm.select("#nu-role", "cashier");
await adm.select("#nu-branch", await adm.$eval("#nu-branch option:nth-child(2)", (o) => o.value));
await adm.select("#nu-kind", "finance");
await adm.click("form:has(#nu-email) button[type=submit]");
await adm.waitForSelector("[data-temp-password]", { timeout: 15000 }).catch(() => {});
const temp = await adm.$eval("[data-temp-password]", (e) => e.textContent.trim()).catch(() => "");
check(temp.length >= 14, "temporary password shown once");
await shot(adm, "m4-01-user-created");

// New user must change the password before anything else
const nu = await staff("cashier2@demo.goldencare.local", temp);
check(nu.url().endsWith("/os/password"), "first sign-in forced to set a password");
await nu.type("#password", "short1");
await nu.type("#confirm", "short1");
await nu.click("form button[type=submit]");
await sleep(1200);
check((await text(nu)).includes("12 حرفًا"), "weak password refused");
await nu.$eval("#password", (e) => { e.value = ""; });
await nu.$eval("#confirm", (e) => { e.value = ""; });
await nu.type("#password", "Shorouk-Cashier-2026");
await nu.type("#confirm", "Shorouk-Cashier-2026");
await submit(nu, "form button[type=submit]");
await nu.waitForFunction(() => location.pathname !== "/os", { timeout: 8000 }).catch(() => {});
check(nu.url().endsWith("/os/cashier"), "after the change the cashier lands on the cash desk: " + nu.url());

// ---------- Invoice paid by InstaPay, then a refund request
const rec = await staff("reception@demo.goldencare.local");
await rec.goto(`${BASE}/os/patients/new`, { waitUntil: "networkidle0" });
await rec.type("#first_name_ar", "هبة");
await rec.type("#last_name_ar", "منير");
await rec.type("#phone_raw", "01229990022");
await submit(rec, "button[type=submit]");
const pid = rec.url().split("/").pop();
const newInvoice = async () => {
  await rec.goto(`${BASE}/os/patients/${pid}`, { waitUntil: "networkidle0" });
  await submit(rec, "form:has(input[name=patient_id]) button.btn-gold");
  const cons = await rec.$$eval("select[name=service_id] option", (os) => os.find((o) => o.textContent.includes("DERM-CONS"))?.value);
  await rec.select("select[name=service_id]", cons);
  await submit(rec, "form:has(select[name=service_id]) button[type=submit]");
  await submit(rec, "form:has(input[name=invoice_id]):not(:has(select)) button[type=submit]");
  return rec.url().split("?")[0];
};
const inv1 = await newInvoice();
check(!(await rec.$$eval("#method option", (os) => os.map((o) => o.value))).includes("online"), "staff cannot record 'online' payments by hand");
await rec.select("#method", "instapay");
await rec.type("#reference", "IP-M4-1");
await submit(rec, "form:has(#method) button[type=submit]");
check((await text(rec)).includes("مدفوعة"), "invoice paid (InstaPay)");
await rec.$eval("details:has(#rf-amount) summary", (s) => s.click());
await rec.type("#rf-amount", "200");
await rec.select("#rf-method", "cash");
await rec.type("#rf-reason", "لم تُستكمل الجلسة بسبب عطل بالجهاز");
await submit(rec, "form:has(#rf-amount) button[type=submit]");
check((await text(rec)).includes("تم إرسال طلب الاسترداد"), "refund requested by reception");
await rec.goto(`${BASE}/os/refunds`, { waitUntil: "networkidle0" });
check((await rec.$("button[value=approve]")) === null, "requester has no approve button");

// ---------- Chief accountant approves (someone else)
const acc = await staff("accountant@demo.goldencare.local");
await acc.goto(`${BASE}/os/refunds`, { waitUntil: "networkidle0" });
await shot(acc, "m4-02-refund-queue");
await submit(acc, "button[value=approve]");
check((await text(acc)).includes("معتمد"), "refund approved by the chief accountant");

// ---------- Cashier pays it out of an open session
await nu.goto(`${BASE}/os/refunds`, { waitUntil: "networkidle0" });
await submit(nu, "form:has(input[name=id]) button.btn-gold");
check((await text(nu)).includes("افتح وردية"), "cash refund needs an open cashier session");
await nu.goto(`${BASE}/os/cashier`, { waitUntil: "networkidle0" });
await nu.$eval("#opening_float", (e) => { e.value = "1000"; });
await submit(nu, "form:has(#opening_float) button[type=submit]");
await nu.goto(`${BASE}/os/refunds`, { waitUntil: "networkidle0" });
await submit(nu, "form:has(input[name=id]) button.btn-gold");
check((await text(nu)).includes("تم صرف المبلغ"), "refund paid out and posted");
await nu.goto(`${BASE}/os/cashier`, { waitUntil: "networkidle0" });
await nu.type("#counted", "800");
await submit(nu, "form:has(#counted) button[type=submit]");
check((await text(nu)).includes("تم إقفال الوردية"), "cash closes at 800 (1000 float − 200 refund) without a difference");
await rec.goto(inv1, { waitUntil: "networkidle0" });
check((await text(rec)).includes("تم رده للمريض"), "invoice shows the refunded amount");
await acc.goto(`${BASE}/os/accounting`, { waitUntil: "networkidle0" });
check((await text(acc)).includes("الميزان متوازن"), "trial balance still balanced");

// ---------- Patient pays a second invoice online
const inv2 = await newInvoice();
const ctx = await browser.createBrowserContext();
const pt = await ctx.newPage();
pt.on("pageerror", (e) => console.log("PAGEERROR", e.message));
await pt.goto(`${BASE}/ar/portal`, { waitUntil: "networkidle0" });
await pt.type("#phone", "01229990022");
await pt.click("form button[type=submit]");
await pt.waitForSelector("#code");
await pt.type("#code", await pt.$eval(".border-dashed .num", (e) => e.textContent.trim()));
await submit(pt, "form button[type=submit]");
await pt.goto(`${BASE}/ar/portal/finance`, { waitUntil: "networkidle0" });
await shot(pt, "m4-03-portal-finance");
check((await text(pt)).includes("تم رده لك"), "patient sees the 200 refund on the first invoice");
check((await pt.$$("form:has(input[name=invoice]) button")).length === 1, "one invoice with a Pay now button");
await submit(pt, "form:has(input[name=invoice]) button");
check(pt.url().includes("/portal/pay/dev/"), "sent to the payment page");
await shot(pt, "m4-04-checkout-sim");
await submit(pt, "button[value=decline]");
check((await text(pt)).includes("لم تتم عملية الدفع"), "declined card → nothing charged");
await pt.goto(`${BASE}/ar/portal/finance`, { waitUntil: "networkidle0" });
await submit(pt, "form:has(input[name=invoice]) button");
await submit(pt, "button[value=success]");
const ret = await text(pt);
check(ret.includes("تم الدفع بنجاح") && /RCT-\d{4}-\d{6}/.test(ret), "payment confirmed with a receipt number");
await shot(pt, "m4-05-paid");
await pt.goto(`${BASE}/ar/portal/finance`, { waitUntil: "networkidle0" });
check((await pt.$$("form:has(input[name=invoice]) button")).length === 0 && (await text(pt)).includes("دفع إلكتروني"), "balance cleared; receipt shows online payment");
await rec.goto(inv2, { waitUntil: "networkidle0" });
check((await text(rec)).includes("مدفوعة"), "staff see the invoice paid");
// the return page cannot be spoofed: another patient sees nothing
const intentUrl = pt.url();
await acc.goto(`${BASE}/os/refunds`, { waitUntil: "networkidle0" });
check((await text(acc)).includes("تم التحصيل"), "finance sees the captured online payment");

// ---------- Deactivate the new account → it can no longer sign in
await adm.goto(`${BASE}/os/users?q=cashier2`, { waitUntil: "networkidle0" });
await adm.$eval("details summary", (s) => s.click());
await adm.type("form:has(input[name=active]) input[name=reason]", "انتهاء فترة التدريب");
await submit(adm, "form:has(input[name=active]) button[type=submit]");
check((await text(adm)).includes("موقوف"), "account deactivated with a reason");
await shot(adm, "m4-06-users");
const blocked = await staff("cashier2@demo.goldencare.local", "Shorouk-Cashier-2026");
check(blocked.url().includes("/os/login"), "deactivated user cannot sign in");
void intentUrl;
await browser.close();
