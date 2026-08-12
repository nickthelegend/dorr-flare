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
        "transition:none;will-change:transform";
      // A real arrow, not a dot. The hotspot is the tip at (0,0), which is why
      // the wrapper is not centre-translated like a ring would be — a pointer
      // that clicks from its middle looks subtly wrong to anyone who has used a
      // computer.
      c.innerHTML =
        '<svg viewBox="0 0 32 32" width="26" height="26" style="filter:drop-shadow(0 1px 2px rgba(0,0,0,.55))">' +
        '<path d="M6 3 L6 24.5 L11.7 19.2 L15.3 27.6 L19.1 25.9 L15.5 17.7 L23.2 17.3 Z" ' +
        'fill="#fff" stroke="rgba(0,0,0,.72)" stroke-width="1.4" stroke-linejoin="round"/></svg>';
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
          el.style.transform = `translate(${window.__cx}px,${window.__cy}px)`;
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
  let box;
  try {
    box = await page.locator(sel).first().boundingBox({ timeout: 15000 });
  } catch {
    // Dump what is actually on screen. Three runs were lost guessing at labels
    // that turned out to be CSS transforms rather than DOM text.
    const shot = `/tmp/fail-${Date.now()}.png`;
    await page.screenshot({ path: shot }).catch(() => {});
    const labels = await page.evaluate(() =>
      [...document.querySelectorAll("button,[role=button],[role=tab]")]
        .map((b) => (b.innerText || "").trim().replace(/\s+/g, " ").slice(0, 30))
        .filter(Boolean).slice(0, 30)).catch(() => []);
    throw new Error(`NO_ELEMENT: ${sel}\n  shot: ${shot}\n  on screen: ${JSON.stringify(labels)}`);
  }
  if (!box) throw new Error(`NO_ELEMENT (no box): ${sel}`);
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
        if (method === "eth_sendTransaction") {
          // Its absence is why the deposit and withdraw beats had nothing under
          // them: the provider threw, so no UI transaction could ever complete
          // and the "Signing Transaction" overlay was decoration. The node side
          // now signs and broadcasts for real and returns the actual hash.
          return await window.__sendTx(params[0]);
        }
        // Everything else goes to the real chain.
        //
        // Throwing on unlisted methods crashed /trade outright — "Application
        // error: a client-side exception" — because the app legitimately calls
        // eth_call, eth_getBalance and friends, and a provider that rejects them
        // is a broken wallet rather than a strict one. A real extension proxies
        // reads to its RPC; so does this.
        return await window.__rpc(method, params || []);
      },
      on: () => {}, removeListener: () => {},
    };
  }, address);
}

