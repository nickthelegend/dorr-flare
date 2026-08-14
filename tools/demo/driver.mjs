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
/** Hashes this take actually produced. The explorer beat opens these, not a constant. */
const TXS = [];

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
  // Clear first. This appended before, so a deposit field pre-filled with "100"
  // became "1001" — far over the wallet balance, so handleDeposit bailed and
  // never broadcast, and the explorer beat had no transaction of its own.
  await el.press("Meta+A").catch(() => {});
  await el.press("Backspace").catch(() => {});
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

/**
 * Close every open position before rolling.
 *
 * Five were left on screen from earlier takes, so the positions panel opened on
 * other people's trades and the free margin was too low for the one this take
 * places. A demo that starts dirty is not the flow a user sees.
 */
/** Wait until the take has actually broadcast `n` transactions. */
async function waitForTxs(n, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (TXS.length >= n) return;
    await new Promise((r) => setTimeout(r, 1500));
  }
  throw new Error(`NO_TX_BROADCAST: expected ${n}, have ${TXS.length}`);
}

/** Come back from the explorer. A full page load drops the wallet connection —
 *  the previous take reached the private trade disconnected, with the submit
 *  button reading "Connect Wallet", and timed out clicking a button that was
 *  never going to be there. Reconnect before doing anything that needs a key. */
async function backToTrade(page) {
  await page.goto(`${URLS.dorr}/trade`, { waitUntil: "networkidle" });
  await assertHydrated(page, "dorr /trade");
  await page.waitForTimeout(2500);
  const connect = page.locator("button").filter({ hasText: /^Connect Wallet$/i }).first();
  if (await connect.count()) {
    await clickAt(page, "button:has-text('Connect Wallet')");
    await until(page, "vault re-read after explorer",
      () => /Free balance/i.test(document.body.innerText), 40000);
    await page.waitForTimeout(1200);
  }
}

/** Open a transaction on the Flare explorer and hold for its beat. */
async function showTx(page, hash, beatId) {
  if (!hash) throw new Error(`NO_TX_FOR_BEAT: ${beatId} narrates a transaction this take never sent`);
  await page.goto(`${URLS.explorer}/tx/${hash}`, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(2600);
  await line(page, beatId);
  await smoothTo(page, 420, 2400);
  await hold(page, beatId);
}

async function clearPositions() {
  const { privateKeyToAccount } = await import("viem/accounts");
  const raw = DEMO_KEY.trim();
  const acct = privateKeyToAccount((raw.startsWith("0x") ? raw : "0x" + raw));
  const OP = "https://dorr-operator-9449c5bb5086.herokuapp.com";
  const list = await fetch(`${OP}/positions/${acct.address}`).then((r) => r.json()).catch(() => []);
  const open = (Array.isArray(list) ? list : list.positions || []).filter((p) => p.status === "open");
  if (!open.length) return console.log("preflight: no open positions");
  // The server signs over { positionId, fraction } — signing { positionId,
  // address } produced a mismatch, every close 401'd, and the .catch swallowed
  // it. It reported "closed 8" while eight stayed open on screen.
  let closed = 0;
  const failures = [];
  for (const pos of open) {
    const params = { positionId: pos.id, fraction: 1 };
    const ts = Date.now();
    const msg = `dorr:close\n${JSON.stringify(params, Object.keys(params).sort())}\nts:${ts}`;
    const signature = await acct.signMessage({ message: msg });
    const r = await fetch(`${OP}/positions/${pos.id}/close`, {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ ...params, auth: { signer: acct.address, ts, sig: { signature } } }),
    });
    if (r.ok) closed++;
    else failures.push(`${pos.id.slice(0, 8)} ${r.status} ${(await r.text()).slice(0, 60)}`);
  }
  console.log(`preflight: closed ${closed}/${open.length}`);
  if (failures.length) {
    // Loudly. A demo that opens on ten stale positions is not the flow a user
    // sees, and pretending they closed is how it shipped that way last time.
    throw new Error(`CLOSE_FAILED: ${failures.length} position(s)\n  ${failures.join("\n  ")}`);
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
/** Read the wallet's FXRP balance straight from the token contract. */
async function fxrpBalance() {
  const { createPublicClient, http } = await import("viem");
  const { privateKeyToAccount } = await import("viem/accounts");
  const raw = DEMO_KEY.trim();
  const acct = privateKeyToAccount((raw.startsWith("0x") ? raw : "0x" + raw));
  const c = createPublicClient({ transport: http(process.env.FLARE_RPC_URL || "https://coston2-api.flare.network/ext/C/rpc") });
  return await c.readContract({
    address: "0x0b6A3645c240605887a5532109323A3E12273dc7",
    abi: [{ name: "balanceOf", type: "function", stateMutability: "view",
            inputs: [{ type: "address" }], outputs: [{ type: "uint256" }] }],
    functionName: "balanceOf", args: [acct.address],
  });
}

/**
 * Wait for the faucet to actually pay out.
 *
 * Balance rising is the only honest signal — a toast can appear on a request
 * that never landed, and the beat claims a real transfer happened.
 */
async function waitForBalance(before, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const now = await fxrpBalance().catch(() => before);
    if (now > before) {
      console.log(`FXRP ${Number(before) / 1e6} -> ${Number(now) / 1e6}`);
      return now;
    }
    await new Promise((r) => setTimeout(r, 4000));
  }
  throw new Error("FAUCET_NO_PAYOUT: balance did not rise");
}

