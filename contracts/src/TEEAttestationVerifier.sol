// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import {MessageHashUtils} from "@openzeppelin/contracts/utils/cryptography/MessageHashUtils.sol";

interface ITEEAttestationVerifier {
    function isTEEAttested(bytes calldata attestation) external view returns (bool);

    function isTEEAttestedFor(bytes calldata attestation, bytes32 payloadHash)
        external
        view
        returns (bool);
}

/// @title TEEAttestationVerifier
/// @notice Verifies that a dorr batch was produced by an enclave whose identity
///         and image measurement were registered on-chain.
///
/// Attestation wire format (tight-packed):
///     bytes32 teeId | uint256 nonce | bytes32 payloadHash | bytes65 signature
///
/// The signature is an EIP-191 ("\x19Ethereum Signed Message:\n32") signature by
/// the enclave key over:
///     keccak256(teeId, nonce, measurement, payloadHash)
///
/// `payloadHash` binds the quote to a SPECIFIC batch (epoch + membership root +
/// clearing price). Without it an attestation could be lifted from one batch and
/// replayed on another — which is exactly the gap in the reference implementation
/// this was derived from. Batch-level replay is additionally impossible because
/// DorrBatchSettlement rejects an epochId that has already settled.
///
/// PRODUCTION PATH (documented honestly): a full Flare Confidential Compute
/// deployment verifies the GCP Confidential Space OIDC token and vTPM PCR quote
/// on-chain (flare-foundation/flare-vtpm-attestation). This contract verifies the
/// enclave's registered signing key and image measurement, which is the part that
/// gates value movement here; the hardware quote chain is the next step.
contract TEEAttestationVerifier is Ownable {
    /// @notice Registered enclave identities.
    mapping(bytes32 => bool) public registeredTEEs;

    /// @notice Enclave signing key (address form) per identity.
    mapping(bytes32 => address) public teeSigner;

    /// @notice Expected container/image measurement.
    bytes32 public expectedMeasurement;

    event TEERegistered(bytes32 indexed teeId, address signer, bytes32 measurement);
    event TEERevoked(bytes32 indexed teeId);
    event MeasurementUpdated(bytes32 measurement);

    error TEEIdZero();
    error AlreadyRegistered();
    error NotRegistered();
    error MeasurementMismatch();

    constructor(bytes32 _expectedMeasurement, address _owner) Ownable(_owner) {
        expectedMeasurement = _expectedMeasurement;
    }

    function registerTEE(bytes32 teeId, address signer, bytes32 measurement) external onlyOwner {
        if (teeId == bytes32(0)) revert TEEIdZero();
        if (registeredTEEs[teeId]) revert AlreadyRegistered();
        if (measurement != expectedMeasurement) revert MeasurementMismatch();
        registeredTEEs[teeId] = true;
        teeSigner[teeId] = signer;
        emit TEERegistered(teeId, signer, measurement);
    }

    function revokeTEE(bytes32 teeId) external onlyOwner {
        if (!registeredTEEs[teeId]) revert NotRegistered();
        registeredTEEs[teeId] = false;
        emit TEERevoked(teeId);
    }

    function setExpectedMeasurement(bytes32 m) external onlyOwner {
        expectedMeasurement = m;
        emit MeasurementUpdated(m);
    }

    // ------------------------------------------------------------------
    // Verification
    // ------------------------------------------------------------------

    /// @notice Verify a quote without binding it to a payload.
    function isTEEAttested(bytes calldata attestation) external view returns (bool) {
        (bool ok, , , bytes32 payloadHash) = _parse(attestation);
        if (!ok) return false;
        return _verify(attestation, payloadHash);
    }

    /// @notice Verify a quote AND that it was issued for `payloadHash`.
    function isTEEAttestedFor(bytes calldata attestation, bytes32 payloadHash)
        external
        view
        returns (bool)
    {
        (bool ok, , , bytes32 embedded) = _parse(attestation);
        if (!ok) return false;
        if (embedded != payloadHash) return false;
        return _verify(attestation, payloadHash);
    }

    function _parse(bytes calldata a)
        internal
        pure
        returns (bool ok, bytes32 teeId, uint256 nonce, bytes32 payloadHash)
    {
        if (a.length != 32 + 32 + 32 + 65) return (false, bytes32(0), 0, bytes32(0));
        teeId = bytes32(a[0:32]);
        nonce = uint256(bytes32(a[32:64]));
        payloadHash = bytes32(a[64:96]);
        ok = true;
    }

    function _verify(bytes calldata a, bytes32 payloadHash) internal view returns (bool) {
        (, bytes32 teeId, uint256 nonce, ) = _parse(a);
        if (!registeredTEEs[teeId]) return false;
        address signer = teeSigner[teeId];
        if (signer == address(0)) return false;

        bytes32 digest = keccak256(abi.encodePacked(teeId, nonce, expectedMeasurement, payloadHash));
        bytes32 ethDigest = MessageHashUtils.toEthSignedMessageHash(digest);

        (address recovered, ECDSA.RecoverError err, ) = ECDSA.tryRecover(ethDigest, a[96:161]);
        if (err != ECDSA.RecoverError.NoError) return false;
        return recovered == signer;
    }

    /// @notice The digest an enclave must sign for a given payload. Exposed so the
    ///         off-chain enclave and any auditor compute the identical value.
    function attestationDigest(bytes32 teeId, uint256 nonce, bytes32 payloadHash)
        external
        view
        returns (bytes32)
    {
        return keccak256(abi.encodePacked(teeId, nonce, expectedMeasurement, payloadHash));
    }
}
