// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Test} from "forge-std/Test.sol";
import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {DorrVault} from "../src/DorrVault.sol";
import {DorrBatchSettlement} from "../src/DorrBatchSettlement.sol";
import {TEEAttestationVerifier} from "../src/TEEAttestationVerifier.sol";

contract TestToken is ERC20 {
    constructor() ERC20("Test FXRP", "tFXRP") {}
    function decimals() public pure override returns (uint8) { return 6; }
    function mint(address to, uint256 amt) external { _mint(to, amt); }
}

/// The property this file exists for: **collateral backing an open position
/// cannot be withdrawn.** The vault always had `lockMargin`, but nothing could
/// reach it — `onlySettlement` with no passthrough meant the operator tracked
/// margin off-chain while the chain let a trader withdraw the same funds.
contract MarginCustodyTest is Test {
    DorrVault vault;
    DorrBatchSettlement settlement;
    TEEAttestationVerifier verifier;
    TestToken fxrp;

    address owner = address(0xA11CE);
    address keeper = address(0x4EE9);
    address alice = address(0xA1);
    address attacker = address(0xBAD);

    function setUp() public {
        fxrp = new TestToken();
        vault = new DorrVault(address(fxrp), owner);
        verifier = new TEEAttestationVerifier(bytes32(uint256(1)), owner);
        settlement = new DorrBatchSettlement(address(vault), address(verifier), owner);

        vm.prank(owner);
        vault.setSettlement(address(settlement));

        fxrp.mint(alice, 1_000e6);
        vm.startPrank(alice);
        fxrp.approve(address(vault), type(uint256).max);
        vault.deposit(1_000e6);
        vm.stopPrank();
    }

    function test_LockedMarginCannotBeWithdrawn() public {
        vm.prank(owner);
        settlement.lockMargin(alice, 400e6);

        (uint256 balance, uint256 locked, uint256 free) = vault.accountOf(alice);
        assertEq(balance, 1_000e6);
        assertEq(locked, 400e6);
        assertEq(free, 600e6);

        // The whole point: the chain refuses to release margin behind a position.
        vm.prank(alice);
        vm.expectRevert(DorrVault.InsufficientFree.selector);
        vault.withdraw(700e6);

        // …but the free remainder is still hers.
        vm.prank(alice);
        vault.withdraw(600e6);
        assertEq(fxrp.balanceOf(alice), 600e6);
    }

    function test_ReleasedMarginBecomesWithdrawableAgain() public {
        vm.startPrank(owner);
        settlement.lockMargin(alice, 400e6);
        settlement.releaseMargin(alice, 400e6);
        vm.stopPrank();

        vm.prank(alice);
        vault.withdraw(1_000e6);
        assertEq(fxrp.balanceOf(alice), 1_000e6);
    }

    function test_CannotLockMoreThanFree() public {
        vm.prank(owner);
        vm.expectRevert(DorrVault.InsufficientFree.selector);
        settlement.lockMargin(alice, 1_001e6);
    }

    function test_OnlyKeeperOrOwnerCanLock() public {
        vm.prank(attacker);
        vm.expectRevert(DorrBatchSettlement.NotKeeper.selector);
        settlement.lockMargin(alice, 100e6);

        vm.prank(attacker);
        vm.expectRevert(DorrBatchSettlement.NotKeeper.selector);
        settlement.releaseMargin(alice, 100e6);
    }

    function test_KeeperCanBeRotatedWithoutTransferringOwnership() public {
        vm.prank(owner);
        settlement.setKeeper(keeper);

        vm.prank(keeper);
        settlement.lockMargin(alice, 100e6);
        (, uint256 locked, ) = vault.accountOf(alice);
        assertEq(locked, 100e6);

        // ownership is unchanged
        assertEq(settlement.owner(), owner);
    }

    function test_LockingCannotMoveValue() public {
        uint256 reservesBefore = fxrp.balanceOf(address(vault));
        vm.startPrank(owner);
        settlement.lockMargin(alice, 500e6);
        settlement.releaseMargin(alice, 200e6);
        vm.stopPrank();

        // Reserves untouched and the depositor's balance untouched — locking only
        // ever moves value between "free" and "locked" for the SAME account.
        assertEq(fxrp.balanceOf(address(vault)), reservesBefore);
        (uint256 balance, uint256 locked, ) = vault.accountOf(alice);
        assertEq(balance, 1_000e6);
        assertEq(locked, 300e6);
    }

    function test_BatchLockAndRelease() public {
        address bob = address(0xB0B);
        fxrp.mint(bob, 500e6);
        vm.startPrank(bob);
        fxrp.approve(address(vault), type(uint256).max);
        vault.deposit(500e6);
        vm.stopPrank();

        address[] memory traders = new address[](2);
        uint256[] memory amounts = new uint256[](2);
        traders[0] = alice; amounts[0] = 100e6;
        traders[1] = bob;   amounts[1] = 200e6;

        vm.prank(owner);
        settlement.lockMarginBatch(traders, amounts);

        (, uint256 aLocked, ) = vault.accountOf(alice);
        (, uint256 bLocked, ) = vault.accountOf(bob);
        assertEq(aLocked, 100e6);
        assertEq(bLocked, 200e6);

        vm.prank(owner);
        settlement.releaseMarginBatch(traders, amounts);
        (, aLocked, ) = vault.accountOf(alice);
        (, bLocked, ) = vault.accountOf(bob);
        assertEq(aLocked, 0);
        assertEq(bLocked, 0);
    }

    function test_BatchRejectsMismatchedLengths() public {
        address[] memory traders = new address[](2);
        uint256[] memory amounts = new uint256[](1);
        vm.prank(owner);
        vm.expectRevert(DorrBatchSettlement.LengthMismatch.selector);
        settlement.lockMarginBatch(traders, amounts);
    }

    /// Whatever is locked, a withdrawal can never exceed balance − locked.
    /// (Zero amounts are excluded: the vault rejects them with `ZeroAmount` by
    /// design, which is orthogonal to the property under test.)
    function testFuzz_WithdrawNeverExceedsFreeUnderLocking(uint96 lockAmt, uint96 wantAmt) public {
        uint256 lock = bound(uint256(lockAmt), 1, 1_000e6);
        vm.prank(owner);
        settlement.lockMargin(alice, lock);

        uint256 want = bound(uint256(wantAmt), 1, 2_000e6);
        uint256 free = 1_000e6 - lock;

        vm.prank(alice);
        if (want > free) {
            vm.expectRevert(DorrVault.InsufficientFree.selector);
            vault.withdraw(want);
        } else {
            vault.withdraw(want);
            assertEq(fxrp.balanceOf(alice), want);
        }
    }
}
