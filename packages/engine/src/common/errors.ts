
// ─────────────────────────────────────────────────────────────────────────────
// ERROR CODES
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Enumeration of all system error codes.
 * Grouped by module for easy identification.
 */
export enum ErrorCode {
  // ── Order Validation Errors (1xxx) ──
  /** Order size is below the minimum allowed for the trading pair */
  ORDER_SIZE_TOO_SMALL = 1001,
  /** Order size exceeds the maximum allowed for the trading pair */
  ORDER_SIZE_TOO_LARGE = 1002,
  /** Specified leverage exceeds the maximum allowed */
  LEVERAGE_EXCEEDED = 1003,
  /** Limit price is missing for a LIMIT or STOP_LIMIT order */
  MISSING_LIMIT_PRICE = 1004,
  /** Stop price is missing for a STOP_MARKET or STOP_LIMIT order */
  MISSING_STOP_PRICE = 1005,
  /** The trading pair is not active or does not exist */
  INVALID_PAIR = 1006,
  /** Duplicate order ID detected */
  DUPLICATE_ORDER = 1007,
  /** Order has expired past its TTL */
  ORDER_EXPIRED = 1008,

  // ── Settlement Errors (2xxx) ──
  /** Insufficient margin to open or maintain a position */
  INSUFFICIENT_MARGIN = 2001,
  /** Settlement transaction failed on Cardano */
  SETTLEMENT_TX_FAILED = 2002,
  /** UTxO required for settlement was already consumed */
  UTXO_CONSUMED = 2003,
  /** Position not found for settlement */
  POSITION_NOT_FOUND = 2004,
  /** Liquidation threshold reached */
  LIQUIDATION_TRIGGERED = 2005,
  /** Funding rate calculation error */
  FUNDING_RATE_ERROR = 2006,

  // ── Proof Generation Errors (3xxx) ──
  /** ZK circuit compilation failed */
  CIRCUIT_COMPILATION_FAILED = 3001,
  /** Witness generation failed (invalid inputs) */
  WITNESS_GENERATION_FAILED = 3002,
  /** Proof generation timed out */
  PROOF_GENERATION_TIMEOUT = 3003,
  /** Proof verification failed */
  PROOF_VERIFICATION_FAILED = 3004,
  /** Invalid proof format or corrupted proof data */
  INVALID_PROOF_FORMAT = 3005,

  // ── Privacy Layer Errors (4xxx) ──
  /** Failed to connect to the Midnight network */
  MIDNIGHT_CONNECTION_FAILED = 4001,
  /** Encrypted state is corrupted or version mismatch */
  STATE_CORRUPTION = 4002,
  /** Selective disclosure proof generation failed */
  DISCLOSURE_FAILED = 4003,
  /** Shielded pool operation failed */
  SHIELDED_POOL_ERROR = 4004,
  /** Disclosure proof has expired */
  DISCLOSURE_EXPIRED = 4005,

  // ── Matching Engine Errors (5xxx) ──
  /** No matching counterparty found for the order */
  NO_MATCH_FOUND = 5001,
  /** Order book is empty for the requested pair */
  EMPTY_ORDER_BOOK = 5002,
  /** Matching engine is temporarily unavailable */
  MATCHING_ENGINE_UNAVAILABLE = 5003,
  /** Order cancellation failed — order already filled or expired */
  CANCEL_FAILED = 5004,
}

// ─────────────────────────────────────────────────────────────────────────────
// BASE ERROR CLASS
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Base error class for all ZKPerps system errors.
 * Provides structured error information with error codes and metadata.
 */
export class ZKPerpsError extends Error {
  /** Numeric error code from the ErrorCode enum */
  public readonly code: ErrorCode;
  /** Module where the error originated */
  public readonly module: string;
  /** Optional metadata providing additional context about the error */
  public readonly metadata: Record<string, unknown>;
  /** ISO 8601 timestamp when the error was created */
  public readonly timestamp: string;

