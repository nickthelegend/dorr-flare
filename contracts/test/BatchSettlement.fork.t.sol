// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Test, console2} from "forge-std/Test.sol";
import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {DorrVault} from "../src/DorrVault.sol";
import {DorrBatchSettlement} from "../src/DorrBatchSettlement.sol";
import {TEEAttestationVerifier} from "../src/TEEAttestationVerifier.sol";

contract ForkToken is ERC20 {
    constructor() ERC20("Fork FXRP", "fFXRP") {}
    function decimals() public pure override returns (uint8) { return 6; }
    function mint(address to, uint256 amt) external { _mint(to, amt); }
}

/// Fork tests against LIVE Flare Coston2 — these read the real FTSO v2 oracle
/// through the real ContractRegistry. Run with:
///     forge test --match-contract BatchSettlementForkTest --fork-url coston2
contract BatchSettlementForkTest is Test {
    DorrVault vault;
    DorrBatchSettlement settle;
    TEEAttestationVerifier verifier;
    ForkToken fxrp;

    address owner = address(0xA11CE);
    address alice = address(0xA1);
    address bob = address(0xB0B);

    uint256 teeKey = 0xBEEF;
    bytes32 constant TEE_ID = keccak256("dorr-tee-1");
    bytes32 constant MEASUREMENT = keccak256("dorr-tee-image-v1");

    // FTSO v2 feed id for XRP/USD: 0x01 (crypto) + "XRP/USD" + zero padding = 21 bytes
    bytes21 constant XRP_USD = bytes21(0x015852502f55534400000000000000000000000000);

    function setUp() public {
        // Only meaningful on a Coston2 fork.
        if (block.chainid != 114) return;

        fxrp = new ForkToken();
        verifier = new TEEAttestationVerifier(MEASUREMENT, owner);
        vault = new DorrVault(address(fxrp), owner);
        settle = new DorrBatchSettlement(address(vault), address(verifier), owner);

        vm.startPrank(owner);
        vault.setSettlement(address(settle));
        verifier.registerTEE(TEE_ID, vm.addr(teeKey), MEASUREMENT);
        vm.stopPrank();

        fxrp.mint(alice, 1_000_000_000);
        fxrp.mint(bob, 1_000_000_000);
        _deposit(alice, 500_000_000);
        _deposit(bob, 500_000_000);

        vm.deal(address(this), 10 ether);
    }

    function _deposit(address who, uint256 amt) internal {
        vm.startPrank(who);
        fxrp.approve(address(vault), amt);
        vault.deposit(amt);
        vm.stopPrank();
    }

    function _quote(bytes32 payloadHash, uint256 nonce) internal view returns (bytes memory) {
        bytes32 digest = keccak256(abi.encodePacked(TEE_ID, nonce, MEASUREMENT, payloadHash));
        bytes32 ethDigest = keccak256(abi.encodePacked("\x19Ethereum Signed Message:\n32", digest));
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(teeKey, ethDigest);
        return abi.encodePacked(TEE_ID, nonce, payloadHash, r, s, v);
    }

    function _input(bytes32 epochId, uint256 clearingPrice)
        internal
        view
        returns (DorrBatchSettlement.BatchInput memory b)
    {
        address[] memory t = new address[](2);
        t[0] = alice; t[1] = bob;
        int256[] memory d = new int256[](2);
        d[0] = 5_000_000; d[1] = -5_000_000; // zero-sum

        bytes32 root = keccak256(abi.encodePacked("membership", epochId));
        bytes32 payload = settle.batchPayloadHash(epochId, root, clearingPrice, uint32(2));

        b = DorrBatchSettlement.BatchInput({
            epochId: epochId,
            membershipRoot: root,
            clearingPrice: clearingPrice,
            feedId: XRP_USD,
            orderCount: 2,
            traders: t,
            deltas: d,
            attestation: _quote(payload, 1)
        });
    }

    /// Reads the REAL XRP/USD price from the live FTSO v2 oracle on Coston2.
    function test_Fork_ReadsLiveFtsoPrice() public {
        if (block.chainid != 114) return;
        (uint256 price, uint64 ts) = settle.currentFtsoPrice1e6{value: 1 ether}(XRP_USD);
        console2.log("live FTSO XRP/USD (1e6):", price);
        console2.log("feed timestamp:", ts);
        assertGt(price, 0, "FTSO returned zero price");
        assertLt(price, 100_000_000, "sanity: XRP under $100");
        assertGt(ts, 0);
    }

    /// An honest batch (clearing price at the oracle) settles and moves PnL.
    function test_Fork_HonestBatchSettles() public {
        if (block.chainid != 114) return;
        (uint256 ftso, ) = settle.currentFtsoPrice1e6{value: 1 ether}(XRP_USD);

        bytes32 epochId = keccak256("epoch-honest");
        DorrBatchSettlement.BatchInput memory b = _input(epochId, ftso);

        settle.settleBatch{value: 1 ether}(b);

        DorrBatchSettlement.Batch memory rec = settle.getBatch(epochId);
        assertTrue(rec.exists);
        assertEq(rec.clearingPrice, ftso);
        assertEq(rec.orderCount, 2);

        (uint256 aBal,,) = vault.accountOf(alice);
        (uint256 bBal,,) = vault.accountOf(bob);
        assertEq(aBal, 505_000_000);
        assertEq(bBal, 495_000_000);
        assertTrue(vault.isSolvent());
    }

    /// THE KEY GUARANTEE: a manipulated clearing price is rejected by the chain
    /// itself, because Flare's FTSO oracle disagrees with it. No value moves.
    function test_Fork_ManipulatedClearingPriceIsRejected() public {
        if (block.chainid != 114) return;
        (uint256 ftso, ) = settle.currentFtsoPrice1e6{value: 1 ether}(XRP_USD);

        // Operator tries to settle 50% away from the true oracle price.
        uint256 badPrice = (ftso * 150) / 100;
        bytes32 epochId = keccak256("epoch-manipulated");
        DorrBatchSettlement.BatchInput memory b = _input(epochId, badPrice);

        vm.expectRevert(); // PriceOutOfBand
        settle.settleBatch{value: 1 ether}(b);

        // Nothing settled, no PnL applied.
        assertFalse(settle.getBatch(epochId).exists);
        (uint256 aBal,,) = vault.accountOf(alice);
        assertEq(aBal, 500_000_000);
    }

    /// A batch without a valid enclave attestation cannot settle.
    function test_Fork_UnattestedBatchRejected() public {
        if (block.chainid != 114) return;
        (uint256 ftso, ) = settle.currentFtsoPrice1e6{value: 1 ether}(XRP_USD);

        bytes32 epochId = keccak256("epoch-unattested");
        DorrBatchSettlement.BatchInput memory b = _input(epochId, ftso);
        b.attestation = _quoteWithKey(0xD00D, b); // signed by a non-enclave key

        vm.expectRevert(DorrBatchSettlement.NotAttested.selector);
        settle.settleBatch{value: 1 ether}(b);
    }

    function _quoteWithKey(uint256 key, DorrBatchSettlement.BatchInput memory b)
        internal
        view
        returns (bytes memory)
    {
        bytes32 payload = settle.batchPayloadHash(b.epochId, b.membershipRoot, b.clearingPrice, b.orderCount);
        bytes32 digest = keccak256(abi.encodePacked(TEE_ID, uint256(1), MEASUREMENT, payload));
        bytes32 ethDigest = keccak256(abi.encodePacked("\x19Ethereum Signed Message:\n32", digest));
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(key, ethDigest);
        return abi.encodePacked(TEE_ID, uint256(1), payload, r, s, v);
    }

    /// The same epoch cannot be settled twice.
    function test_Fork_EpochCannotSettleTwice() public {
        if (block.chainid != 114) return;
        (uint256 ftso, ) = settle.currentFtsoPrice1e6{value: 1 ether}(XRP_USD);
        bytes32 epochId = keccak256("epoch-once");

        // Build both inputs BEFORE expectRevert — _input() itself makes an external
        // call, which would otherwise consume the expectRevert.
        DorrBatchSettlement.BatchInput memory first = _input(epochId, ftso);
        DorrBatchSettlement.BatchInput memory second = _input(epochId, ftso);

        settle.settleBatch{value: 1 ether}(first);

        vm.expectRevert(DorrBatchSettlement.BatchExists.selector);
        settle.settleBatch{value: 1 ether}(second);
    }

    receive() external payable {}
}
