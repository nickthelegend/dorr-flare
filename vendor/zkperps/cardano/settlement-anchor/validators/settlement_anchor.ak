use cardano/transaction.{OutputReference, Transaction}

/// Datum written by off-chain code: UTF-8 settlement id, 32-byte order commitment, optional midnight / proof id bytes.
pub type AnchorDatum {
  settlement_id: ByteArray,
  order_commitment: ByteArray,
  midnight_tx: ByteArray,
}

/// Locks funds at the script with structured datum. **Anyone can spend** (`True`) — tighten before production.
validator settlement_anchor {
  spend(_datum: Option<AnchorDatum>, _redeemer: Data, _utxo: OutputReference, _self: Transaction) {
    True
  }
}