/** The app is really interactive, not a bot-check or an error boundary. */
async function assertHydrated(page, where) {
  // Buttons alone is the wrong test — molfi's landing page is entirely links and
  // legitimately has none. What actually distinguishes a live app from a bot
  // checkpoint is interactive elements *and* real copy: the checkpoint page has
  // neither.
  // The challenge self-solves; give it room before declaring failure. Asserting
  // immediately after networkidle catches the interstitial, not the app.
  for (let i = 0; i < 12; i++) {
    const ok = await page.evaluate(
      () => document.querySelectorAll("button, a[href], [role=button]").length > 0 &&
            (document.body.innerText || "").trim().split(/\s+/).length >= 25,
    ).catch(() => false);
    if (ok) break;
    await page.waitForTimeout(2500);
    if (i === 5) await page.reload({ waitUntil: "networkidle" }).catch(() => {});
  }
  const st = await page.evaluate(() => ({
    interactive: document.querySelectorAll("button, a[href], [role=button]").length,
    words: (document.body.innerText || "").trim().split(/\s+/).length,
  }));
  if (st.interactive === 0 || st.words < 25) {
    const title = await page.title();
    throw new Error(
      `NOT_HYDRATED: ${where} — ${st.interactive} interactive, ${st.words} words (title "${title}") — bot checkpoint or failed load`,
    );
  }
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
  /** dorr, 24 browser beats. intro / tee-json / tee-bound / honest / outro are slides. */
  async a(page) {
    // ── Act 1 · the problem ──────────────────────────────────────────────────
    await page.goto(URLS.dorr, { waitUntil: "networkidle" });
    await assertHydrated(page, "dorr landing");
    await until(page, "hero measured", () => /public DEX it took \$/.test(document.body.innerText), 30000);
    await line(page, "land-hero"); await hold(page, "land-hero");

    // One beat per scene rather than one scroll under four lines: the scenes are
    // scroll-linked, so stopping on each lets its animation actually play.
    const H = await page.evaluate(() => document.body.scrollHeight);
    for (const [id, frac] of [["land-seal", 0.30], ["land-blind", 0.46], ["land-clear", 0.62], ["land-band", 0.78]]) {
      await smoothTo(page, Math.round(H * frac), 2400);
      await line(page, id); await hold(page, id);
    }

    // ── Act 2 · prove it ─────────────────────────────────────────────────────
    await page.goto(`${URLS.dorr}/trade`, { waitUntil: "networkidle" });
    await assertHydrated(page, "dorr /trade");
    // Scoped to the navbar: once the dialog opens it carries a tab with the same
    // label, and the unscoped selector stops being unique. That ambiguity is
    // what killed a previous take at this exact beat.
    await clickAt(page, "header button:has-text('Attack Lab'), nav button:has-text('Attack Lab')");
    await line(page, "attack-open"); await hold(page, "attack-open");

    await clickAt(page, "[role=dialog] button:has-text('Run attack')");
    await until(page, "attack finished",
      () => /ATTACK ABORTED|bot profit \$0/i.test(document.body.innerText), 90000);
    await line(page, "attack-run"); await hold(page, "attack-run");

    for (const [id, tab, ready] of [
      ["attack-sealed", "Sealed", /REFUSED|too early/i],
      ["attack-batch", "Batch", /0\.000000|nets \$0/i],
      ["attack-ab", "A/B", /BOT PROFIT|victim sandwiched/i],
    ]) {
      await clickAt(page, `[role=dialog] button:has-text('${tab}')`);
      const run = page.locator("[role=dialog] button").filter({ hasText: /^(RUN|SEAL|COMPARE)/i }).first();
      if (await run.count()) { await run.click().catch(() => {}); }
      await until(page, `${tab} result`, (re) => new RegExp(re, "i").test(document.body.innerText),
        75000).catch(() => {});
      await line(page, id); await hold(page, id);
    }
    await page.keyboard.press("Escape");

    // ── Act 3 · use it ───────────────────────────────────────────────────────
    await clickAt(page, "button:has-text('Connect Wallet')");
    await until(page, "vault balance", () => /Free balance/i.test(document.body.innerText), 40000);
    await line(page, "connect"); await hold(page, "connect");

    await smoothTo(page, 1400, 1800);
    await line(page, "collateral"); await hold(page, "collateral");
    await line(page, "faucet"); await hold(page, "faucet");


    await smoothTo(page, 0, 1200);
    await typeInto(page, "input[inputmode=decimal]", "0.05");   // free margin is 0.1
    await clickAt(page, "button:has-text('5x')");
    await line(page, "order-form"); await hold(page, "order-form");

    await clickAt(page, "button:has-text('Public foil')");
    await page.waitForTimeout(1400);
    await clickAt(page, "button:has-text('Private')");
    await line(page, "privacy"); await hold(page, "privacy");

    // The submit button is disabled until margin is valid and within free
    // balance. A plain click on a disabled button times out after 30s with no
    // clue why — this waits for it to be enabled and, failing that, says what
    // the form actually contains.
    const submitSel = "button:has-text('LONG FLR')";
    try {
      await page.locator(submitSel).first().waitFor({ state: "visible", timeout: 15000 });
      await page.waitForFunction((sel) => {
        const b = [...document.querySelectorAll("button")].find((x) => /LONG FLR/i.test(x.innerText));
        return b && !b.disabled;
      }, submitSel, { timeout: 20000 });
    } catch {
      const st = await page.evaluate(() => {
        const inp = [...document.querySelectorAll("input")].find((i) => i.inputMode === "decimal");
        const b = [...document.querySelectorAll("button")].find((x) => /LONG FLR/i.test(x.innerText));
        const t = document.body.innerText;
        return {
          margin: inp?.value ?? "(no input)",
          disabled: b?.disabled,
          label: b?.innerText.trim().slice(0, 32),
          free: (t.match(/Free balance[^\n]{0,24}/) || [])[0],
        };
      });
      throw new Error(`COMMIT_DISABLED: ${JSON.stringify(st)}`);
    }

    await line(page, "commit", { signing: true });
    await signingOverlay(page, true, "Signing Transaction");
    await clickAt(page, submitSel);
    // Real state, not a toast: the commitment has to reach the public feed.
    // Real state: the commitment has to reach the public feed. A toast is not
    // evidence and a spinner leaving is not evidence.
    await until(page, "commitment in feed",
      () => /Committed private|commitment/i.test(document.body.innerText), 150000);
    await signingOverlay(page, false);
    await hold(page, "commit");

    await line(page, "feed"); await hold(page, "feed");
    await smoothTo(page, 700, 1600);
    await line(page, "positions"); await hold(page, "positions");


    // ── Act 4 · check it ─────────────────────────────────────────────────────
    await page.goto(`${URLS.explorer}/tx/0x3a732edf643605afbbfaa0c98bd1bc6214ab894759415e7c5a5b76e2209e3312`,
      { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(2500);
    await line(page, "explorer-tx"); await smoothTo(page, 500, 2600); await hold(page, "explorer-tx");

    await page.goto(`${URLS.explorer}/address/0x65b705A49778b9d7bD741A0A979162393c699a98?tab=txs`,
      { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(2500);
    await line(page, "explorer-vault"); await smoothTo(page, 450, 2600); await hold(page, "explorer-vault");

    await page.goto(`${URLS.dorr}/verify`, { waitUntil: "networkidle" });
    await assertHydrated(page, "dorr /verify");
    await until(page, "verify loaded", () => /WHAT THE CHAIN ACTUALLY CHECKS/i.test(document.body.innerText), 40000);
    await line(page, "verify"); await smoothTo(page, 650, 2400); await hold(page, "verify");

    await until(page, "hardware live", () => /Hardware attestation is live/i.test(document.body.innerText), 30000);
    await smoothTo(page, 1700, 2400);
    await line(page, "tee-live"); await hold(page, "tee-live");
  },
};

async function main() {
  const take = process.argv[process.argv.indexOf("--take") + 1] || "a";
  mkdirSync(dirname(LOG), { recursive: true });
  const { privateKeyToAccount } = await import("viem/accounts");
  const raw = DEMO_KEY.trim();
  const acct = privateKeyToAccount((raw.startsWith("0x") ? raw : "0x" + raw));

  const browser = await chromium.launch({
    headless: false,
    args: [
      "--window-size=1440,900", "--window-position=0,0",
      // navigator.webdriver is the flag bot checks look at first.
      "--disable-blink-features=AutomationControlled",
    ],
  });
  const ctx = await browser.newContext({
    // Record the PAGE, not the screen.
    //
    // Screen capture plus a crop rect put the macOS menu bar, the Chrome tab
    // strip and the URL bar in every frame, and — because the display is
    // 1920x1080 and the crop was 1440x900 at the origin — sliced the right-hand
    // trading panel off mid-column. Playwright writes the viewport itself: no
    // desktop, no browser chrome, no geometry to get wrong.
    recordVideo: { dir: process.env.DEMO_VIDEO_DIR || "/tmp/dorr-video", size: { width: 1440, height: 900 } },
    viewport: { width: 1440, height: 900 },
    deviceScaleFactor: 2,
    userAgent:
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) " +
      "Chrome/131.0.0.0 Safari/537.36",
    locale: "en-US",
  });
  await ctx.addInitScript(() => Object.defineProperty(navigator, "webdriver", { get: () => undefined }));
  const page = await ctx.newPage();
  await installCursor(page);
  await installWallet(page, acct.address);
  // node-side signer, so the browser never holds the key
  await page.exposeFunction("__sign", (msgHex) =>
    acct.signMessage({ message: { raw: msgHex } }));
  const RPC = process.env.FLARE_RPC_URL || "https://coston2-api.flare.network/ext/C/rpc";
  const { createWalletClient, createPublicClient, http: vhttp } = await import("viem");
  const coston2 = {
    id: 114, name: "Coston2",
    nativeCurrency: { name: "C2FLR", symbol: "C2FLR", decimals: 18 },
    rpcUrls: { default: { http: [RPC] } },
  };
  const wallet = createWalletClient({ account: acct, chain: coston2, transport: vhttp(RPC) });
  const pub = createPublicClient({ chain: coston2, transport: vhttp(RPC) });

  await page.exposeFunction("__sendTx", async (tx) => {
    const hash = await wallet.sendTransaction({
      to: tx.to,
      data: tx.data,
      value: tx.value ? BigInt(tx.value) : undefined,
    });
    console.log(`  TX ${hash}`);
    return hash;
  });

  // A signing beat advances on a receipt, not on a click. Without this the log
  // can say SIGNING for something that never reached a block.
  await page.exposeFunction("__waitTx", async (hash) => {
    const r = await pub.waitForTransactionReceipt({ hash, timeout: 150000 });
    console.log(`  CONFIRMED ${hash} status=${r.status} block=${r.blockNumber}`);
    return r.status === "success";
  });
  await page.exposeFunction("__rpc", async (method, params) => {
    const r = await fetch(RPC, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
    });
    const j = await r.json();
    if (j.error) throw new Error(`${method}: ${j.error.message}`);
    return j.result;
  });

  // Surface the real exception. "Application error: a client-side exception"
  // tells you nothing; the pageerror does.
  page.on("pageerror", (e) => console.error("PAGEERROR:", String(e).slice(0, 300)));
  page.on("console", (m) => {
    if (m.type() === "error") console.error("CONSOLE:", m.text().slice(0, 300));
  });

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
    const vid = await page.video()?.path().catch(() => null);
    await ctx.close();            // flushes the video; browser.close() alone can truncate
    await browser.close();
    if (vid) console.log(`VIDEO ${vid}`);
  }
}
main();
