/**
 * The privacy boundary, made explicit and testable.
 *
 * `publicFeedView` is the ONLY projection of an order that ever becomes public.
 * For a private order it exposes nothing but the market and the 32-byte
 * commitment hash — so a mempool observer / MEV bot learns neither the side,
 * size, leverage, price, nor trader. Public mode (the A/B foil) deliberately
 * leaks everything. This function is the single source of truth for both, and
 * is pinned by privacy tests.
 */
import type { FeedEntry, PrivacyMode, Side } from "./state.js";

export interface OrderPublicInput {
  marketId: string;
  privacyMode: PrivacyMode;
  commitmentHash: string;
  createdAt: string;
  side: Side;
  sizeBase: number;
  leverage: number;
  address: string;
}

/** The public projection. Private → hash only. Public → full leak (demo foil). */
export function publicFeedView(o: OrderPublicInput): FeedEntry {
  const base: FeedEntry = {
    at: o.createdAt,
    marketId: o.marketId,
    privacyMode: o.privacyMode,
    commitmentHash: o.commitmentHash,
  };
  if (o.privacyMode === "public") {
    base.leaked = { side: o.side, sizeBase: o.sizeBase, leverage: o.leverage, address: o.address };
  }
  return base;
}

/**
 * Does this public view leak any of the sensitive order values? Used by tests
 * and as a runtime assertion. Given the private order's own secret values,
 * confirms none of them appear anywhere in the serialized public view.
 */
const PUBLIC_KEYS = new Set(["at", "marketId", "privacyMode", "commitmentHash"]);

export function leaksSensitiveData(
  view: FeedEntry,
  secret: { side: Side; sizeBase: number; leverage: number; price: number; address: string; nonce: string },
): boolean {
  if (view.privacyMode === "public") return true; // intentional foil
  // Structural: a private view may carry ONLY the safe keys. Any extra key
  // (e.g. `leaked`) is a leak. The commitment hash is safe (preimage-resistant),
  // the market and timestamp are public by design.
  if (Object.keys(view).some((k) => !PUBLIC_KEYS.has(k))) return true;
  // Belt-and-suspenders: distinctive high-entropy secret tokens must not appear
  // anywhere in the view outside the (safe) commitment hash. Short values like a
  // single-digit leverage or "LONG" are covered by the structural check above;
  // matching them by substring against a hex hash yields false positives.
  const scan = JSON.stringify({ ...view, commitmentHash: undefined });
  const strong = [secret.address, secret.nonce, secret.sizeBase.toFixed(8), secret.price.toFixed(8)];
  return strong.some((n) => n.length >= 6 && scan.includes(n));
}
