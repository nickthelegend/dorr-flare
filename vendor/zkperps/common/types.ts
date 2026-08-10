// ─────────────────────────────────────────────────────────────────────────────
// ENUMS
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Direction of a perpetual futures order.
 */
export enum OrderSide {
  /** Long position — profit when asset price increases */
  LONG = "LONG",
  /** Short position — profit when asset price decreases */
  SHORT = "SHORT",
}

/**
 * Type of order submitted to the matching engine.
 */
export enum OrderType {
  /** Execute at the best available market price */
  MARKET = "MARKET",
  /** Execute only at the specified price or better */
  LIMIT = "LIMIT",
  /** Trigger a market order when a price threshold is reached */
  STOP_MARKET = "STOP_MARKET",
  /** Trigger a limit order when a price threshold is reached */
  STOP_LIMIT = "STOP_LIMIT",
}

/**
 * Current lifecycle status of an order.
 */
export enum OrderStatus {
  /** Order has been created but not yet submitted */
  PENDING = "PENDING",
  /** Order commitment has been submitted to the privacy layer */
  COMMITTED = "COMMITTED",
  /** Order is active in the order book, awaiting a match */
  OPEN = "OPEN",
  /** Order has been partially filled */
  PARTIALLY_FILLED = "PARTIALLY_FILLED",
  /** Order has been completely filled */
  FILLED = "FILLED",
  /** Order has been cancelled by the trader */
  CANCELLED = "CANCELLED",
  /** Order has expired past its time-to-live */
  EXPIRED = "EXPIRED",
  /** Order was rejected by the validator */
  REJECTED = "REJECTED",
}

/**
 * Status of a settlement transaction on Cardano.
 */
export enum SettlementStatus {
  /** Settlement transaction is being constructed */
  BUILDING = "BUILDING",
  /** Transaction has been submitted to the Cardano network */
  SUBMITTED = "SUBMITTED",
  /** Transaction has been confirmed on-chain */
  CONFIRMED = "CONFIRMED",
  /** Transaction failed to confirm */
  FAILED = "FAILED",
}

/**
 * Status of a position (open trade).
 */
export enum PositionStatus {
  /** Position is active and has unrealized PnL */
  OPEN = "OPEN",
  /** Position has been closed by the trader */
  CLOSED = "CLOSED",
  /** Position was liquidated due to insufficient margin */
  LIQUIDATED = "LIQUIDATED",
}

// ─────────────────────────────────────────────────────────────────────────────
// CORE INTERFACES
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Represents a trading pair for perpetual contracts.
 *
 * @example
 * const pair: MarketPair = {
 *   pairId: "ADA-USD",
 *   baseAsset: "ADA",
 *   quoteAsset: "USD",
 *   minOrderSize: 10,
 *   maxLeverage: 20,
 *   tickSize: 0.0001,
 *   isActive: true,
 * };
 */
export interface MarketPair {
  /** Unique identifier for the trading pair (e.g., "ADA-USD") */
  pairId: string;
  /** The asset being traded (e.g., "ADA") */
  baseAsset: string;
  /** The asset used for pricing and settlement (e.g., "USD") */
  quoteAsset: string;
  /** Minimum order size in base asset units */
  minOrderSize: number;
  /** Maximum allowed leverage multiplier */
  maxLeverage: number;
  /** Minimum price increment */
  tickSize: number;
  /** Whether trading is currently active for this pair */
  isActive: boolean;
}

/**
 * Represents a price data point from an oracle or price feed.
 */
export interface PriceData {
  /** The trading pair this price belongs to */
  pairId: string;
  /** Current mark price (fair price derived from index + funding) */
  markPrice: number;
  /** Index price from external oracle feeds */
  indexPrice: number;
  /** Best bid price currently in the order book */
  bestBid: number;
  /** Best ask price currently in the order book */
  bestAsk: number;
  /** Unix timestamp (milliseconds) when this price was recorded */
  timestamp: number;
}

/**
 * Represents a perpetual futures order submitted by a trader.
 * This is the plaintext representation — it is encrypted/committed
 * before being sent to the matching engine.
 */
