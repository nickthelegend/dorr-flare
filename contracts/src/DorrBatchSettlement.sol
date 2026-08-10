// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";

import {ContractRegistry} from "@flarenetwork/coston2/ContractRegistry.sol";
import {FtsoV2Interface} from "@flarenetwork/coston2/FtsoV2Interface.sol";

import {DorrVault} from "./DorrVault.sol";
import {ITEEAttestationVerifier} from "./TEEAttestationVerifier.sol";

/// @title DorrBatchSettlement — uniform-price sealed-bid batch settlement on Flare
/// @notice dorr collects orders as sealed (encrypted) commitments, clears a whole
///         epoch at ONE uniform price inside a TEE, and settles here.
///
/// WHY THIS IS MORE THAN AN ANCHOR:
///   The operator does not get to assert a clearing price and have it believed.
///   Before ANY value moves, this contract independently reads the FTSO v2 price
///   feed on-chain and reverts if the submitted clearing price deviates by more
///   than `maxDriftBps`. A malicious operator therefore cannot print a favourable
///   price — Flare's own oracle vetoes it. Combined with:
///     • the TEE attestation gate (the batch was computed by attested code), and
///     • the membership root (which orders were in the epoch — censorship evidence), and
///     • zero-sum PnL enforced by the vault (no drain path),
///   the settlement is verifiable rather than trusted.
contract DorrBatchSettlement is ReentrancyGuard, Ownable {
    DorrVault public immutable vault;
    ITEEAttestationVerifier public teeVerifier;

    /// @notice Max tolerated deviation between the submitted clearing price and FTSO.
    uint256 public maxDriftBps = 200; // 2%

    /// @notice Max age of the FTSO feed for a settlement to be accepted.
    uint64 public maxFeedAge = 300; // seconds

    struct Batch {
        bytes32 membershipRoot; // commitment to the exact sealed order set
        uint256 clearingPrice;  // uniform price, 1e6 = 1.000000 USD
        uint256 ftsoPrice;      // FTSO reference at settlement, normalised to 1e6
        uint64 ftsoTimestamp;
        uint64 settledAt;
        uint32 orderCount;
        bool exists;
    }

    /// @dev epochId => Batch
    mapping(bytes32 => Batch) public batches;
    bytes32[] public epochIndex;

    event BatchSettled(
        bytes32 indexed epochId,
        bytes32 indexed membershipRoot,
        uint256 clearingPrice,
        uint256 ftsoPrice,
        uint256 driftBps,
        uint32 orderCount,
        uint64 settledAt
    );
    event TEEVerifierUpdated(address indexed verifier);
    event RiskParamsUpdated(uint256 maxDriftBps, uint64 maxFeedAge);

    error BatchExists();
    error NotAttested();
    error PriceOutOfBand(uint256 clearingPrice, uint256 ftsoPrice, uint256 driftBps);
    error StaleFeed(uint64 feedTimestamp, uint64 nowTs);
    error ZeroAddress();
    error EmptyBatch();
    error LengthMismatch();

    constructor(address _vault, address _teeVerifier, address _owner) Ownable(_owner) {
        if (_vault == address(0) || _teeVerifier == address(0)) revert ZeroAddress();
        vault = DorrVault(_vault);
        teeVerifier = ITEEAttestationVerifier(_teeVerifier);
    }

    struct BatchInput {
        bytes32 epochId;
        bytes32 membershipRoot;
        uint256 clearingPrice; // 1e6 scale
        bytes21 feedId;        // FTSO v2 feed, e.g. XRP/USD
        uint32 orderCount;
        address[] traders;
        int256[] deltas;       // zero-sum PnL, FXRP base units (6dp)
        bytes attestation;     // TEE quote
    }

    /// @notice Settle one sealed-bid epoch. Payable because the FTSO feed read
    ///         may carry a protocol fee; any surplus is refunded to the caller.
    function settleBatch(BatchInput calldata b) external payable nonReentrant {
        if (batches[b.epochId].exists) revert BatchExists();
        if (b.orderCount == 0) revert EmptyBatch();
        if (b.traders.length != b.deltas.length) revert LengthMismatch();

        // 1. The batch must have been produced by attested TEE code, and the quote
        //    must have been issued for THIS batch (epoch + membership + price), so
        //    an attestation cannot be lifted from one epoch and replayed on another.
        bytes32 payloadHash = batchPayloadHash(
            b.epochId,
            b.membershipRoot,
            b.clearingPrice,
            b.orderCount
        );
        if (!teeVerifier.isTEEAttestedFor(b.attestation, payloadHash)) revert NotAttested();

        // 2. Flare's own oracle independently vets the clearing price.
        (uint256 ftsoPrice, uint64 feedTs) = _ftsoPrice1e6(b.feedId);
        if (block.timestamp > feedTs + maxFeedAge) revert StaleFeed(feedTs, uint64(block.timestamp));

        uint256 driftBps = _driftBps(b.clearingPrice, ftsoPrice);
        if (driftBps > maxDriftBps) revert PriceOutOfBand(b.clearingPrice, ftsoPrice, driftBps);

        // 3. Apply zero-sum PnL. The vault rejects any non-zero-sum set and can
        //    never transfer tokens out, so this cannot drain collateral.
        if (b.traders.length > 0) {
            vault.applyPnl(b.traders, b.deltas);
        }

        // 4. Record the epoch: which orders were in it, and at what single price.
        batches[b.epochId] = Batch({
            membershipRoot: b.membershipRoot,
            clearingPrice: b.clearingPrice,
            ftsoPrice: ftsoPrice,
            ftsoTimestamp: feedTs,
            settledAt: uint64(block.timestamp),
            orderCount: b.orderCount,
            exists: true
        });
        epochIndex.push(b.epochId);

        emit BatchSettled(
            b.epochId,
            b.membershipRoot,
            b.clearingPrice,
            ftsoPrice,
            driftBps,
            b.orderCount,
            uint64(block.timestamp)
        );

        // Refund unused fee.
        uint256 bal = address(this).balance;
        if (bal > 0) {
            (bool ok, ) = msg.sender.call{value: bal}("");
            require(ok, "refund failed");
        }
    }

    // ------------------------------------------------------------------
    // FTSO v2
    // ------------------------------------------------------------------

    /// @notice Read an FTSO v2 feed and normalise it to 1e6 fixed-point.
    function _ftsoPrice1e6(bytes21 feedId) internal returns (uint256 price1e6, uint64 timestamp) {
        FtsoV2Interface ftso = ContractRegistry.getFtsoV2();
        uint256 fee = ftso.calculateFeeById(feedId);
        (uint256 value, int8 decimals, uint64 ts) = ftso.getFeedById{value: fee}(feedId);

        if (decimals >= 0) {
            uint256 d = uint256(uint8(decimals));
            price1e6 = d <= 6 ? value * (10 ** (6 - d)) : value / (10 ** (d - 6));
        } else {
            // negative decimals => value is scaled UP already
            price1e6 = value * (10 ** (6 + uint256(uint8(-decimals))));
        }
        timestamp = ts;
    }

    /// @notice The canonical payload an enclave attests to for a batch. Public so
    ///         the off-chain engine and any auditor derive the identical value.
    function batchPayloadHash(
        bytes32 epochId,
        bytes32 membershipRoot,
        uint256 clearingPrice,
        uint32 orderCount
    ) public pure returns (bytes32) {
        return keccak256(abi.encodePacked(epochId, membershipRoot, clearingPrice, orderCount));
    }

    function _driftBps(uint256 a, uint256 b) internal pure returns (uint256) {
        if (b == 0) return type(uint256).max;
        uint256 diff = a > b ? a - b : b - a;
        return (diff * 10_000) / b;
    }

    /// @notice Public helper so anyone can read what the contract sees.
    function currentFtsoPrice1e6(bytes21 feedId) external payable returns (uint256 price1e6, uint64 timestamp) {
        return _ftsoPrice1e6(feedId);
    }

    // ------------------------------------------------------------------
    // Admin / views
    // ------------------------------------------------------------------

    function setTEEVerifier(address v) external onlyOwner {
        if (v == address(0)) revert ZeroAddress();
        teeVerifier = ITEEAttestationVerifier(v);
        emit TEEVerifierUpdated(v);
    }

    function setRiskParams(uint256 _maxDriftBps, uint64 _maxFeedAge) external onlyOwner {
        maxDriftBps = _maxDriftBps;
        maxFeedAge = _maxFeedAge;
        emit RiskParamsUpdated(_maxDriftBps, _maxFeedAge);
    }

    function epochCount() external view returns (uint256) {
        return epochIndex.length;
    }

    function getBatch(bytes32 epochId) external view returns (Batch memory) {
        return batches[epochId];
    }

    receive() external payable {}
}