  constructor(
    message: string,
    code: ErrorCode,
    module: string,
    metadata: Record<string, unknown> = {}
  ) {
    super(message);
    this.name = "ZKPerpsError";
    this.code = code;
    this.module = module;
    this.metadata = metadata;
    this.timestamp = new Date().toISOString();

    // Maintains proper stack trace in V8 environments
    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, ZKPerpsError);
    }
  }

  /**
   * Serializes the error to a structured JSON object for logging.
   * @returns A plain object representation of the error.
   */
  public toJSON(): Record<string, unknown> {
    return {
      name: this.name,
      message: this.message,
      code: this.code,
      module: this.module,
      metadata: this.metadata,
      timestamp: this.timestamp,
      stack: this.stack,
    };
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// MODULE-SPECIFIC ERROR CLASSES
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Error thrown when an order fails validation checks.
 *
 * @example
 * throw new OrderValidationError(
 *   "Order size 0.001 is below minimum 10 for pair ADA-USD",
 *   ErrorCode.ORDER_SIZE_TOO_SMALL,
 *   { orderId: "abc-123", pairId: "ADA-USD", size: 0.001, minSize: 10 }
 * );
 */
export class OrderValidationError extends ZKPerpsError {
  constructor(
    message: string,
    code: ErrorCode,
    metadata: Record<string, unknown> = {}
  ) {
    super(message, code, "order-validation", metadata);
    this.name = "OrderValidationError";
  }
}

/**
 * Error thrown when a settlement operation fails on Cardano.
 *
 * @example
 * throw new SettlementError(
 *   "Settlement transaction rejected: insufficient funds",
 *   ErrorCode.SETTLEMENT_TX_FAILED,
 *   { txHash: "abc123...", reason: "InsufficientFundsError" }
 * );
 */
export class SettlementError extends ZKPerpsError {
  constructor(
    message: string,
    code: ErrorCode,
    metadata: Record<string, unknown> = {}
  ) {
    super(message, code, "settlement", metadata);
    this.name = "SettlementError";
  }
}

/**
 * Error thrown when ZK proof generation or verification fails.
 *
 * @example
 * throw new ProofGenerationError(
 *   "Proof generation timed out after 30000ms",
 *   ErrorCode.PROOF_GENERATION_TIMEOUT,
 *   { circuitId: "order-commitment-v1", timeoutMs: 30000 }
 * );
 */
export class ProofGenerationError extends ZKPerpsError {
  constructor(
    message: string,
    code: ErrorCode,
    metadata: Record<string, unknown> = {}
  ) {
    super(message, code, "proof-generation", metadata);
    this.name = "ProofGenerationError";
  }
}

/**
 * Error thrown when a privacy layer operation fails.
 *
 * @example
 * throw new PrivacyError(
 *   "Failed to connect to Midnight node at wss://midnight.example.com",
 *   ErrorCode.MIDNIGHT_CONNECTION_FAILED,
 *   { nodeUrl: "wss://midnight.example.com", retries: 3 }
 * );
 */
export class PrivacyError extends ZKPerpsError {
  constructor(
    message: string,
    code: ErrorCode,
    metadata: Record<string, unknown> = {}
  ) {
    super(message, code, "privacy", metadata);
    this.name = "PrivacyError";
  }
}

/**
 * Error thrown when a ZK circuit fails to compile.
 *
 * @example
 * throw new CircuitCompilationError(
 *   "Circuit 'margin-proof-v1' has unsatisfied constraints",
 *   ErrorCode.CIRCUIT_COMPILATION_FAILED,
 *   { circuitId: "margin-proof-v1", constraintCount: 50000 }
 * );
 */
export class CircuitCompilationError extends ZKPerpsError {
  constructor(
    message: string,
    code: ErrorCode,
    metadata: Record<string, unknown> = {}
  ) {
    super(message, code, "circuit-compilation", metadata);
    this.name = "CircuitCompilationError";
  }
}

/**
 * Error thrown when the matching engine encounters an error.
 *
 * @example
 * throw new MatchingEngineError(
 *   "No matching counterparty found for order abc-123",
 *   ErrorCode.NO_MATCH_FOUND,
 *   { orderId: "abc-123", pairId: "ADA-USD", side: "LONG" }
 * );
 */
export class MatchingEngineError extends ZKPerpsError {
  constructor(
    message: string,
    code: ErrorCode,
    metadata: Record<string, unknown> = {}
  ) {
    super(message, code, "matching-engine", metadata);
    this.name = "MatchingEngineError";
  }
}
