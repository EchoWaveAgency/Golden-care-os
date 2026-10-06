// Milestone 10 journey: the patient care assistant (WhatsApp, local simulator).
// Medical director turns it on → reception books → assistant confirms the booking with the patient →
// visit, doctor asks for a follow-up and signs → assistant follows up after the visit (worse, complaint, low rating,
// follow-up booking) → doctor sees it → a danger sign opens an urgent escalation and pauses the assistant →
// patient relations replies and resolves → outcome figures. Run on a freshly seeded local stack (CARE_SIMULATOR=on).
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
const cairoDay = (offset) => new Intl.DateTimeFormat("en-CA", { timeZone: "Africa/Cairo" }).format(new Date(Date.now() + offset * 86400000));

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
async function openPatient(page, phone) {
  await page.goto(`${BASE}/os/patients?q=${phone}`, { waitUntil: "networkidle0" });
  await Promise.all([page.waitForNavigation({ waitUntil: "networkidle0" }), page.click("a[href^='/os/patients/']:not([href$='/new'])")]);
  return { url: page.url().split("?")[0], name: (await page.$eval("h1", (e) => e.innerText)).trim() };
}
async function book(page, patientUrl, doctor, day, hhmm) {
  await page.goto(patientUrl.replace(/\/os\/patients\/(.+)$/, "/os/appointments/new?patient=$1"), { waitUntil: "networkidle0" });
  await page.select("#doctor_id", await optionValue(page, "#doctor_id", doctor));
  await page.$eval("#date", (el, v) => { el.value = v; }, day);
  await page.$eval("#time", (el, v) => { el.value = v; }, hhmm);
  await submit(page, "button[type=submit]");
  return (await text(page)).includes("تم حجز الموعد");
}
async function runDue(page) {
  await page.goto(`${BASE}/os/care`, { waitUntil: "networkidle0" });
  await submit(page, "form[data-care-run] button");
}
async function openConversation(page, tab, name, kindLabel) {
  await page.goto(`${BASE}/os/care?tab=${tab}`, { waitUntil: "networkidle0" });
  const href = await page.$$eval("[data-journeys] a", (as, [n, k]) => as.find((a) => a.innerText.includes(n) && a.innerText.includes(k))?.getAttribute("href"), [name, kindLabel]);
  if (!href) return false;
  await page.goto(BASE + href, { waitUntil: "networkidle0" });
  return true;
}
async function patientSays(page, words) {
  await page.$eval("[data-sim-text]", (e) => { e.value = ""; });
  await page.type("[data-sim-text]", words);
  await submit(page, "[data-simulator] button[type=submit]");
}
const lastAgentLine = (page) => page.$$eval("[data-msg=out]", (els) => els.at(-1)?.innerText ?? "");

// ---------- Medical director turns the assistant on
const md = await login("meddir@demo.goldencare.local");
await md.goto(`${BASE}/os/care/settings`, { waitUntil: "networkidle0" });
if (!(await md.$eval("[data-setting=enabled]", (e) => e.checked))) await md.click("[data-setting=enabled]");
await md.$eval("[data-setting=contact_from]", (e) => { e.value = "00:00"; });
await md.$eval("[data-setting=contact_to]", (e) => { e.value = "23:59"; });
for (const [k, v] of [["confirm_delay_min", "0"], ["confirm_min_lead_hours", "24"], ["post_visit_delay_hours", "0"], ["nudge_after_hours", "4"]]) {
  await md.$eval(`[data-setting=${k}]`, (e, x) => { e.value = x; }, v);
}
await md.$eval("[data-setting=clinic_phone]", (e) => { e.value = "0225550000"; });
await submit(md, "form button[type=submit]");
check((await text(md)).includes("تم حفظ الإعدادات"), "medical director turns the care assistant on");
await shot(md, "m10-01-settings");

// ---------- Reception books حسام two days ahead with the dentist
const rec = await login("reception@demo.goldencare.local");
const hossam = await openPatient(rec, "01001110006");
check(await book(rec, hossam.url, "كريم", cairoDay(2), "12:35"), "appointment booked two days ahead");

// ---------- The assistant confirms the booking on WhatsApp (simulated patient replies)
const pr = await login("relations@demo.goldencare.local");
await runDue(pr);
check(/فُتحت [1-9]/.test(await text(pr)), "due conversations opened by the assistant");
check(await openConversation(pr, "waiting", hossam.name, "تأكيد حجز"), "booking confirmation conversation is waiting for the patient");
const opener = await lastAgentLine(pr);
check(opener.includes("مساعد جولدن كير الآلي") && opener.includes("كريم") && opener.includes("قالب معتمد"), "opener says it is automated, names the doctor, uses the approved template");
await patientSays(pr, "ايوه ان شاء الله");
check((await lastAgentLine(pr)).includes("اتأكد حجزك") && (await text(pr)).includes("أكد الحضور"), "patient confirms; appointment confirmed");
await shot(pr, "m10-02-confirmation");

// ---------- Visit today: check-in, the dentist asks for a follow-up and signs
check(await book(rec, hossam.url, "كريم", cairoDay(0), new Intl.DateTimeFormat("en-GB", { timeZone: "Africa/Cairo", hour: "2-digit", minute: "2-digit" }).format(new Date(Date.now() + 10 * 60000)).slice(0, 4) + "5"),
  "same-day visit booked");
