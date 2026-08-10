// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Test} from "forge-std/Test.sol";
import {TEEAttestationVerifier} from "../src/TEEAttestationVerifier.sol";

contract TEEAttestationTest is Test {
    TEEAttestationVerifier verifier;

    address owner = address(0xA11CE);
    uint256 teeKey = 0xBEEF; // enclave signing key
    address teeAddr;

    bytes32 constant TEE_ID = keccak256("dorr-tee-1");
    bytes32 constant MEASUREMENT = keccak256("dorr-tee-image-v1");

    function setUp() public {
        teeAddr = vm.addr(teeKey);
        verifier = new TEEAttestationVerifier(MEASUREMENT, owner);
        vm.prank(owner);
        verifier.registerTEE(TEE_ID, teeAddr, MEASUREMENT);
    }

    /// Build a quote exactly as the off-chain enclave does.
    function _quote(uint256 signerKey, bytes32 teeId, uint256 nonce, bytes32 payloadHash)
        internal
        view
        returns (bytes memory)
    {
        bytes32 digest = keccak256(abi.encodePacked(teeId, nonce, verifier.expectedMeasurement(), payloadHash));
        bytes32 ethDigest = keccak256(abi.encodePacked("\x19Ethereum Signed Message:\n32", digest));
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(signerKey, ethDigest);
        return abi.encodePacked(teeId, nonce, payloadHash, r, s, v);
    }

    function test_ValidQuoteVerifies() public view {
        bytes32 payload = keccak256("epoch-1");
        bytes memory q = _quote(teeKey, TEE_ID, 1, payload);
        assertTrue(verifier.isTEEAttested(q));
        assertTrue(verifier.isTEEAttestedFor(q, payload));
    }

    /// The digest the contract publishes must match what the enclave signs —
    /// this is the exact mismatch (sha256 vs keccak256) that made the reference
    /// implementation's attestations unverifiable on-chain.
    function test_PublishedDigestMatchesSignedDigest() public view {
        bytes32 payload = keccak256("epoch-1");
        bytes32 onchain = verifier.attestationDigest(TEE_ID, 7, payload);
        bytes32 offchain = keccak256(abi.encodePacked(TEE_ID, uint256(7), MEASUREMENT, payload));
        assertEq(onchain, offchain);
    }

    function test_QuoteFromUnregisteredTEERejected() public view {
        bytes32 payload = keccak256("epoch-1");
        bytes memory q = _quote(teeKey, keccak256("other-tee"), 1, payload);
        assertFalse(verifier.isTEEAttested(q));
    }

    function test_QuoteSignedByWrongKeyRejected() public view {
        bytes32 payload = keccak256("epoch-1");
        bytes memory q = _quote(0xD00D, TEE_ID, 1, payload); // not the enclave key
        assertFalse(verifier.isTEEAttested(q));
    }

    /// A quote issued for epoch A must not be usable for epoch B.
    function test_AttestationCannotBeReplayedOnAnotherBatch() public view {
        bytes32 payloadA = keccak256("epoch-A");
        bytes32 payloadB = keccak256("epoch-B");
        bytes memory q = _quote(teeKey, TEE_ID, 1, payloadA);

        assertTrue(verifier.isTEEAttestedFor(q, payloadA));
        assertFalse(verifier.isTEEAttestedFor(q, payloadB)); // bound to A only
    }

    function test_RevokedTEERejected() public {
        bytes32 payload = keccak256("epoch-1");
        bytes memory q = _quote(teeKey, TEE_ID, 1, payload);
        assertTrue(verifier.isTEEAttested(q));

        vm.prank(owner);
        verifier.revokeTEE(TEE_ID);
        assertFalse(verifier.isTEEAttested(q));
    }

    function test_MalformedQuoteRejected() public view {
        assertFalse(verifier.isTEEAttested(hex"deadbeef"));
        assertFalse(verifier.isTEEAttested(""));
    }

    function test_WrongMeasurementCannotRegister() public {
        vm.prank(owner);
        vm.expectRevert(TEEAttestationVerifier.MeasurementMismatch.selector);
        verifier.registerTEE(keccak256("tee-2"), teeAddr, keccak256("other-image"));
    }
}
