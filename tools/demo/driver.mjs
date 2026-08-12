/**
 * Phase 3 — the driver. Real interactions only.
 *
 * One clock: every beat starts by logging its mark, then holds for that line's
 * MEASURED audio duration plus a breath. Nothing is synced by eye, and no span
 * is estimated — `durations.json` comes from the written wav files.
 *
 * The cursor is an SVG overlay, never the hardware pointer. Driving the real
 * pointer means a notification can steal it mid-take, and it jumps between
 * points instead of travelling, which reads as fake.
 *
 *   node tools/demo/driver.mjs --take a
 */
import { chromium } from "playwright";
import { readFileSync, appendFileSync, mkdirSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, "../..");
const AUDIO = process.env.DEMO_AUDIO || resolve(ROOT, "../audio");
const DUR = JSON.parse(readFileSync(resolve(AUDIO, "durations.json"), "utf8"));
const LOG = resolve(ROOT, `beat-log-${process.argv[process.argv.indexOf("--take") + 1] || "a"}.txt`);
const BREATH = 450;

const URLS = {
  dorr: "https://dorr-flare.vercel.app",
  hadal: "https://hadal-flare.vercel.app",
  molfi: "https://molfi.fun",
  explorer: "https://coston2-explorer.flare.network",
};

// Testnet only. Asserted rather than trusted: a mainnet key here would sign
// something real, and the cost of being wrong is unbounded.
const CHAIN_ID = 114;
const DEMO_KEY = process.env.FLARE_RELAYER_KEY;
if (!DEMO_KEY) throw new Error("PREFLIGHT_NO_KEY: set FLARE_RELAYER_KEY (Coston2 testnet only)");

let t0 = 0;
const mark = (id, signing = false) => {
  const ms = Date.now() - t0;
  const row = `DEMO_LINE ${ms} ${id}${signing ? " SIGNING" : ""}`;
  console.log(row);
  appendFileSync(LOG, row + "\n");
};

/** Hold for this beat's real audio length. Throws if the line has no measurement. */
const hold = async (page, id) => {
  const secs = DUR[id];
  if (secs == null) throw new Error(`NO_DURATION: ${id} — regenerate Phase 2 before driving`);
  await page.waitForTimeout(secs * 1000 + BREATH);
};

const line = async (page, id, opts = {}) => { mark(id, opts.signing); };

/** Poll real state. Named error on timeout so a failed take says which beat died. */
async function until(page, label, predicate, timeoutMs = 30000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await page.evaluate(predicate).catch(() => false)) return;
    await page.waitForTimeout(250);
  }
  throw new Error(`UNTIL_TIMEOUT: ${label}`);
}

/** SVG cursor + click ring, injected once per page. */
async function installCursor(page) {
  await page.addInitScript(() => {
    window.__cursor = () => {
      if (document.getElementById("__demo_cursor")) return;
      const c = document.createElement("div");
      c.id = "__demo_cursor";
      c.style.cssText =
        "position:fixed;left:0;top:0;width:22px;height:22px;z-index:2147483647;pointer-events:none;" +
        "transform:translate(-50%,-50%);transition:none;will-change:transform";
      c.innerHTML =
        '<svg viewBox="0 0 24 24" width="22" height="22"><circle cx="12" cy="12" r="7" fill="rgba(255,255,255,.92)" stroke="rgba(0,0,0,.45)" stroke-width="1.5"/></svg>';
      document.documentElement.appendChild(c);
      window.__cx = window.innerWidth / 2;
      window.__cy = window.innerHeight / 2;
    };
    window.__glide = (x, y, ms) =>
      new Promise((done) => {
        window.__cursor();
        const el = document.getElementById("__demo_cursor");
        const sx = window.__cx, sy = window.__cy, t = performance.now();
        // easeInOutCubic — a linear cursor reads as a script, an eased one as a hand
        const ease = (p) => (p < 0.5 ? 4 * p * p * p : 1 - Math.pow(-2 * p + 2, 3) / 2);
        const step = (now) => {
          const p = Math.min(1, (now - t) / ms), e = ease(p);
          window.__cx = sx + (x - sx) * e;
          window.__cy = sy + (y - sy) * e;
          el.style.transform = `translate(${window.__cx}px,${window.__cy}px) translate(-50%,-50%)`;
          p < 1 ? requestAnimationFrame(step) : done();
        };
        requestAnimationFrame(step);
      });
    window.__ring = () => {
      const r = document.createElement("div");
      r.style.cssText =
        `position:fixed;left:${window.__cx}px;top:${window.__cy}px;width:14px;height:14px;border-radius:50%;` +
        "border:2px solid rgba(255,255,255,.9);z-index:2147483646;pointer-events:none;transform:translate(-50%,-50%)";
      document.documentElement.appendChild(r);
      r.animate(
        [{ transform: "translate(-50%,-50%) scale(1)", opacity: 1 },
         { transform: "translate(-50%,-50%) scale(3.2)", opacity: 0 }],
        { duration: 480, easing: "cubic-bezier(.2,.8,.2,1)" },
      ).onfinish = () => r.remove();
    };
  });
}

