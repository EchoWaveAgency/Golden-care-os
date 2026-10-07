// Milestone 14 journey (clinical completion): reception uploads a lab result and a "before" photo → the treating
// dentist reviews the result and shows it to the patient, records findings on the dental chart → the patient opens
// the result in the portal → HR sets review criteria and submits a performance review → the nurse acknowledges it.
// Run on a freshly seeded local stack (FILES_MODE=local). Fixtures in e2e/fixtures are synthetic.
import puppeteer from "puppeteer-core";
import chromium from "@sparticuz/chromium";
import { passMfa } from "./mfa.mjs";

const BASE = "http://localhost:3100";
const OUT = process.env.E2E_OUT ?? "/tmp/";
const PASS = "GoldenCare-Demo-2026";
const FIX = new URL("./fixtures/", import.meta.url).pathname;
const browser = await puppeteer.launch({ executablePath: await chromium.executablePath(), args: chromium.args.filter((a) => !["--single-process", "--no-zygote"].includes(a)).concat(["--no-sandbox"]), headless: "shell",
  defaultViewport: { width: 1440, height: 900, deviceScaleFactor: 1 } });
const shot = async (p, n) => { await p.evaluate(() => window.scrollTo(0, 0)); const tall = await p.evaluate(() => document.documentElement.scrollHeight > window.innerHeight + 40); await p.screenshot({ path: OUT + n + ".png", fullPage: tall }); };
const text = (p) => p.evaluate(() => document.body.innerText);
const submit = (page, selector) => Promise.all([page.waitForNavigation({ waitUntil: "networkidle0" }), page.click(selector)]);
const check = (cond, msg) => { console.log((cond ? "OK   " : "FAIL ") + msg); if (!cond) process.exitCode = 1; };

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
async function upload(page, file, kind, title, extra = {}) {
  await (await page.$("[data-upload-file] input[name=file]")).uploadFile(FIX + file);
  await page.select("[data-upload-file] select[name=kind]", kind);
  await page.type("[data-upload-file] input[name=title]", title);
  if (extra.stage) await page.select("[data-upload-file] select[name=photo_stage]", extra.stage);
  if (extra.area) await page.type("[data-upload-file] input[name=body_area]", extra.area);
  await submit(page, "[data-upload-file] button[type=submit]");
}

// ---------- Reception uploads the lab result and a photo
const rec = await login("reception@demo.goldencare.local");
await rec.goto(`${BASE}/os/patients?q=01001110002`, { waitUntil: "networkidle0" });
await Promise.all([rec.waitForNavigation({ waitUntil: "networkidle0" }), rec.click("a[href^='/os/patients/']:not([href$='/new'])")]);
const patientUrl = rec.url().split("?")[0];
await upload(rec, "demo-lab.pdf", "lab_result", "صورة دم كاملة — معمل تجريبي");
check((await text(rec)).includes("تم رفع الملف"), "lab result uploaded");
await upload(rec, "demo-photo.jpg", "id_document", "صورة البطاقة (تجريبية)");
const recFiles = await rec.$eval("[data-patient-files]", (e) => e.innerText);
check(recFiles.includes("صورة البطاقة") && !recFiles.includes("صورة دم كاملة"), "reception sees the ID document but not the clinical result");

