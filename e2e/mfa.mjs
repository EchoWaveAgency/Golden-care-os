// Completes two-factor sign-in for privileged demo users during E2E runs (synthetic accounts only).
import { totp } from "../scripts/local/totp.mjs";

const secrets = new Map();

export async function passMfa(page, email) {
  if (!page.url().includes("/os/mfa")) return;
  const start = await page.$("form button[type=submit]");
  const enrolling = (await page.evaluate(() => document.body.innerText)).includes("فعّل التحقق الثنائي") || (await page.evaluate(() => document.body.innerText)).includes("Set up two-factor");
  if (enrolling) {
    await start.click();
    await page.waitForSelector("[data-totp-secret]", { timeout: 15000 });
    secrets.set(email, await page.$eval("[data-totp-secret]", (e) => e.textContent.trim()));
  }
  const secret = secrets.get(email);
  if (!secret) throw new Error(`no TOTP secret known for ${email}`);
  for (let attempt = 0; attempt < 2; attempt++) {
    await page.$eval("#code", (e) => { e.value = ""; });
    await page.type("#code", totp(secret));
    await Promise.all([page.waitForNavigation({ waitUntil: "networkidle0" }).catch(() => {}), page.click("form:has(#code) button[type=submit]")]);
    await page.waitForFunction(() => !location.pathname.startsWith("/os/mfa") || document.querySelector("[role=alert]"), { timeout: 10000 }).catch(() => {});
    if (!page.url().includes("/os/mfa")) break;
    await new Promise((r) => setTimeout(r, 31000 - (Date.now() % 30000)));   // next time window
  }
  await page.waitForFunction(() => !["/os", "/os/mfa"].includes(location.pathname), { timeout: 15000 }).catch(() => {});
  await page.waitForNetworkIdle({ idleTime: 400 }).catch(() => {});
}
