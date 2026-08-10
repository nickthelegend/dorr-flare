// ─────────────────────────────────────────────────────────────────────────────
// TRADING CONSTANTS
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Maximum leverage multiplier allowed for any position.
 * Higher leverage increases both potential returns and liquidation risk.
 */
export const MAX_LEVERAGE = 20;

/**
 * Minimum leverage multiplier (no leverage = spot-equivalent).
 */
export const MIN_LEVERAGE = 1;

/**
 * Minimum margin deposit required to open any position (in quote asset units).
 * This is an absolute floor; pair-specific minimums may be higher.
 */
export const MIN_MARGIN = 10;

/**
 * Maximum margin deposit allowed per position (in quote asset units).
 * Prevents concentration risk.
 */
export const MAX_MARGIN = 1_000_000;

/**
 * Default time-to-live for orders in milliseconds (5 minutes).
 * Orders are automatically expired after this duration if not filled.
 */
export const DEFAULT_ORDER_TTL_MS = 5 * 60 * 1000;

/**
 * Maximum time-to-live for orders in milliseconds (24 hours).
 */
export const MAX_ORDER_TTL_MS = 24 * 60 * 60 * 1000;

/**
 * Trading fee rate as a decimal (0.1% = 0.001).
 * Applied to both maker and taker sides of a trade.
 */
export const TRADING_FEE_RATE = 0.001;

/**
 * Maker fee discount rate multiplier (makers pay 50% of the base fee).
 */
export const MAKER_FEE_DISCOUNT = 0.5;

// ─────────────────────────────────────────────────────────────────────────────
// MARGIN & LIQUIDATION CONSTANTS
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Initial margin ratio — minimum margin required as a fraction of position value.
 * For 20x leverage: 1/20 = 0.05 (5%).
 */
export const INITIAL_MARGIN_RATIO = 0.05;

/**
 * Maintenance margin ratio — if margin falls below this, liquidation is triggered.
 * Set at 0.5% of position value.
 */
export const MAINTENANCE_MARGIN_RATIO = 0.005;

/**
 * Liquidation penalty rate applied when a position is forcefully closed.
 * Deducted from the remaining margin and added to the insurance fund.
 */
export const LIQUIDATION_PENALTY_RATE = 0.02;

// ─────────────────────────────────────────────────────────────────────────────
// FUNDING RATE CONSTANTS
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Funding rate interval in milliseconds (8 hours).
 * Funding payments are exchanged between longs and shorts at this interval.
 */
export const FUNDING_INTERVAL_MS = 8 * 60 * 60 * 1000;

/**
 * Maximum absolute funding rate per interval (capped at 0.75%).
 */
export const MAX_FUNDING_RATE = 0.0075;

/**
 * Dampening factor applied to raw funding rate calculation.
 * Reduces volatility in funding rate swings.
 */
export const FUNDING_DAMPENING_FACTOR = 0.1;

// ─────────────────────────────────────────────────────────────────────────────
// SETTLEMENT CONSTANTS
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Delay in milliseconds before a matched trade is settled on-chain.
 * Allows time for finality and ensures proof verification is complete.
 */
export const SETTLEMENT_DELAY_MS = 30_000;

/**
 * Maximum number of trades to batch into a single settlement transaction.
 */
export const MAX_BATCH_SETTLEMENT_SIZE = 50;

/**
 * Number of Cardano block confirmations required before a settlement
 * is considered final.
 */
export const REQUIRED_CONFIRMATIONS = 6;

/**
 * Maximum transaction fee budget for settlement in lovelace.
 * Transactions exceeding this budget are rejected.
 */
export const MAX_TX_FEE_LOVELACE = 5_000_000n;

// ─────────────────────────────────────────────────────────────────────────────
// ZK PROOF CONSTANTS
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Timeout for ZK proof generation in milliseconds (30 seconds).
 * If proof generation takes longer, the operation is aborted.
 */
export const PROOF_GENERATION_TIMEOUT_MS = 30_000;

/**
 * Timeout for proof verification in milliseconds (5 seconds).
 * Verification should be fast; a timeout indicates an issue.
 */
export const PROOF_VERIFICATION_TIMEOUT_MS = 5_000;

/**
 * Maximum number of concurrent proof generation tasks.
 * Bounded by CPU/memory resources.
 */
export const MAX_CONCURRENT_PROOFS = 4;

/**
 * Maximum size of serialized proof data in bytes (1 MB).
 */
export const MAX_PROOF_SIZE_BYTES = 1_048_576;

// ─────────────────────────────────────────────────────────────────────────────
// MIDNIGHT / PRIVACY CONSTANTS
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Default Midnight testnet node URL.
 */
export const DEFAULT_MIDNIGHT_NODE_URL = "wss://testnet.midnight.network";

/**
 * Network identifier for Midnight testnet.
 */
export const MIDNIGHT_TESTNET_NETWORK_ID = "midnight-testnet";

/**
 * Network identifier for Midnight mainnet.
 */
export const MIDNIGHT_MAINNET_NETWORK_ID = "midnight-mainnet";

/**
 * Default TTL for selective disclosure proofs in milliseconds (7 days).
 */
export const DISCLOSURE_DEFAULT_TTL_MS = 7 * 24 * 60 * 60 * 1000;

// ─────────────────────────────────────────────────────────────────────────────
// SUPPORTED TRADING PAIRS
// ─────────────────────────────────────────────────────────────────────────────

/**
 * List of supported trading pair identifiers at launch.
 * Additional pairs may be added through governance in future versions.
 */
export const SUPPORTED_PAIRS: readonly string[] = [
  "ADA-USD",
  "BTC-USD",
  "ETH-USD",
  "SOL-USD",
  "DOT-USD",
] as const;

// ─────────────────────────────────────────────────────────────────────────────
// CARDANO CONSTANTS
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Number of lovelace per ADA (1 ADA = 1,000,000 lovelace).
 */
export const LOVELACE_PER_ADA = 1_000_000n;

/**
 * Minimum UTxO value required by the Cardano protocol (approximately 1 ADA).
 */
export const MIN_UTXO_LOVELACE = 1_000_000n;

/**
 * Default Cardano network for development (preprod testnet).
 */
export const DEFAULT_CARDANO_NETWORK = "preprod";