// ---------- Dentist: reviews and releases the result, uploads a photo, records the dental chart
const dr = await login("dr.dental@demo.goldencare.local");
await dr.goto(`${BASE}/os/doctor`, { waitUntil: "networkidle0" });
check((await dr.$eval("[data-results-to-review]", (e) => e.innerText).catch(() => "")).includes("صورة دم كاملة"), "result waits in the dentist's review list");
await dr.goto(patientUrl, { waitUntil: "networkidle0" });
const pdfHref = await dr.$eval("[data-file=lab_result] a", (a) => a.getAttribute("href"));
const pdf = await dr.evaluate(async (h) => { const r = await fetch(h); return { ok: r.ok, type: r.headers.get("content-type"), head: (await r.text()).slice(0, 5) }; }, pdfHref);
check(pdf.ok && pdf.type === "application/pdf" && pdf.head === "%PDF-", "dentist opens the PDF");
await dr.type("[data-review-file] input[name=note]", "طبيعي");
await submit(dr, "[data-review-file] button[type=submit]");
check((await text(dr)).includes("تمت مراجعة النتيجة"), "result reviewed");
await dr.type("[data-release-file] input[name=note]", "النتيجة طبيعية، لا يلزم أي إجراء.");
await submit(dr, "[data-release-file] button[type=submit]");
check((await text(dr)).includes("أصبح الملف ظاهرًا للمريض"), "result shown to the patient");
await upload(dr, "demo-photo.jpg", "photo", "الفك السفلي", { stage: "before", area: "الفك السفلي" });
check(Boolean(await dr.$("[data-photo-gallery] img")), "before photo in the gallery");
await dr.$eval("[data-dental]", (d) => { d.open = true; });
await dr.click("[data-tooth='36']");
await dr.click("[data-tooth='46']");
await dr.select("[data-chart-form] select[name=condition]", "caries");
await dr.click("[data-chart-form] input[value=O]");
await submit(dr, "[data-chart-form] button");
check((await text(dr)).includes("تم تحديث مخطط الأسنان"), "findings recorded on teeth 36 and 46");
const fill36 = await dr.$eval("[data-tooth='36'] rect", (r) => r.getAttribute("fill"));
check(fill36 === "#f4c7c3", "tooth 36 shows caries on the chart");
await shot(dr, "m14-01-patient-files-chart");

// ---------- Patient sees the released result in the portal
const ctx = await browser.createBrowserContext();
const pt = await ctx.newPage();
await pt.goto(`${BASE}/ar/portal`, { waitUntil: "networkidle0" });
await pt.type("#phone", "01001110002");
await pt.click("form button[type=submit]");
await pt.waitForSelector("#code");
await pt.type("#code", await pt.$eval(".border-dashed .num", (e) => e.textContent.trim()));
await submit(pt, "form button[type=submit]");
await pt.goto(`${BASE}/ar/portal/medical`, { waitUntil: "networkidle0" });
const pf = await pt.$eval("[data-portal-files]", (e) => e.innerText).catch(() => "");
check(pf.includes("صورة دم كاملة") && pf.includes("النتيجة طبيعية") && !pf.includes("الفك السفلي"), "patient sees the released result with the doctor's note (photo not shared)");
const href = await pt.$eval("[data-portal-files] a", (a) => a.getAttribute("href"));
const got = await pt.evaluate(async (h) => (await fetch(h)).headers.get("content-type"), href);
check(got === "application/pdf", "patient downloads the result");
await shot(pt, "m14-02-portal-result");

// ---------- Performance review
const hr = await login("hr@demo.goldencare.local");
await hr.goto(`${BASE}/os/hr/performance`, { waitUntil: "networkidle0" });
check((await hr.$$("[data-kpis] tbody tr")).length >= 5, "KPIs listed for the employees");
for (const [code, ar, w] of [["CARE", "رعاية المرضى", "2"], ["TEAM", "العمل الجماعي", "1"]]) {
  await hr.$eval("[data-criteria]", (d) => { d.open = true; });
  await hr.type("[data-criteria] input[name=code]", code);
  await hr.type("[data-criteria] input[name=name_ar]", ar);
  await hr.$eval("[data-criteria] input[name=weight]", (e, v) => { e.value = v; }, w);
  await submit(hr, "[data-criteria] button[type=submit]");
}
await hr.select("[data-review-form] select[name=employee_id]", await hr.$$eval("[data-review-form] select[name=employee_id] option", (os) => os.find((o) => o.textContent.includes("نادية"))?.value));
await hr.select("[data-review-form] select[name=score_CARE]", "5");
await hr.select("[data-review-form] select[name=score_TEAM]", "4");
await hr.type("[data-review-form] textarea[name=strengths]", "تعامل هادئ ومطمئن مع المرضى");
await submit(hr, "[data-review-form] button[value='1']");
check((await text(hr)).includes("تم إرسال التقييم") && (await hr.$eval("[data-reviews]", (e) => e.innerText)).includes("4.67"), "review submitted: (5×2 + 4) ÷ 3 = 4.67");
await shot(hr, "m14-03-performance");
const nurse = await login("nurse@demo.goldencare.local");
await nurse.goto(`${BASE}/os/me`, { waitUntil: "networkidle0" });
await nurse.type("[data-my-reviews] input[name=comment]", "شكرًا");
await submit(nurse, "[data-my-reviews] button[type=submit]");
check((await text(nurse)).includes("تم تسجيل اطلاعك"), "nurse acknowledged her review");
await browser.close();
