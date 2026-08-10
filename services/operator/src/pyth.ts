import { env } from "./env.js";
import { MARKETS } from "./markets.js";

export interface PythPrice {
  feedId: string;
  price: number;
  conf: number;
  publishTime: number;
  fetchedAt: number;
}

const latest = new Map<string, PythPrice>();
const disabledFeeds = new Set<string>();

function parseV2(parsed: Array<{ id: string; price: { price: string; conf: string; expo: number; publish_time: number } }>): void {
  for (const p of parsed) {
    const expo = p.price.expo;
    const price = Number(p.price.price) * Math.pow(10, expo);
    const conf = Number(p.price.conf) * Math.pow(10, expo);
    latest.set(p.id.replace(/^0x/, ""), {
      feedId: p.id.replace(/^0x/, ""),
      price,
      conf,
      publishTime: p.price.publish_time,
      fetchedAt: Date.now(),
    });
  }
}

export async function pollOnce(): Promise<void> {
  const ids = MARKETS.filter((m) => !disabledFeeds.has(m.pythFeedId)).map((m) => m.pythFeedId);
  if (ids.length === 0) return;
  const qs = ids.map((id) => `ids[]=0x${id}`).join("&");
  const url = `${env.pyth.hermesUrl}/v2/updates/price/latest?${qs}&parsed=true`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Hermes ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const body = (await res.json()) as { parsed?: Parameters<typeof parseV2>[0] };
  if (body.parsed) parseV2(body.parsed);
}

/** Validate every configured feed against Hermes at boot; disable (never misprice) failures. */
export async function validateFeeds(): Promise<void> {
  for (const m of MARKETS) {
    const url = `${env.pyth.hermesUrl}/v2/updates/price/latest?ids[]=0x${m.pythFeedId}&parsed=true`;
    try {
      const res = await fetch(url);
      if (!res.ok) throw new Error(`status ${res.status}`);
      const body = (await res.json()) as { parsed?: Parameters<typeof parseV2>[0] };
      if (!body.parsed?.length) throw new Error("no parsed payload");
      parseV2(body.parsed);
      const p = latest.get(m.pythFeedId)!;
      console.log(`[pyth] ${m.symbol} feed ok — $${p.price.toFixed(6)}`);
    } catch (e) {
      disabledFeeds.add(m.pythFeedId);
      console.error(`[pyth] FEED FAILED for ${m.symbol} (${m.pythFeedId}): ${String(e)} — market disabled`);
    }
  }
}

export function getPrice(feedId: string): PythPrice | undefined {
  return latest.get(feedId.replace(/^0x/, ""));
}

/** TEST-ONLY: inject a fresh price without hitting Hermes (deterministic tests). */
export function _setPriceForTest(feedId: string, price: number): void {
  const id = feedId.replace(/^0x/, "");
  latest.set(id, { feedId: id, price, conf: 0, publishTime: 0, fetchedAt: Date.now() });
}

export function isFeedDisabled(feedId: string): boolean {
  return disabledFeeds.has(feedId.replace(/^0x/, ""));
}

export function startPricePolling(): void {
  const tick = () =>
    pollOnce().catch((e) => console.error(`[pyth] poll error: ${String(e).slice(0, 200)}`));
  tick();
  setInterval(tick, env.pyth.pollMs);
}