await rec.goto(`${BASE}/os/reception`, { waitUntil: "networkidle0" });
let checkin = null;
for (const h of await rec.$$("tr")) {
  const t = await h.evaluate((e) => e.innerText);
  if (t.includes(hossam.name) && t.includes("كريم")) for (const b of await h.$$("button")) if ((await b.evaluate((e) => e.innerText)).trim() === "تسجيل وصول") checkin = b;
}
await Promise.all([rec.waitForNavigation({ waitUntil: "networkidle0" }), checkin.click()]);
const dr = await login("dr.dental@demo.goldencare.local");
for (const li of await dr.$$("li")) {
  if ((await li.evaluate((e) => e.innerText)).includes(hossam.name)) { const b = await li.$("button"); if (b) { await Promise.all([dr.waitForNavigation({ waitUntil: "networkidle0" }), b.click()]); break; } }
}
check(dr.url().includes("/os/encounters/"), "dentist opens the visit");
await dr.$eval("#followup_due", (e, v) => { e.value = v; }, cairoDay(14));
await submit(dr, "[data-followup] form button[type=submit]");
check((await text(dr)).includes("تم تحديد موعد المتابعة"), "dentist asks for a follow-up visit in two weeks");
await dr.type("#chief_complaint", "ألم في الضرس");
await submit(dr, "button[value=sign]");
check((await text(dr)).includes("موقّع"), "visit signed");

// ---------- After the visit: the assistant checks on him
await runDue(pr);
check(await openConversation(pr, "waiting", hossam.name, "متابعة بعد الزيارة"), "after-visit follow-up opened");
await patientSays(pr, "1");
check((await lastAgentLine(pr)).includes("حاسس بتحسن"), "asks about improvement (no prescription → no medication question)");
await patientSays(pr, "اسوأ للأسف");
check((await text(pr)).includes("بلّغت الدكتور") && (await text(pr)).includes("الحالة أسوأ بعد الزيارة"), "worse → doctor alerted, emergency advice given");
await patientSays(pr, "الاستقبال اتأخر علينا ساعة");
check((await text(pr)).includes("متأسفين جدًا"), "service complaint acknowledged");
await patientSays(pr, "2");
check((await text(pr)).includes("شكرًا لصراحتك") && (await lastAgentLine(pr)).includes("الدكتور طلب متابعة"), "low rating recorded; offers to book the follow-up");
await patientSays(pr, "1");
const pv = await text(pr);
check(pv.includes("حد من الاستقبال هيكلمك") && pv.includes("أجاب على المتابعة") && pv.includes("2 / 5") && pv.includes("أسوأ"), "follow-up booking requested; answers summarised");
await shot(pr, "m10-03-after-visit");

// ---------- The dentist sees it in his workspace
await dr.goto(`${BASE}/os/doctor`, { waitUntil: "networkidle0" });
check((await dr.$eval("[data-doctor-escalations]", (e) => e.innerText)).includes("الحالة أسوأ"), "dentist sees the escalation about his patient");

// ---------- Danger sign: urgent escalation, assistant paused, staff take over
const dina = await openPatient(rec, "01001110005");
check(await book(rec, dina.url, "كريم", cairoDay(3), "13:35"), "second patient booked");
await runDue(pr);
check(await openConversation(pr, "waiting", dina.name, "تأكيد حجز"), "second booking confirmation opened");
await patientSays(pr, "انا تعبانة جدا ومش قادرة اتنفس");
const urgentView = await text(pr);
check((await lastAgentLine(pr)).includes("123") && urgentView.includes("مع فريق العمل") && urgentView.includes("عاجل جدًا"), "danger sign → emergency advice, urgent escalation, assistant paused");
await pr.type("textarea[name=body]", "أهلًا يا مدام دينا، معاكي ريم من جولدن كير، هكلمك حالًا.");
await submit(pr, "form:has(textarea[name=body]) button[type=submit]");
check((await text(pr)).includes("تم إرسال ردك"), "patient relations replies on WhatsApp");
await shot(pr, "m10-04-urgent");
await pr.goto(`${BASE}/os/care`, { waitUntil: "networkidle0" });
check((await pr.$eval("[data-escalations]", (e) => e.innerText)).includes("عاجل جدًا"), "urgent escalation at the top of the care screen");
await pr.type("[data-escalation=urgent] input[name=note]", "تم الاتصال، المريضة توجهت للطوارئ");
await submit(pr, "[data-escalation=urgent] form:has(input[name=note]) button[type=submit]");
check((await text(pr)).includes("تم إغلاق التنبيه"), "urgent escalation resolved with a note");
await shot(pr, "m10-05-care-overview");

// ---------- Tickets and outcome figures
await pr.goto(`${BASE}/os/tickets`, { waitUntil: "networkidle0" });
const tk = await text(pr);
check(tk.includes("تقييم منخفض") && tk.includes("حجز متابعة"), "complaint and follow-up booking tickets reach the desk");
await md.goto(`${BASE}/os/care`, { waitUntil: "networkidle0" });
check((await md.$eval("[data-care-kpis]", (e) => e.innerText)).includes("1 / "), "outcome figures for the medical director");

await browser.close();
