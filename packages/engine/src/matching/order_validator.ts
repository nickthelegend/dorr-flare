import type { Order, OrderCommitment, MarketPair, ZKProof } from "../common/types.js";
import { ErrorCode, OrderValidationError } from "../common/errors.js";
import { validateOrder } from "../common/utils.js";

export interface ValidationResult {
  isValid: boolean;
  errors: ValidationError[];
  warnings: string[];
  validatedAt: number;
}

export interface ValidationError {
  code: number;
  message: string;
  field: string;
  value: unknown;
  expected: string;
}

function ok(): ValidationResult {
  return { isValid: true, errors: [], warnings: [], validatedAt: Date.now() };
}

function fromZKError(e: unknown): ValidationError[] {
  if (e instanceof OrderValidationError) {
    return [
      {
        code: e.code,
        message: e.message,
        field: String(e.metadata.field ?? ""),
        value: e.metadata.value,
        expected: String(e.metadata.expected ?? ""),
      },
    ];
  }
  return [
    {
      code: ErrorCode.PROOF_VERIFICATION_FAILED,
      message: e instanceof Error ? e.message : String(e),
      field: "",
      value: undefined,
      expected: "",
    },
  ];
}

export function validateOrderParams(order: Order, pair: MarketPair): ValidationResult {
  try {
    validateOrder(order, pair);
    return ok();
  } catch (e) {
    return {
      isValid: false,
      errors: fromZKError(e),
      warnings: [],
      validatedAt: Date.now(),
    };
  }
}

export function checkMarginRequirements(order: Order, availableMargin: number): boolean {
  const ref =
    order.price ??
    order.stopPrice ??
    1;
  const notional = order.size * ref;
  const required = notional / Math.max(1, order.leverage);
  return availableMargin >= required;
}

export function validateLeverage(leverage: number, pair: MarketPair): boolean {
  return leverage >= 1 && leverage <= pair.maxLeverage;
}

export function checkDuplicateOrder(
  commitmentHash: string,
  activeCommitments: Set<string>,
): boolean {
  return activeCommitments.has(commitmentHash);
}

function proofLooksValid(p: ZKProof): boolean {
  return p.isVerified && p.proofData.length > 0 && p.circuitId.length > 0;
}

export async function validateOrderSubmission(
  commitment: OrderCommitment,
  proofs: {
    priceRangeProof: ZKProof;
    marginProof: ZKProof;
    timelockProof: ZKProof;
  },
  pairId: string,
  activeCommitments: Set<string>,
): Promise<ValidationResult> {
  const errors: ValidationError[] = [];
  const warnings: string[] = [];

  if (checkDuplicateOrder(commitment.commitmentHash, activeCommitments)) {
    errors.push({
      code: ErrorCode.DUPLICATE_ORDER,
      message: "Duplicate commitment hash",
      field: "commitmentHash",
      value: commitment.commitmentHash,
      expected: "unique hash",
    });
  }

  if (!proofLooksValid(commitment.validityProof)) {
    errors.push({
      code: ErrorCode.PROOF_VERIFICATION_FAILED,
      message: "Invalid order validity proof",
      field: "validityProof",
      value: commitment.validityProof,
      expected: "verified proof with proofData",
    });
  }
  if (!proofLooksValid(proofs.priceRangeProof)) {
    errors.push({
      code: ErrorCode.PROOF_VERIFICATION_FAILED,
      message: "Invalid price range proof",
      field: "priceRangeProof",
      value: proofs.priceRangeProof,
      expected: "verified proof with proofData",
    });
  }
  if (!proofLooksValid(proofs.marginProof)) {
    errors.push({
      code: ErrorCode.PROOF_VERIFICATION_FAILED,
      message: "Invalid margin proof",
      field: "marginProof",
      value: proofs.marginProof,
      expected: "verified proof with proofData",
    });
  }
  if (!proofLooksValid(proofs.timelockProof)) {
    errors.push({
      code: ErrorCode.PROOF_VERIFICATION_FAILED,
      message: "Invalid timelock proof",
      field: "timelockProof",
      value: proofs.timelockProof,
      expected: "verified proof with proofData",
    });
  }

  if (!pairId) {
    errors.push({
      code: ErrorCode.INVALID_PAIR,
      message: "Missing pairId",
      field: "pairId",
      value: pairId,
      expected: "non-empty pair id",
    });
  }

  return {
    isValid: errors.length === 0,
    errors,
    warnings,
    validatedAt: Date.now(),
  };
}
