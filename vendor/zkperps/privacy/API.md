# Privacy Module — API Reference

This module provides the privacy layer powered by Midnight's zero-knowledge capabilities. It handles connection to the Midnight network, shielded order management, selective disclosure for regulatory compliance, and encrypted on-chain state management.

Per [Software requirements](../docs/SRS.md), Section 4.1: "The protocol must protect the confidentiality of order parameters, trader identities, margin balances, open positions."

Per the same document, Section 5.2: "Implements encryption, commitment generation, identity shielding."

Per the same document, Section 6: "Midnight provides the confidential execution environment for the protocol."

---

## midnight_connector.ts — Midnight Network Integration

### MidnightConnector Class

Integration layer with the Midnight sidechain. Handles connection management, contract deployment, and private state queries.

Per [Software requirements](../docs/SRS.md), Section 6.1 (Kachina Framework), Section 6.2 (Compact Language), Section 6.3 (Proof Server).

| Method | Signature | Description |
|--------|-----------|-------------|
| `connectToMidnight` | `() -> Promise<void>` | Establishes connection to Midnight node |
| `deployContract` | `(bytecode, args?) -> Promise<DeployedContract>` | Deploys a Compact smart contract |
| `callContract` | `(address, function, args) -> Promise<ContractCallResult>` | Calls a function on a deployed contract |
| `queryPrivateState` | `(address, stateKey) -> Promise<unknown>` | Queries private contract state |
| `getNodeInfo` | `() -> Promise<MidnightNodeInfo>` | Gets node status information |
| `getConnectionStatus` | `() -> MidnightConnectionStatus` | Returns current connection status |
| `disconnectFromMidnight` | `() -> Promise<void>` | Closes the connection |

### Connection States

`DISCONNECTED` -> `CONNECTING` -> `CONNECTED` -> `RECONNECTING` -> `ERROR`

---

## shielded_pool.ts — Shielded Transaction Pool

### ShieldedPool Class

Orders are shielded (encrypted and committed) before entering the matching engine, and unshielded (decrypted and revealed) after matching for settlement. This ensures order details remain confidential during the matching phase.

| Method | Signature | Description |
|--------|-----------|-------------|
| `initialize` | `() -> Promise<void>` | Initializes pool and loads state |
| `shieldOrder` | `(order) -> Promise<ShieldResult>` | Encrypts and commits an order |
| `unshieldOrder` | `(id, decryptionKey) -> Promise<UnshieldResult>` | Decrypts and reveals an order after matching |
| `getShieldedBalance` | `(traderId) -> Promise<ShieldedBalance>` | Gets shielded order summary for trader |
| `transferShielded` | `(id, oldKey, newKey) -> Promise<ShieldedOrder>` | Re-encrypts with a rotated key |
| `verifyShieldedState` | `(id) -> Promise<boolean>` | Verifies integrity of shielded order |

### Order Shielding Flow

```
Trader -> shieldOrder() -> ShieldedOrder -> Matching Engine -> Match Found
                                                                  |
                            Plaintext Order <- unshieldOrder() <- Settlement
```

---

## selective_disclosure.ts — Regulatory Compliance

Allows traders to reveal specific trade details to authorized auditors without compromising overall trade privacy. Uses ZK proofs to certify that disclosed values match the original commitment.

Per [Software requirements](../docs/SRS.md), Section 2.2: "Selective disclosure of data."

| Function | Signature | Description |
|----------|-----------|-------------|
| `createDisclosureProof` | `(request, privateInputs, nonce) -> Promise<DisclosureResult>` | Creates partial disclosure with ZK proof |
| `verifyDisclosureProof` | `(disclosure, recipientAddr) -> Promise<DisclosureVerificationResult>` | Verifies disclosed values match commitment |
| `revokeDisclosure` | `(id, signature) -> Promise<boolean>` | Revokes a previously created disclosure |
| `getDisclosurePolicy` | `(policyId) -> Promise<DisclosurePolicy or null>` | Retrieves a disclosure policy |
| `listDisclosurePolicies` | `(activeOnly?) -> Promise<DisclosurePolicy[]>` | Lists all available policies |

---

## encrypted_state.ts — Encrypted On-Chain State

Manages encrypted state on the Midnight sidechain with ZK proofs for state transitions. Supports optimistic concurrency via version numbering.

| Function | Signature | Description |
|----------|-----------|-------------|
| `encryptState` | `(plaintext, key, params) -> Promise<EncryptedState>` | Encrypts and stores state on Midnight |
| `decryptState` | `(encrypted, key) -> Promise<PlaintextState>` | Decrypts state with authorized key |
| `updateEncryptedState` | `(stateId, newData, key, params) -> Promise<StateTransitionResult>` | Atomic state update with version check |
| `proveStateTransition` | `(prev, new, operation, key) -> Promise<ZKProof>` | Generates ZK proof of valid transition |
| `queryState` | `(stateId, key?) -> Promise<StateQueryResult>` | Queries state, decrypts if key provided |

### Supported Encryption
- Algorithms: AES-256-GCM, ChaCha20-Poly1305
- Key derivation: HKDF-SHA256, Argon2id