export interface Order {
  /** Unique order identifier (UUID v4) */
  orderId: string;
  /** Trader's wallet address or public key hash */
  traderId: string;
  /** Trading pair identifier */
  pairId: string;
  /** Buy (LONG) or sell (SHORT) */
  side: OrderSide;
  /** Market, Limit, Stop-Market, or Stop-Limit */
  type: OrderType;
  /** Order quantity in base asset units */
  size: number;
  /** Limit price (required for LIMIT and STOP_LIMIT orders) */
  price?: number;
  /** Trigger price (required for STOP_MARKET and STOP_LIMIT orders) */
  stopPrice?: number;
  /** Leverage multiplier (1x to maxLeverage) */
  leverage: number;
  /** Current lifecycle status of the order */
  status: OrderStatus;
  /** Margin amount locked for this order (in quote asset) */
  margin: number;
  /** Time-to-live in milliseconds; order expires after this duration */
  ttlMs: number;
  /** Unix timestamp (ms) when the order was created */
  createdAt: number;
  /** Unix timestamp (ms) when the order was last updated */
  updatedAt: number;
}

/**
 * Represents an open position (a filled/matched order).
 */
export interface Position {
  /** Unique position identifier */
  positionId: string;
  /** Trader's wallet address or public key hash */
  traderId: string;
  /** Trading pair identifier */
  pairId: string;
  /** Direction of the position */
  side: OrderSide;
  /** Position size in base asset units */
  size: number;
  /** Average entry price */
  entryPrice: number;
  /** Current mark price for PnL calculation */
  markPrice: number;
  /** Leverage multiplier used */
  leverage: number;
  /** Margin deposited for this position (quote asset) */
  margin: number;
  /** Unrealized profit/loss at current mark price */
  unrealizedPnl: number;
  /** Realized profit/loss from partial closes */
  realizedPnl: number;
  /** Price at which the position will be auto-liquidated */
  liquidationPrice: number;
  /** Current position status */
  status: PositionStatus;
  /** Unix timestamp (ms) when the position was opened */
  openedAt: number;
  /** Unix timestamp (ms) when the position was closed (if applicable) */
  closedAt?: number;
}

/**
 * Represents a perpetual contract specification.
 */
export interface PerpetualContract {
  /** Unique contract identifier */
  contractId: string;
  /** Associated trading pair */
  pair: MarketPair;
  /** Funding rate interval in milliseconds */
  fundingIntervalMs: number;
  /** Current funding rate (positive = longs pay shorts) */
  currentFundingRate: number;
  /** Total open interest in base asset units */
  openInterest: number;
  /** 24-hour trading volume in quote asset */
  volume24h: number;
  /** Maintenance margin ratio (e.g., 0.005 = 0.5%) */
  maintenanceMarginRatio: number;
  /** Initial margin ratio (e.g., 0.01 = 1%) */
  initialMarginRatio: number;
}

// ─────────────────────────────────────────────────────────────────────────────
// ZK PROOF TYPES
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Represents a Zero-Knowledge Proof generated by a ZK circuit.
 * Compatible with Midnight's proof format.
 */
export interface ZKProof {
  /** Identifier for the circuit that generated this proof */
  circuitId: string;
  /** The serialized proof data (hex-encoded) */
  proofData: string;
  /** Public inputs to the circuit (visible to verifier) */
  publicInputs: string[];
  /** Verification key identifier */
  verificationKeyId: string;
  /** Unix timestamp (ms) when the proof was generated */
  generatedAt: number;
  /** Whether the proof has been verified */
  isVerified: boolean;
}

/**
 * Represents an order commitment — a ZK-protected version of an order
 * that hides the order details while allowing verification of its properties.
 */
export interface OrderCommitment {
  /** Hash commitment of the order (Poseidon or Pedersen hash) */
  commitmentHash: string;
  /** ZK proof that the committed order is valid */
  validityProof: ZKProof;
  /** ZK proof that the order was committed before a reference time */
  timelockProof: ZKProof;
  /** The blinding factor / nonce used in the commitment (kept secret) */
  nonce?: string;
  /** Unix timestamp (ms) when the commitment was created */
  committedAt: number;
}

// ─────────────────────────────────────────────────────────────────────────────
// SETTLEMENT TYPES
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Result of a trade settlement on Cardano.
 */
