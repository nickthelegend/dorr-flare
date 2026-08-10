use aiken/collection/list
use cardano/transaction.{OutputReference, Transaction}

/// Inline datum on every vault UTxO: which trader this collateral belongs to.
/// `owner` is the depositor's payment verification-key hash (28 bytes), making
/// deposits attributable and auditable on-chain even though the v1 spend path
/// is operator-custodied.
pub type VaultDatum {
  owner: ByteArray,
}

/// v1 trusted-operator custody: any spend from the vault (withdrawals, PnL
/// settlement, liquidation) must be signed by the dorr operator key.
/// The operator key hash is applied as a script parameter at deploy time.
validator margin_vault(operator: ByteArray) {
  spend(
    _datum: Option<VaultDatum>,
    _redeemer: Data,
    _utxo: OutputReference,
    self: Transaction,
  ) {
    list.has(self.extra_signatories, operator)
  }

  else(_) {
    fail
  }
}
