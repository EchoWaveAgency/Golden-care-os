// Milestone 16 journey (website & marketing): marketing drafts an article → the medical director reviews it (the
// last editor can never approve their own text) → marketing approves → it is public on /articles → a patient allows a testimonial from the portal → marketing publishes it and
// it shows on the home page → marketing adds a version B to a landing page → visitors see A or B and one sends an
// inquiry → the funnel and A/B report count them → the admin turns on the SMS fallback.
// Run on a freshly seeded local stack. All content is synthetic.
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
const step = (page, to) => submit(page, `form:has(input[name=to][value=${to}]) button`);

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
/** Takes a content item from draft to published: medical director reviews, marketing approves and publishes. */
async function review(author, url, med, mkt) {
  await author.goto(url, { waitUntil: "networkidle0" });
  await step(author, "medical_review");
  await med.goto(url, { waitUntil: "networkidle0" });
  await step(med, "marketing_review");
  await mkt.goto(url, { waitUntil: "networkidle0" });
  await step(mkt, "approved");
  await step(mkt, "published");
  return (await text(mkt)).includes("منشور");
}

const med = await login("meddir@demo.goldencare.local");
const mkt = await login("marketing@demo.goldencare.local");

// ---------- Article drafted by marketing, medically reviewed, then public
await mkt.goto(`${BASE}/os/content/articles/new`, { waitUntil: "networkidle0" });
await mkt.select("#kind", "article");
await mkt.type("#slug", "sun-care-after-laser");
await mkt.type("#title_ar", "العناية بالبشرة بعد الليزر (مقال تجريبي)");
await mkt.type("#title_en", "Skin care after laser (demo article)");
await mkt.type("#summary_ar", "نصائح عامة للأيام الأولى بعد الجلسة.");
await mkt.type("#body_ar", "تجنّبي الشمس المباشرة واستخدمي واقي الشمس، والتزمي بتعليمات طبيبك.\n\nهذا مقال تجريبي لأغراض العرض.");
await mkt.select("#author_doctor_id", await mkt.$$eval("#author_doctor_id option", (os) => os.find((o) => o.textContent.includes("سارة"))?.value ?? ""));
await mkt.$eval("#reading_minutes", (e) => { e.value = "3"; });
await submit(mkt, "form:has(#slug) button[type=submit]");
const articleUrl = mkt.url().split("?")[0];
check(/\/os\/content\/articles\/[0-9a-f-]{36}$/.test(articleUrl) && (await text(mkt)).includes("تم الحفظ"), "article draft saved");
const pub = await browser.createBrowserContext();
const visitor = await pub.newPage();
const gone = await visitor.goto(`${BASE}/ar/articles/sun-care-after-laser`, { waitUntil: "networkidle0" });
check(gone.status() === 404, "draft is not public");
check(await review(mkt, articleUrl, med, mkt), "medical review → marketing approval → published");
await visitor.goto(`${BASE}/ar/articles`, { waitUntil: "networkidle0" });
check((await visitor.$eval("[data-articles]", (e) => e.innerText).catch(() => "")).includes("العناية بالبشرة بعد الليزر"), "listed on /articles");
await visitor.goto(`${BASE}/ar/articles/sun-care-after-laser`, { waitUntil: "networkidle0" });
check((await visitor.$eval("[data-article]", (e) => e.innerText).catch(() => "")).includes("واقي الشمس"), "article page is public");
await shot(visitor, "m16-01-article");

// ---------- Testimonial: the patient consents from the portal, marketing publishes it
const pctx = await browser.createBrowserContext();
const pt = await pctx.newPage();
await pt.goto(`${BASE}/ar/portal`, { waitUntil: "networkidle0" });
await pt.type("#phone", "01001110002");
await pt.click("form button[type=submit]");
await pt.waitForSelector("#code");
await pt.type("#code", await pt.$eval(".border-dashed .num", (e) => e.textContent.trim()));
await submit(pt, "form button[type=submit]");
await pt.goto(`${BASE}/ar/portal/profile`, { waitUntil: "networkidle0" });
const mrn = await pt.$$eval("dl .num", (els) => els[0].textContent.trim());
await submit(pt, "[data-testimonial-consent] button");
check((await pt.$eval("[data-testimonial-consent]", (e) => e.innerText)).includes("سحب الموافقة"), "patient allowed a testimonial from the portal");
await shot(pt, "m16-02-portal-consent");

