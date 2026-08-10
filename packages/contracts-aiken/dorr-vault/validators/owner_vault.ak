use aiken/collection/list
use cardano/transaction.{OutputReference, Transaction}

/// Inline datum on every non-custodial vault UTxO: the depositor's payment
/// verification-key hash (28 bytes). The funds belong to `owner` and only
/// `owner` can move them.
pub type OwnerDatum {
  owner: ByteArray,
}

/// Non-custodial margin vault: a deposit can be spent ONLY by the depositor
/// (the `owner` in its datum). The operator — or anyone else — can never move,
/// seize, or block a user's collateral. This removes custody trust entirely:
/// your deposit is self-custodied on-chain, reclaimable with your own key even
/// if the operator vanishes or turns malicious.
validator owner_vault {
  spend(
    datum: Option<OwnerDatum>,
    _redeemer: Data,
    _utxo: OutputReference,
    self: Transaction,
  ) {
    expect Some(OwnerDatum { owner }) = datum
    list.has(self.extra_signatories, owner)
  }

  else(_) {
    fail
  }
}
