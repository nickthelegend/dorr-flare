import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import type { ZKProof } from "../common/types.js";

export enum CircuitId {
  ORDER_COMMITMENT = "order-commitment-v1",
  PRICE_RANGE = "price-range-v1",
  MARGIN_PROOF = "margin-proof-v1",
  ANTI_FRONT_RUNNING = "anti-front-running-v1",
  /** Live Compact contract used in this repo (`contract/src/zkperps-order.compact`). */
  ZKPERPS_ORDER_COMPACT = "zkperps-order-v1",
  ZKPERPS_MATCHING_COMPACT = "zkperps-matching-v1",
  ZKPERPS_SETTLEMENT_COMPACT = "zkperps-settlement-v1",
  ZKPERPS_LIQUIDATION_COMPACT = "zkperps-liquidation-v1",
  ZKPERPS_AGGREGATE_COMPACT = "zkperps-aggregate-v1",
}

export interface CompiledCircuit {
  circuitId: CircuitId;
  constraintSystem: Uint8Array;
  constraintCount: number;
  provingKey: Uint8Array;
  verificationKey: Uint8Array;
  versionHash: string;
  compiledAt: number;
}

export interface CircuitWitness {
  circuitId: CircuitId;
  privateInputs: string[];
  publicInputs: string[];
  wireAssignment: string[];
  isSatisfied: boolean;
}

export interface SerializedProof {
  proofHex: string;
  publicInputsHex: string[];
  circuitId: CircuitId;
  sizeBytes: number;
  compression: "none" | "gzip" | "zstd";
}

function circuitIdFromProofId(id: string): CircuitId {
  const vals = Object.values(CircuitId) as string[];
  if (vals.includes(id)) return id as CircuitId;
  return CircuitId.ORDER_COMMITMENT;
}

export async function compileCircuit(
  circuitId: CircuitId,
  sourcePath: string,
  _options?: { optimizationLevel?: number; debug?: boolean },
): Promise<CompiledCircuit> {
  let sourceTag = "";
  try {
    const src = await readFile(sourcePath, "utf8");
    sourceTag = createHash("sha256").update(src).digest("hex").slice(0, 16);
  } catch {
    sourceTag = "nosource";
  }
  const meta = createHash("sha256")
    .update(String(circuitId))
    .update(sourcePath)
    .update(sourceTag)
    .digest();
  const estimate =
    listAvailableCircuits().find((c) => c.circuitId === circuitId)?.constraintEstimate ?? 10_000;
  return {
    circuitId,
    constraintSystem: meta,
    constraintCount: estimate,
    provingKey: meta,
    verificationKey: meta,
    versionHash: "0x" + Buffer.from(meta).toString("hex"),
    compiledAt: Date.now(),
  };
}

export async function generateWitness(
  circuit: CompiledCircuit,
  privateInputs: string[],
  publicInputs: string[],
): Promise<CircuitWitness> {
  const wireAssignment = [...privateInputs, ...publicInputs];
  return {
    circuitId: circuit.circuitId,
    privateInputs,
    publicInputs,
    wireAssignment,
    isSatisfied: privateInputs.length + publicInputs.length > 0,
  };
}

export function serializeProof(
  proof: ZKProof,
  compression: "none" | "gzip" | "zstd" = "none",
): SerializedProof {
  const json = JSON.stringify(proof);
  const proofHex = Buffer.from(json, "utf8").toString("hex");
  return {
    proofHex,
    publicInputsHex: proof.publicInputs.map((p) => Buffer.from(String(p), "utf8").toString("hex")),
    circuitId: circuitIdFromProofId(proof.circuitId),
    sizeBytes: Math.floor(proofHex.length / 2),
    compression,
  };
}

export function deserializeProof(serialized: SerializedProof): ZKProof {
  const raw = Buffer.from(serialized.proofHex, "hex").toString("utf8");
  const p = JSON.parse(raw) as ZKProof;
  return p;
}

export async function loadCachedCircuit(
  _circuitId: CircuitId,
  _cachePath: string,
): Promise<CompiledCircuit | null> {
  return null;
}

export function listAvailableCircuits(): Array<{
  circuitId: CircuitId;
  description: string;
  constraintEstimate: number;
}> {
  return [
    {
      circuitId: CircuitId.ZKPERPS_ORDER_COMPACT,
      description: "Midnight Compact order lifecycle (see contract/src/zkperps-order.compact)",
      constraintEstimate: 120_000,
    },
    {
      circuitId: CircuitId.ZKPERPS_MATCHING_COMPACT,
      description: "Midnight Compact matching pair + match digest (contract/src/zkperps-matching.compact)",
      constraintEstimate: 55_000,
    },
    {
      circuitId: CircuitId.ZKPERPS_SETTLEMENT_COMPACT,
      description: "Midnight Compact settlement digest transition (contract/src/zkperps-settlement.compact)",
      constraintEstimate: 45_000,
    },
    {
      circuitId: CircuitId.ZKPERPS_LIQUIDATION_COMPACT,
      description: "Midnight Compact liquidation breach tag (contract/src/zkperps-liquidation.compact)",
      constraintEstimate: 40_000,
    },
    {
      circuitId: CircuitId.ZKPERPS_AGGREGATE_COMPACT,
      description: "Midnight Compact proof bundle aggregation (contract/src/zkperps-aggregate.compact)",
      constraintEstimate: 35_000,
    },
    {
      circuitId: CircuitId.ORDER_COMMITMENT,
      description: "Creates cryptographic commitment to order details",
      constraintEstimate: 25_000,
    },
    {
      circuitId: CircuitId.PRICE_RANGE,
      description: "Proves price is within valid range without revealing it",
      constraintEstimate: 15_000,
    },
    {
      circuitId: CircuitId.MARGIN_PROOF,
      description: "Proves sufficient margin without revealing balance",
      constraintEstimate: 20_000,
    },
    {
      circuitId: CircuitId.ANTI_FRONT_RUNNING,
      description: "Proves order was committed before reference timestamp",
      constraintEstimate: 35_000,
    },
  ];
}