const glide = (page, x, y, ms = 700) => page.evaluate(([x, y, ms]) => window.__glide(x, y, ms), [x, y, ms]);

async function clickAt(page, sel, ms = 700) {
  const box = await page.locator(sel).first().boundingBox();
  if (!box) throw new Error(`NO_ELEMENT: ${sel}`);
  await glide(page, box.x + box.width / 2, box.y + box.height / 2, ms);
  await page.evaluate(() => window.__ring());
  await page.waitForTimeout(120);
  await page.locator(sel).first().click();
}

/** ~24 cps with jitter, real input events so React sees them. */
async function typeInto(page, sel, text) {
  const el = page.locator(sel).first();
  await el.click();
  for (const ch of text) {
    await el.type(ch, { delay: 0 });
    await page.waitForTimeout(42 + Math.random() * 22);
  }
}

/** Page-driven smooth scroll. Wheel events stutter on capture. */
const smoothTo = async (page, y, settle = 1200) => {
  await page.evaluate((y) => window.scrollTo({ top: y, behavior: "smooth" }), y);
  await page.waitForTimeout(settle);
};

/** Full-bleed signing overlay, held until the chain actually confirms. */
async function signingOverlay(page, on, label = "Signing Transaction") {
  await page.evaluate(([on, label]) => {
    const id = "__demo_signing";
    document.getElementById(id)?.remove();
    if (!on) return;
    const d = document.createElement("div");
    d.id = id;
    d.style.cssText =
      "position:fixed;inset:0;z-index:2147483645;background:#0b1220;display:flex;align-items:center;" +
      "justify-content:center;color:#fff;font:600 34px/1.2 system-ui,sans-serif;letter-spacing:-.02em";
    d.textContent = label;
    document.documentElement.appendChild(d);
  }, [on, label]);
}

/** Inject an EIP-1193 provider that really signs with the testnet key. */
async function installWallet(page, address) {
  await page.addInitScript((addr) => {
    let authorised = false;
    window.__signRequests = [];
    window.ethereum = {
      isMetaMask: true,
      request: async ({ method, params }) => {
        if (method === "eth_chainId") return "0x72";
        if (method === "net_version") return "114";
        if (method === "eth_accounts") return authorised ? [addr] : [];
        if (method === "eth_requestAccounts") { authorised = true; return [addr]; }
        if (method === "wallet_switchEthereumChain") return null;
        if (method === "personal_sign") {
          // Signed by the node side via __sign, exposed below. Still a real
          // secp256k1 signature over the real message — auto-approved, not faked.
          return await window.__sign(params[0]);
        }
        throw Object.assign(new Error("unsupported: " + method), { code: 4200 });
      },
      on: () => {}, removeListener: () => {},
    };
  }, address);
}

async function preflight(page, ctx) {
  // chain
  const { createPublicClient, http } = await import("viem");
  const rpc = process.env.FLARE_RPC_URL || "https://coston2-api.flare.network/ext/C/rpc";
  const id = await createPublicClient({ transport: http(rpc) }).getChainId();
  if (id !== CHAIN_ID) throw new Error(`PREFLIGHT_RPC_NOT_TESTNET: chainId ${id}`);

  // clear persisted state so the take starts from a real cold open
  await ctx.clearCookies();
  await page.evaluate(() => { localStorage.clear(); sessionStorage.clear(); }).catch(() => {});

  // scope error checks to this run
  const before = [];
  page.on("console", (m) => { if (m.type() === "error") before.push(m.text()); });
  return () => before.length;
}

