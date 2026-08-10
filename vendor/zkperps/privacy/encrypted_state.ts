import { createHash } from "node:crypto";
import type { EncryptedState, ZKProof } from "../common/types.js";
import { minimalVerifiedProof } from "../common/utils.js";
import { sealJson, openJson } from "./codec.js";

export interface EncryptionParams {
  algorithm: "AES-256-GCM" | "ChaCha20-Poly1305";
  kdf: "HKDF-SHA256" | "Argon2id";
  iv: string;
  aad?: string;
}

export interface PlaintextState {
  stateId: string;
  data: Record<string, unknown>;
  version: number;
  ownerPubKey: string;
}

export interface StateTransitionResult {
  previousState: EncryptedState;
  newState: EncryptedState;
  transitionProof: ZKProof;
  txHash: string;
  success: boolean;
}

export interface StateQueryResult {
  state: PlaintextState | null;
  found: boolean;
  authorized: boolean;
  version: number;
  lastUpdatedAt: number;
}

const store = new Map<string, { enc: EncryptedState; plaintextVersion: number }>();

export async function encryptState(
  plaintext: PlaintextState,
  encryptionKey: string,
  params: EncryptionParams,
): Promise<EncryptedState> {
  void params;
  const payload = sealJson(plaintext, encryptionKey);
  const enc: EncryptedState = {
    stateId: plaintext.stateId,
    encryptedPayload: payload,
    version: plaintext.version,
    transitionProof: minimalVerifiedProof("encrypt-state-v1", [plaintext.stateId]),
    updatedAt: Date.now(),
  };
  store.set(plaintext.stateId, { enc, plaintextVersion: plaintext.version });
  return enc;
}

export async function decryptState(
  encryptedState: EncryptedState,
  decryptionKey: string,
): Promise<PlaintextState> {
  return openJson(encryptedState.encryptedPayload, decryptionKey) as PlaintextState;
}

export async function updateEncryptedState(
  stateId: string,
  newPlaintext: PlaintextState,
  encryptionKey: string,
  params: EncryptionParams,
): Promise<StateTransitionResult> {
  void params;
  const cur = store.get(stateId);
  if (!cur) throw new Error("State not found");
  if (cur.plaintextVersion !== newPlaintext.version) {
    throw new Error("Version conflict");
  }
  const previousState = cur.enc;
  const bumped = { ...newPlaintext, version: newPlaintext.version + 1 };
  const newState = await encryptState(bumped, encryptionKey, params);
  return {
    previousState,
    newState,
    transitionProof: minimalVerifiedProof("state-transition-v1", [stateId]),
    txHash: "0x" + createHash("sha256").update(stateId + bumped.version).digest("hex").slice(0, 40),
    success: true,
  };
}

export async function proveStateTransition(
  previousState: EncryptedState,
  newState: EncryptedState,
  operation: string,
  decryptionKey: string,
): Promise<ZKProof> {
  void decryptionKey;
  return minimalVerifiedProof("state-transition-proof-v1", [
    previousState.stateId,
    newState.stateId,
    operation,
  ]);
}

export async function queryState(
  stateId: string,
  decryptionKey?: string,
): Promise<StateQueryResult> {
  const cur = store.get(stateId);
  if (!cur) {
    return { state: null, found: false, authorized: false, version: 0, lastUpdatedAt: 0 };
  }
  if (!decryptionKey) {
    return {
      state: null,
      found: true,
      authorized: false,
      version: cur.enc.version,
      lastUpdatedAt: cur.enc.updatedAt,
    };
  }
  try {
    const state = await decryptState(cur.enc, decryptionKey);
    return {
      state,
      found: true,
      authorized: true,
      version: cur.enc.version,
      lastUpdatedAt: cur.enc.updatedAt,
    };
  } catch {
    return {
      state: null,
      found: true,
      authorized: false,
      version: cur.enc.version,
      lastUpdatedAt: cur.enc.updatedAt,
    };
  }
}
