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

/** Truncate a bech32 (or any long) address: addr_test1qz…x0f2 */
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
