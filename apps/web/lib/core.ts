// Core utilities — pure helpers only (EVM config removed in the Cardano port).
import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/** 1,234.56 style formatting with sane defaults for prices. */
export function formatUsd(value: number | null | undefined, digits?: number): string {
  if (value === null || value === undefined || Number.isNaN(value)) return "—";
  const d = digits ?? (Math.abs(value) >= 1 ? 2 : 6);
  return value.toLocaleString("en-US", {
    minimumFractionDigits: d,
    maximumFractionDigits: d,
  });
}

/** Truncate an address for display: 0x0b6A564E9d…010B12 */
export function truncateAddress(addr: string | null | undefined, head = 12, tail = 6): string {
  if (!addr) return "";
  if (addr.length <= head + tail + 1) return addr;
  return `${addr.slice(0, head)}…${addr.slice(-tail)}`;
}

/** Truncate a hex hash: 0f2a…9c1d */
export function truncateHash(hash: string | null | undefined, head = 10, tail = 8): string {
  if (!hash) return "";
  if (hash.length <= head + tail + 1) return hash;
  return `${hash.slice(0, head)}…${hash.slice(-tail)}`;
}

export function formatTimestamp(iso: string): string {
  try {
    return new Date(iso).toLocaleTimeString("en-US", { hour12: false });
  } catch {
    return iso;
  }
}

/**
 * Turn a thrown wallet/RPC/network error into one sentence a trader can act on.
 *
 * viem's `message` carries a multi-line trailer ("Details: …", "Version: viem@x.y.z")
 * that is useful in a console and noise in a toast — a user should never be shown
 * a library version. Prefers viem's own `shortMessage`, strips the trailer, and
 * gives the common wallet outcomes plain wording.
 */
export function humanizeError(e: unknown): string {
  const raw = String(
    (e as { shortMessage?: string })?.shortMessage ??
      (e as { message?: string })?.message ??
      e ??
      "",
  );
  // Drop viem's diagnostic trailer and keep the first meaningful line.
  const head = raw.split(/\n\s*(?:Details|Version|Request Arguments|Docs):/)[0].trim();
  const first = head.split("\n")[0].trim() || "Something went wrong.";

  if (/user rejected|user denied|4001/i.test(first)) return "You rejected the request in your wallet.";
  if (/insufficient funds/i.test(first)) return "Not enough C2FLR to pay for gas.";
  if (/does not match the target chain/i.test(first)) return "Wrong network — switch your wallet to Flare Coston2.";
  if (/failed to fetch|networkerror|load failed/i.test(first)) return "Couldn't reach the operator — is it running?";

  return first.length > 200 ? `${first.slice(0, 200)}…` : first;
}