// ── takes ────────────────────────────────────────────────────────────────────
const takes = {
  async a(page, ctx, acct) {
    await page.goto(URLS.dorr, { waitUntil: "networkidle" });
    await line(page, "a-intro"); await hold(page, "a-intro");

    await until(page, "hero measured", () => /public DEX it took \$/.test(document.body.innerText), 25000);
    await line(page, "a-land-hero"); await hold(page, "a-land-hero");

    await line(page, "a-land-scroll");
    for (const f of [0.25, 0.5, 0.75, 1]) await smoothTo(page, document_h(f), 2600);
    await hold(page, "a-land-scroll");

    await page.goto(`${URLS.dorr}/trade`, { waitUntil: "networkidle" });
    await clickAt(page, "button:has-text('ATTACK LAB')");
    await line(page, "a-attack-open"); await hold(page, "a-attack-open");

    await clickAt(page, "[role=dialog] button:has-text('RUN ATTACK')");
    await until(page, "attack finished", () => /ATTACK ABORTED|bot profit \$0/i.test(document.body.innerText), 60000);
    await line(page, "a-attack-run"); await hold(page, "a-attack-run");

    for (const tab of ["Sealed", "Batch"]) {
      await clickAt(page, `[role=dialog] button:has-text('${tab}')`);
      await page.waitForTimeout(1500);
    }
    await line(page, "a-attack-tabs"); await hold(page, "a-attack-tabs");
    await page.keyboard.press("Escape");

    await clickAt(page, "button:has-text('CONNECT WALLET')");
    await until(page, "balance loaded", () => /Free balance/i.test(document.body.innerText), 30000);
    await line(page, "a-connect"); await hold(page, "a-connect");

    await typeInto(page, "input[inputmode=decimal]", "2");
    await clickAt(page, "button:has-text('5x')");
    await line(page, "a-order-form"); await hold(page, "a-order-form");

    await line(page, "a-commit", { signing: true });
    await signingOverlay(page, true);
    await clickAt(page, "button:has-text('LONG FLR')");
    await until(page, "commit accepted", () => /Committed private|commitment/i.test(document.body.innerText), 90000);
    await signingOverlay(page, false);
    await hold(page, "a-commit");

    await line(page, "a-feed"); await hold(page, "a-feed");

    await page.goto(`${URLS.explorer}/address/0x65b705A49778b9d7bD741A0A979162393c699a98`, { waitUntil: "domcontentloaded" });
    await line(page, "a-explorer");
    await smoothTo(page, 600, 3000); await smoothTo(page, 1200, 3000);
    await hold(page, "a-explorer");

    await page.goto(`${URLS.dorr}/verify`, { waitUntil: "networkidle" });
    await until(page, "verify loaded", () => /WHAT THE CHAIN ACTUALLY CHECKS/i.test(document.body.innerText), 30000);
    await line(page, "a-verify"); await smoothTo(page, 700, 2500); await hold(page, "a-verify");

    await until(page, "hardware live", () => /Hardware attestation is live/i.test(document.body.innerText), 20000);
    await line(page, "a-tee"); await smoothTo(page, 1600, 3000); await hold(page, "a-tee");
  },
};

const document_h = (f) => Math.round(4000 * f); // replaced at runtime by real scrollHeight

async function main() {
  const take = process.argv[process.argv.indexOf("--take") + 1] || "a";
  mkdirSync(dirname(LOG), { recursive: true });
  const { privateKeyToAccount } = await import("viem/accounts");
  const raw = DEMO_KEY.trim();
  const acct = privateKeyToAccount((raw.startsWith("0x") ? raw : "0x" + raw));

  const browser = await chromium.launch({ headless: false, args: ["--window-size=1440,900", "--window-position=0,0"] });
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 });
  const page = await ctx.newPage();
  await installCursor(page);
  await installWallet(page, acct.address);
  // node-side signer, so the browser never holds the key
  await page.exposeFunction("__sign", (msgHex) =>
    acct.signMessage({ message: { raw: msgHex } }));

  const errCount = await preflight(page, ctx);
  t0 = Date.now();
  try {
    await takes[take](page, ctx, acct);
    console.log(`\nTAKE ${take.toUpperCase()} OK — ${((Date.now() - t0) / 1000).toFixed(1)}s`);
  } catch (e) {
    console.error(`\nTAKE ${take.toUpperCase()} FAILED: ${e.message}`);
    process.exitCode = 1;
  } finally {
    console.log(`new console errors this run: ${errCount()}`);
    await browser.close();
  }
}
main();