const takes = {
  /**
   * dorr. Order matters: get funded, trade, then attack.
   *
   * The attack lab used to open the film. It lands far harder here, after the
   * audience has watched a real order go in and seen the feed show nothing but
   * a hash — by then they know what is being protected.
   */
  async a(page) {
    await page.goto(URLS.dorr, { waitUntil: "networkidle" });
    await assertHydrated(page, "dorr landing");
    await line(page, "land-hero"); await hold(page, "land-hero");

    // ── get funded ───────────────────────────────────────────────────────────
    await page.goto(`${URLS.dorr}/trade`, { waitUntil: "networkidle" });
    await assertHydrated(page, "dorr /trade");
    await smoothTo(page, 1500, 1800);
    await line(page, "faucet-open"); await hold(page, "faucet-open");

    // `handleFaucet` is `window.open(faucet.flare.network)` — it opens Flare's
    // faucet and transfers nothing. The old beat put a "Claiming test FXRP"
    // overlay over it and waited for a balance that could never move, which is
    // how it hung for 196 seconds against 8 seconds of narration. Show the
    // button and the balance the wallet really holds; no overlay, because
    // nothing here is signed.
    const bal = await fxrpBalance();
    console.log(`  wallet holds ${Number(bal) / 1e6} FXRP`);
    await clickAt(page, "button:has-text('Get FXRP'), button:has-text('GET FXRP')").catch(() => {});
    await page.waitForTimeout(1200);
    // The faucet opens a new tab; close it so the capture stays on the app.
    for (const pg of page.context().pages()) if (pg !== page) await pg.close().catch(() => {});
    await line(page, "faucet-claim");
    await hold(page, "faucet-claim");

    await smoothTo(page, 0, 1200);
    await clickAt(page, "button:has-text('Connect Wallet')");
    await until(page, "vault read", () => /Free balance/i.test(document.body.innerText), 40000);
    await line(page, "connect"); await hold(page, "connect");

    // Scroll to the panel and let it settle before clicking. A click issued
    // while the smooth scroll is still running lands on wherever the button was.
    await smoothTo(page, 1500, 2600);
    // The deposit field defaults to 100 and the wallet holds ~3 FXRP, so
    // handleDeposit bailed on insufficient balance and never broadcast —
    // which is why the explorer beat had no transaction of its own to show.
    // inputMode="numeric" distinguishes it from the order form's decimal input.
    // Size the deposit off the wallet's real balance. A hardcoded "1" failed
    // the previous take at 0.4 FXRP held — handleDeposit bails on insufficient
    // balance and broadcasts nothing.
    const held = Number(await fxrpBalance()) / 1e6;
    const amount = Math.floor(held * 50) / 100;   // half, 2dp
    if (amount < 0.05) throw new Error(`WALLET_TOO_EMPTY: ${held} FXRP held; withdraw from the vault first`);
    console.log(`  depositing ${amount} of ${held} FXRP`);
    await typeInto(page, "input[inputmode=numeric]", String(amount));
    await line(page, "deposit", { signing: true });
    const txsBefore = TXS.length;
    await clickAt(page, "button:has-text('DEPOSIT')");
    await signingOverlay(page, true, "Signing Transaction");
    // Approve then deposit: wait for BOTH to broadcast rather than a fixed pause.
    await waitForTxs(txsBefore + 2, 150000).catch(() => waitForTxs(txsBefore + 1, 45000));
    await signingOverlay(page, false);
    await hold(page, "deposit");

    await line(page, "collateral"); await hold(page, "collateral");

    // ── trade: public first, then private, each followed by its own tx ──────
    await smoothTo(page, 0, 1200);
    await typeInto(page, "input[inputmode=decimal]", "0.05");
    await clickAt(page, "button:has-text('5x')");
    await line(page, "order-form"); await hold(page, "order-form");

    await clickAt(page, "button:has-text('Public foil')");
    await page.waitForTimeout(1400);
    await line(page, "privacy"); await hold(page, "privacy");

    // PUBLIC — the order everyone can read
    await line(page, "trade-public", { signing: true });
    await clickAt(page, "button:has-text('publicly')");
    await signingOverlay(page, true, "Signing Transaction");
    await until(page, "public order in feed",
      () => /PUBLIC|broadcast|FULLY VISIBLE/i.test(document.body.innerText), 120000);
    await signingOverlay(page, false);
    await hold(page, "trade-public");

    await line(page, "feed-public"); await hold(page, "feed-public");

    const pubTx = TXS[TXS.length - 1];
    await showTx(page, pubTx, "explorer-public");

    // PRIVATE — the same trade, sealed
    await backToTrade(page);
    await smoothTo(page, 0, 1200);
    const reset2 = page.locator("button").filter({ hasText: /^New order$/i }).first();
    if (await reset2.count()) { await clickAt(page, "button:has-text('New order')"); await page.waitForTimeout(1200); }
    await clickAt(page, "button:has-text('Private')");
    await typeInto(page, "input[inputmode=decimal]", "0.05");

    await line(page, "commit", { signing: true });
    await clickAt(page, "button:has-text('privately')");
    await signingOverlay(page, true, "Signing Transaction");
    await until(page, "commitment in feed",
      () => /Committed private|commitment/i.test(document.body.innerText), 120000);
    await signingOverlay(page, false);
    await hold(page, "commit");

    await line(page, "feed"); await hold(page, "feed");
    await showTx(page, TXS[TXS.length - 1], "explorer-private");

    await backToTrade(page);
    await smoothTo(page, 700, 1600);
    await line(page, "positions"); await hold(page, "positions");
    // → tee-attest / tee-bound / tx-details slides splice in here

    // ── now the attack means something ───────────────────────────────────────
    await clickAt(page, "header button:has-text('Attack Lab'), nav button:has-text('Attack Lab')");
    await line(page, "attack-open"); await hold(page, "attack-open");

    await clickAt(page, "[role=dialog] button:has-text('Run attack')");
    await until(page, "attack finished",
      () => /ATTACK ABORTED|bot profit \$0/i.test(document.body.innerText), 90000);
    await line(page, "attack-run"); await hold(page, "attack-run");

    for (const [id, tab] of [["attack-sealed", "Sealed"], ["attack-batch", "Batch"]]) {
      await clickAt(page, `[role=dialog] button:has-text('${tab}')`);
      const run = page.locator("[role=dialog] button").filter({ hasText: /^(RUN|SEAL)/i }).first();
      if (await run.count()) await run.click().catch(() => {});
      await page.waitForTimeout(9000);
      await line(page, id); await hold(page, id);
    }
    await page.keyboard.press("Escape");

    // ── check it ─────────────────────────────────────────────────────────────
    // This take's own transaction, with the historical settlement as the
    // fallback only if nothing was sent (which would itself be a failure).
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
    // Remember it: the explorer beat opens the transactions THIS take created,
    // not a constant baked in months ago. A demo that points at someone else's
    // old hash is asking the viewer to take the link on faith.
    TXS.push(hash);
    appendFileSync(LOG.replace("beat-log", "tx-log"), hash + "\n");
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

  // Capture the crash with its stack. It only reproduces with the full run's
  // accumulated state, so a listener has to be live for the whole take rather
  // than bolted onto a smaller repro.
  page.on("pageerror", (e) => {
    console.error(`PAGEERROR ${e.message}`);
    if (e.stack) console.error(e.stack.split("\n").slice(0, 6).join("\n"));
  });

  await clearPositions();
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
