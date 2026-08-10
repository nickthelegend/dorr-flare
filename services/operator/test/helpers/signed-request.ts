import { privateKeyToAccount, type PrivateKeyAccount } from "viem/accounts";

/**
 * Request signing for the integration suite.
 *
 * The operator requires an EIP-191 signature on every value-moving call, so the
 * tests have to produce a real one — the same envelope `apps/web/lib/operator.ts`
 * builds in the browser. Signing here rather than disabling auth for tests means
 * the suite covers the production path: message construction, secp256k1
 * recovery, freshness and the signer-vs-acting-address binding.
 *
 * The action name and the exact params each route signs over are defined by
 * `routes.ts`; ROUTES below mirrors that table. A path with no entry (a read, or
 * a test-only admin route) is sent unsigned.
 */

/** Deterministic anvil-style test keys — never funded, never used off-test. */
const KEYS = [
  "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80",
  "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d",
  "0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a",
  "0x7c852118294e51e653712a81e05800f419141751be58f605c371e15141b007a6",
] as const;

/** A deterministic test trader: index 0..3, stable across runs. */
export function testTrader(i: number): PrivateKeyAccount {
  return privateKeyToAccount(KEYS[i % KEYS.length]!);
}

/** Byte-identical to `src/auth.ts:authMessage` and the browser client. */
export function authMessage(action: string, params: Record<string, unknown>, ts: number): string {
  return `dorr:${action}\n${JSON.stringify(params, Object.keys(params).sort())}\nts:${ts}`;
}

type Signed = { action: string; params: Record<string, unknown> } | null;

/** Which action + params each value-moving route signs over (mirrors routes.ts). */
function routeFor(path: string, body: Record<string, unknown>): Signed {
  const p = path.split("?")[0]!;
  const seg = p.split("/").filter(Boolean);

  if (p === "/orders/commit") {
    return {
      action: "commit",
      params: {
        address: String(body.address ?? ""),
        marketId: String(body.marketId ?? ""),
        side: body.side === "SHORT" ? "SHORT" : "LONG",
        marginUsd: Number(body.marginUsd ?? 0),
        leverage: Number(body.leverage ?? 1),
        privacyMode: body.privacyMode === "public" ? "public" : "private",
        orderType: body.orderType === "limit" ? "limit" : "market",
        ...(body.limitPrice != null ? { limitPrice: Number(body.limitPrice) } : {}),
        ...(body.maxSlippageBps != null ? { maxSlippageBps: Number(body.maxSlippageBps) } : {}),
      },
    };
  }
  if (p === "/orders/seal") {
    return {
      action: "seal",
      params: { commitment: String(body.commitment ?? ""), targetRound: Number(body.targetRound ?? 0) },
    };
  }
  if (p === "/disclose") {
    return {
      action: "disclose",
      params: { orderId: String(body.orderId ?? ""), audience: String(body.audience ?? "auditor") },
    };
  }
  // /orders/:id/{execute,cancel,anchor-commit}
  if (seg[0] === "orders" && seg.length === 3) {
    const action = seg[2]!;
    if (["execute", "cancel", "anchor-commit"].includes(action)) {
      return { action, params: { orderId: decodeURIComponent(seg[1]!) } };
    }
  }
  // /positions/:id/{close,margin,stops}
  if (seg[0] === "positions" && seg.length === 3) {
    const positionId = decodeURIComponent(seg[1]!);
    if (seg[2] === "close") {
      return {
        action: "close",
        params: { positionId, fraction: body.fraction != null ? Number(body.fraction) : 1 },
      };
    }
    if (seg[2] === "margin") {
      return { action: "margin", params: { positionId, delta: Number(body.delta ?? 0) } };
    }
    if (seg[2] === "stops") {
      return {
        action: "stops",
        params: {
          positionId,
          stopLoss: body.stopLoss === null ? null : body.stopLoss != null ? Number(body.stopLoss) : undefined,
          takeProfit:
            body.takeProfit === null ? null : body.takeProfit != null ? Number(body.takeProfit) : undefined,
        },
      };
    }
  }
  return null;
}

type App = { request: (path: string, init?: RequestInit) => Promise<Response> };

/**
 * A `post(path, body)` that attaches a genuine signature when the route needs
 * one. `appOf` is a thunk because the suites import the app lazily in `beforeAll`.
 */
export function signedPost(appOf: () => App, account: PrivateKeyAccount) {
  return async (path: string, body?: unknown, as?: PrivateKeyAccount): Promise<Response> => {
    const b = (body ?? {}) as Record<string, unknown>;
    const route = routeFor(path, b);
    let payload: Record<string, unknown> = b;

    if (route) {
      // `as` matters wherever a suite drives more than one trader: the operator
      // binds the signer to the acting address, so signing B's order with A's key
      // is (correctly) a 401.
      const signer = as ?? account;
      const ts = Date.now();
      const signature = await signer.signMessage({
        message: authMessage(route.action, route.params, ts),
      });
      payload = { ...b, auth: { signer: signer.address, ts, sig: { signature, key: "" } } };
    }

    return appOf().request(path, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
    });
  };
}
