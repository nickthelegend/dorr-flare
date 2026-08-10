import { createHash, randomUUID } from "node:crypto";
import type { DisclosureProof, ZKProof, OrderCommitment } from "../common/types.js";
import { minimalVerifiedProof } from "../common/utils.js";

export interface DisclosurePolicy {
  policyId: string;
  name: string;
  requiredFields: string[];
  optionalFields: string[];
  authorizedRecipients: string[];
  maxDurationMs: number;
  isActive: boolean;
  createdAt: number;
}

export interface DisclosureRequest {
  orderCommitment: OrderCommitment;
  fieldsToDisclose: string[];
  recipientAddress: string;
  validityDurationMs: number;
  policyId: string;
}

export interface DisclosureResult {
  disclosureProof: DisclosureProof;
  success: boolean;
  auditTrailHash: string;
}

export interface DisclosureVerificationResult {
  isValid: boolean;
  disclosedData: Record<string, unknown>;
  commitmentHash: string;
  isExpired: boolean;
  verifiedAt: number;
}

const policies = new Map<string, DisclosurePolicy>();
const revoked = new Set<string>();

policies.set("regulatory-policy-v1", {
  policyId: "regulatory-policy-v1",
  name: "Default regulatory policy",
  requiredFields: ["traderId", "pairId", "size"],
  optionalFields: ["price"],
  authorizedRecipients: [],
  maxDurationMs: 7 * 24 * 60 * 60 * 1000,
  isActive: true,
  createdAt: Date.now(),
});

export async function createDisclosureProof(
  request: DisclosureRequest,
  privateInputs: Record<string, unknown>,
  commitmentNonce: string,
): Promise<DisclosureResult> {
  const pol = policies.get(request.policyId);
  if (!pol?.isActive) {
    return {
      success: false,
      auditTrailHash: "",
      disclosureProof: {
        disclosureId: "",
        disclosedFields: [],
        disclosedValues: {},
        proof: minimalVerifiedProof("disclosure-fail", []),
        recipientAddress: request.recipientAddress,
        expiresAt: 0,
      },
    };
  }
  const disclosedValues: Record<string, unknown> = {};
  for (const f of request.fieldsToDisclose) {
    if (![...pol.requiredFields, ...pol.optionalFields].includes(f)) {
      continue;
    }
    disclosedValues[f] = privateInputs[f];
  }
  const proof: ZKProof = minimalVerifiedProof("disclosure-v1", [
    request.orderCommitment.commitmentHash,
    ...request.fieldsToDisclose,
  ]);
  const disclosureProof: DisclosureProof = {
    disclosureId: randomUUID(),
    disclosedFields: request.fieldsToDisclose,
    disclosedValues,
    proof,
    recipientAddress: request.recipientAddress,
    expiresAt: Date.now() + Math.min(request.validityDurationMs, pol.maxDurationMs),
  };
  const auditTrailHash =
    "0x" +
    createHash("sha256")
      .update(JSON.stringify({ disclosureProof, commitmentNonce }))
      .digest("hex");
  return { disclosureProof, success: true, auditTrailHash };
}

export async function verifyDisclosureProof(
  disclosure: DisclosureProof,
  recipientAddress: string,
): Promise<DisclosureVerificationResult> {
  const now = Date.now();
  if (revoked.has(disclosure.disclosureId)) {
    return {
      isValid: false,
      disclosedData: {},
      commitmentHash: "",
      isExpired: true,
      verifiedAt: now,
    };
  }
  if (disclosure.recipientAddress !== recipientAddress) {
    throw new Error("Disclosure recipient mismatch");
  }
  const expired = disclosure.expiresAt < now;
  return {
    isValid: !expired && disclosure.proof.isVerified,
    disclosedData: disclosure.disclosedValues,
    commitmentHash: disclosure.proof.publicInputs[0] ?? "",
    isExpired: expired,
    verifiedAt: now,
  };
}

export async function revokeDisclosure(
  disclosureId: string,
  traderSignature: string,
): Promise<boolean> {
  void traderSignature;
  revoked.add(disclosureId);
  return true;
}

export async function getDisclosurePolicy(
  policyId: string,
): Promise<DisclosurePolicy | null> {
  return policies.get(policyId) ?? null;
}

export async function listDisclosurePolicies(
  activeOnly: boolean = true,
): Promise<DisclosurePolicy[]> {
  const all = [...policies.values()];
  return activeOnly ? all.filter((p) => p.isActive) : all;
}
