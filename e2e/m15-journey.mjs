// Milestone 15 journey (operations): the store keeper sends gloves from the main store to the laser room store,
// the nurse confirms receipt with a shortage note → reception books a laser session on the laser device, and a
// second booking on the same device at the same time is refused. Run on a freshly seeded local stack.
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
const optionValue = (page, selector, part) => page.$$eval(`${selector} option`, (os, t) => os.find((o) => o.textContent.includes(t))?.value, part);

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

// ---------- Transfer: main store → laser room store
const inv = await login("inventory@demo.goldencare.local");
await inv.goto(`${BASE}/os/inventory/transfers`, { waitUntil: "networkidle0" });
await inv.select("[data-new-transfer] select[name=from]", await optionValue(inv, "[data-new-transfer] select[name=from]", "المخزن الرئيسي"));
await inv.select("[data-new-transfer] select[name=to]", await optionValue(inv, "[data-new-transfer] select[name=to]", "غرفة الليزر"));
await inv.select("[data-new-transfer] select[name=item_0]", await optionValue(inv, "[data-new-transfer] select[name=item_0]", "GLOVE-M"));
await inv.type("[data-new-transfer] input[name=qty_0]", "20");
await submit(inv, "[data-new-transfer] button[type=submit]");
check((await text(inv)).includes("تم تسجيل طلب التحويل"), "transfer of 20 gloves requested");
await submit(inv, "[data-transfer=requested] button[type=submit]");
const sent = await text(inv);
check(sent.includes("خرجت الأصناف") && sent.includes("70.00"), "sent: 20 × 3.50 = 70.00 left the main store");
check(sent.includes("أرسلته أنت"), "the sender cannot confirm the receipt");

const nurse = await login("nurse@demo.goldencare.local");
await nurse.goto(`${BASE}/os/inventory/transfers`, { waitUntil: "networkidle0" });
await nurse.$eval("[data-receive-transfer] input[name^=got_]", (e) => { e.value = "19"; });
await submit(nurse, "[data-receive-transfer] button[type=submit]");
check((await text(nurse)).includes("اكتب سبب النقص"), "a shortage needs a note");
await nurse.$eval("[data-receive-transfer] input[name^=got_]", (e) => { e.value = "19"; });
await nurse.type("[data-receive-transfer] input[name=note]", "قفاز ممزق في العبوة");
await submit(nurse, "[data-receive-transfer] button[type=submit]");
const rcv = await text(nurse);
check(rcv.includes("تم الاستلام في المخزن المستلم") && rcv.includes("3.50"), "nurse confirmed 19; one glove (3.50) written off with the note");
await shot(nurse, "m15-01-transfer");

// ---------- Device booking
const rec = await login("reception@demo.goldencare.local");
const day = new Intl.DateTimeFormat("en-CA", { timeZone: "Africa/Cairo" }).format(new Date(Date.now() + 2 * 86400000));
async function book(phone, doctorPart) {
  await rec.goto(`${BASE}/os/patients?q=${phone}`, { waitUntil: "networkidle0" });
  await Promise.all([rec.waitForNavigation({ waitUntil: "networkidle0" }), rec.click("a[href^='/os/patients/']:not([href$='/new'])")]);
  await rec.goto(rec.url().split("?")[0].replace(/\/os\/patients\/(.+)$/, "/os/appointments/new?patient=$1"), { waitUntil: "networkidle0" });
  await rec.select("#doctor_id", await optionValue(rec, "#doctor_id", doctorPart));
  await rec.$eval("#date", (e, v) => { e.value = v; }, day);
  await rec.$eval("#time", (e) => { e.value = "15:00"; });
  await rec.select("#device_id", await optionValue(rec, "#device_id", "LSR"));
  await rec.click("button[type=submit]");
  await rec.waitForNetworkIdle({ idleTime: 600 }).catch(() => {});
  return text(rec);
}
const b1 = await book("01001110003", "سارة");
check(b1.includes("تم حجز الموعد") || rec.url().includes("booked=1"), "laser session booked on the laser device");
const b2 = await book("01001110004", "هالة");
check(b2.includes("الجهاز محجوز في هذا الوقت"), "second booking on the same device at the same time refused");
await shot(rec, "m15-02-device-conflict");
await browser.close();