await mkt.goto(`${BASE}/os/content/testimonials/new`, { waitUntil: "networkidle0" });
await mkt.type("#patient_id", mrn);
await mkt.type("#display_name_ar", "ن. ع.");
await mkt.type("#quote_ar", "الاستقبال منظم والطبيبة شرحت كل خطوة بهدوء.");
await mkt.$eval("#rating", (e) => { e.value = "5"; });
await submit(mkt, "form:has(#display_name_ar) button[type=submit]");
const tmUrl = mkt.url().split("?")[0];
check(/\/os\/content\/testimonials\/[0-9a-f-]{36}$/.test(tmUrl), "testimonial saved (consent on file)");
check(await review(mkt, tmUrl, med, mkt), "testimonial reviewed and published");
await visitor.goto(`${BASE}/ar`, { waitUntil: "networkidle0" });
const home = await visitor.$eval("[data-testimonials]", (e) => e.innerText).catch(() => "");
check(home.includes("الطبيبة شرحت كل خطوة") && home.includes("ن. ع.") && !home.includes(mrn), "testimonial on the home page under initials only");
await shot(visitor, "m16-03-home-testimonial");

// ---------- Landing page version B, visitors, one inquiry
await mkt.goto(`${BASE}/os/content?type=landing`, { waitUntil: "networkidle0" });
const lpHref = await mkt.$$eval("a[href^='/os/content/landing/']", (as) => as.find((a) => a.textContent.includes("Laser"))?.getAttribute("href"));
const lpUrl = BASE + lpHref;
await mkt.goto(lpUrl, { waitUntil: "networkidle0" });
await mkt.type("[name=variants_title_ar]", "جلسة ليزر بعد كشف طبي — احجزي الآن");
await mkt.type("[name=variants_title_en]", "Laser after a medical consultation — book now");
await mkt.$eval("[name=variants_weight]", (e) => { e.value = "99"; });
await submit(mkt, "form:has([name=variants_title_ar]) button[type=submit]");
check((await text(mkt)).includes("تم الحفظ"), "version B saved (back to review; version A stays live)");
check(await review(mkt, lpUrl, med, mkt), "version B reviewed and published");
const seen = [];
for (let i = 0; i < 3; i++) {
  const c = await browser.createBrowserContext();
  const v = await c.newPage();
  await v.goto(`${BASE}/ar/lp/laser-october`, { waitUntil: "networkidle0" });
  seen.push(await v.$eval("h1", (e) => e.textContent));
  if (i === 2) {
    await new Promise((r) => setTimeout(r, 2700));                    // the form rejects submissions faster than a person
    await v.type("[name=full_name]", "زائرة تجريبية");
    await v.type("[name=phone]", "01229990016");
    await v.click("[name=consent_contact]");
    await v.click("form:has([name=landing_slug]) button[type=submit]");
    await v.waitForFunction(() => /GC-|LD-|\d{4}-\d{4,}/.test(document.body.innerText) || document.querySelector("[role=status]"), { timeout: 10000 }).catch(() => {});
    await shot(v, "m16-04-landing-b");
  }
  await c.close();
}
check(seen.some((t) => t.includes("احجزي الآن")), `visitors see version B (${seen.filter((t) => t.includes("احجزي الآن")).length}/3 at 99%)`);

// ---------- Funnel and A/B report
await mkt.goto(`${BASE}/os/leads`, { waitUntil: "networkidle0" });
await submit(mkt, "[data-funnel-link]");
const ab = await mkt.$eval("[data-ab='laser-october']", (e) => e.innerText).catch(() => "");
const bRow = ab.split("\n").find((l) => l.startsWith("B")) ?? "";
check(/B\s+[1-3]\s+1\s/.test(bRow + " ") || /B\t[1-3]\t1/.test(bRow), `A/B report counts views and the inquiry for B (${bRow.replace(/\s+/g, " ")})`);
check((await mkt.$$("[data-funnel] tbody tr")).length >= 1, "funnel lists inquiries by source and campaign");
await shot(mkt, "m16-05-funnel-ab");

// ---------- SMS fallback (admin decides; it costs per message)
const admin = await login("admin@demo.goldencare.local");
await admin.goto(`${BASE}/os/messages`, { waitUntil: "networkidle0" });
await admin.click("[data-messaging-settings] input[name=sms_fallback]");
await submit(admin, "[data-messaging-settings] button[type=submit]");
check((await text(admin)).includes("تم حفظ إعدادات الرسائل") && await admin.$eval("[data-messaging-settings] input[name=sms_fallback]", (e) => e.checked), "SMS fallback switched on");
await browser.close();