export interface SettlementResult {
  /** Unique settlement transaction identifier */
  settlementId: string;
  /** Cardano transaction hash */
  txHash: string;
  /** IDs of the orders that were matched and settled */
  matchedOrderIds: [string, string];
  /** Execution price of the trade */
  executionPrice: number;
  /** Executed quantity */
  executionSize: number;
  /** Fee charged for the trade (in quote asset) */
  fee: number;
  /** Settlement status on-chain */
  status: SettlementStatus;
  /** Block number where the transaction was confirmed */
  blockNumber?: number;
  /** Unix timestamp (ms) of settlement */
  settledAt: number;
}

/**
 * Represents a margin account for a trader.
 */
export interface MarginAccount {
  /** Trader's wallet address */
  traderId: string;
  /** Total balance in the margin account (quote asset) */
  totalBalance: number;
  /** Amount currently locked as margin for open positions */
  lockedMargin: number;
  /** Available balance for new orders */
  availableBalance: number;
  /** Total unrealized PnL across all open positions */
  unrealizedPnl: number;
  /** Margin ratio = (totalBalance + unrealizedPnl) / lockedMargin */
  marginRatio: number;
}

// ─────────────────────────────────────────────────────────────────────────────
// PRIVACY / MIDNIGHT TYPES
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Configuration for the privacy layer (Midnight integration).
 */
export interface PrivacyConfig {
  /** Midnight network endpoint URL */
  midnightNodeUrl: string;
  /** Midnight network identifier (testnet / mainnet) */
  networkId: string;
  /** Proof generation timeout in milliseconds */
  proofTimeoutMs: number;
  /** Whether to enable selective disclosure features */
  enableSelectiveDisclosure: boolean;
  /** Maximum number of concurrent proof generation tasks */
  maxConcurrentProofs: number;
  /** Logging level for privacy operations */
  logLevel: "debug" | "info" | "warn" | "error";
}

/**
 * Represents an encrypted state entry stored on-chain via Midnight.
 */
export interface EncryptedState {
  /** Unique state identifier */
  stateId: string;
  /** Encrypted data payload (hex-encoded ciphertext) */
  encryptedPayload: string;
  /** State version for optimistic concurrency control */
  version: number;
  /** ZK proof attesting to the validity of the state transition */
  transitionProof: ZKProof;
  /** Unix timestamp (ms) of the last state update */
  updatedAt: number;
}

/**
 * Represents a selective disclosure proof — allows a trader to reveal
 * specific trade details to an auditor without revealing everything.
 */
export interface DisclosureProof {
  /** Unique disclosure identifier */
  disclosureId: string;
  /** The fields being disclosed (e.g., ["traderId", "pairId", "size"]) */
  disclosedFields: string[];
  /** The values of the disclosed fields */
  disclosedValues: Record<string, unknown>;
  /** ZK proof that the disclosed values match the committed data */
  proof: ZKProof;
  /** Address of the entity this disclosure is intended for */
  recipientAddress: string;
  /** Expiry time for the disclosure (Unix timestamp ms) */
  expiresAt: number;
}

// ─────────────────────────────────────────────────────────────────────────────
// CARDANO-SPECIFIC TYPES
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Represents a Cardano UTxO (Unspent Transaction Output).
 */
export interface CardanoUTxO {
  /** Transaction hash that created this UTxO */
  txHash: string;
  /** Output index within the transaction */
  outputIndex: number;
  /** Address that holds this UTxO */
  address: string;
  /** Lovelace amount (1 ADA = 1,000,000 lovelace) */
  lovelace: bigint;
  /** Native tokens attached to this UTxO */
  tokens: TokenAmount[];
  /** Optional datum hash or inline datum */
  datum?: string;
}

/**
 * Represents a native token amount on Cardano.
 */
export interface TokenAmount {
  /** Policy ID of the token */
  policyId: string;
  /** Asset name (hex-encoded) */
  assetName: string;
  /** Token quantity */
  amount: bigint;
}

/**
 * Represents a Cardano transaction to be submitted.
 */
export interface CardanoTransaction {
  /** Serialized transaction CBOR (hex-encoded) */
  txCbor: string;
  /** Transaction hash */
  txHash: string;
  /** Transaction fee in lovelace */
  fee: bigint;
  /** Input UTxOs consumed by this transaction */
  inputs: CardanoUTxO[];
  /** Output UTxOs created by this transaction */
  outputs: CardanoUTxO[];
}
