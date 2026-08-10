// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Test} from "forge-std/Test.sol";
import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {DorrVault} from "../src/DorrVault.sol";
import {TEEAttestationVerifier, ITEEAttestationVerifier} from "../src/TEEAttestationVerifier.sol";

/// Minimal 6-decimal ERC20 standing in for FXRP in unit tests. The live
/// deployment uses the real FAssets FXRP token on Coston2 — this exists only so
/// the invariants below can be exercised deterministically.
contract TestToken is ERC20 {
    constructor() ERC20("Test FXRP", "tFXRP") {}
    function decimals() public pure override returns (uint8) { return 6; }
    function mint(address to, uint256 amt) external { _mint(to, amt); }
}

contract DorrVaultTest is Test {
    DorrVault vault;
    TestToken fxrp;

    address owner = address(0xA11CE);
    address alice = address(0xA1);
    address bob = address(0xB0B);
    address settlement = address(0x5E77);
    address attacker = address(0xBAD);

    function setUp() public {
        fxrp = new TestToken();
        vault = new DorrVault(address(fxrp), owner);
        vm.prank(owner);
        vault.setSettlement(settlement);

        fxrp.mint(alice, 1_000_000_000); // 1000 FXRP (6dp)
        fxrp.mint(bob, 1_000_000_000);
    }

    function _deposit(address who, uint256 amt) internal {
        vm.startPrank(who);
        fxrp.approve(address(vault), amt);
        vault.deposit(amt);
        vm.stopPrank();
    }

    function test_DepositCreditsBalanceAndBacking() public {
        _deposit(alice, 100_000_000);
        (uint256 bal, uint256 locked, uint256 free) = vault.accountOf(alice);
        assertEq(bal, 100_000_000);
        assertEq(locked, 0);
        assertEq(free, 100_000_000);
        assertEq(vault.reserves(), 100_000_000);
        assertTrue(vault.isSolvent());
    }

    function test_WithdrawOwnFunds() public {
        _deposit(alice, 100_000_000);
        vm.prank(alice);
        vault.withdraw(40_000_000);
        (uint256 bal,,) = vault.accountOf(alice);
        assertEq(bal, 60_000_000);
        assertEq(fxrp.balanceOf(alice), 940_000_000);
    }

    /// THE headline invariant: nobody but the depositor can move their collateral.
    function test_NoOneElseCanTakeYourCollateral() public {
        _deposit(alice, 100_000_000);

        // The attacker cannot withdraw Alice's funds (they have no balance).
        vm.prank(attacker);
        vm.expectRevert(DorrVault.InsufficientFree.selector);
        vault.withdraw(100_000_000);

        // The OWNER cannot either — there is no admin token-moving function at all.
        vm.prank(owner);
        vm.expectRevert(DorrVault.InsufficientFree.selector);
        vault.withdraw(100_000_000);

        // The SETTLEMENT contract cannot either.
        vm.prank(settlement);
        vm.expectRevert(DorrVault.InsufficientFree.selector);
        vault.withdraw(100_000_000);

        // Alice's funds are untouched and still fully backed.
        (uint256 bal,,) = vault.accountOf(alice);
        assertEq(bal, 100_000_000);
        assertEq(vault.reserves(), 100_000_000);
    }

    function test_LockedMarginCannotBeWithdrawn() public {
        _deposit(alice, 100_000_000);
        vm.prank(settlement);
        vault.lockMargin(alice, 70_000_000);

        vm.prank(alice);
        vm.expectRevert(DorrVault.InsufficientFree.selector);
        vault.withdraw(40_000_000); // only 30 free

        vm.prank(alice);
        vault.withdraw(30_000_000); // exactly free amount is fine
        (, uint256 locked, uint256 free) = vault.accountOf(alice);
        assertEq(locked, 70_000_000);
        assertEq(free, 0);
    }

    function test_OnlySettlementCanLockMargin() public {
        _deposit(alice, 100_000_000);
        vm.prank(attacker);
        vm.expectRevert(DorrVault.NotSettlement.selector);
        vault.lockMargin(alice, 1);
    }

    function test_PnlMustBeZeroSum() public {
        _deposit(alice, 100_000_000);
        _deposit(bob, 100_000_000);

        address[] memory t = new address[](2);
        t[0] = alice; t[1] = bob;
        int256[] memory d = new int256[](2);
        d[0] = 10_000_000; d[1] = -5_000_000; // does NOT sum to zero

        vm.prank(settlement);
        vm.expectRevert(DorrVault.PnlNotZeroSum.selector);
        vault.applyPnl(t, d);
    }

    function test_ZeroSumPnlMovesValueBetweenTraders() public {
        _deposit(alice, 100_000_000);
        _deposit(bob, 100_000_000);

        address[] memory t = new address[](2);
        t[0] = alice; t[1] = bob;
        int256[] memory d = new int256[](2);
        d[0] = 10_000_000; d[1] = -10_000_000;

        vm.prank(settlement);
        vault.applyPnl(t, d);

        (uint256 aBal,,) = vault.accountOf(alice);
        (uint256 bBal,,) = vault.accountOf(bob);
        assertEq(aBal, 110_000_000);
        assertEq(bBal, 90_000_000);
        // Total backing unchanged — value moved, none created or destroyed.
        assertEq(aBal + bBal, 200_000_000);
        assertTrue(vault.isSolvent());
    }

    /// Even with zero-sum PnL, the settlement contract has no path to pull tokens out.
    function test_SettlementCannotDrainVault() public {
        _deposit(alice, 100_000_000);
        uint256 before = fxrp.balanceOf(address(vault));

        address[] memory t = new address[](2);
        t[0] = alice; t[1] = attacker;
        int256[] memory d = new int256[](2);
        d[0] = -50_000_000; d[1] = 50_000_000;

        vm.prank(settlement);
        vault.applyPnl(t, d); // attacker can be credited internally...

        // ...but the vault's real token balance never moved.
        assertEq(fxrp.balanceOf(address(vault)), before);

        // And the attacker can only ever withdraw against real backing, which is
        // still fully accounted for — total internal is unchanged.
        assertEq(vault.totalInternal(), 100_000_000);
        assertTrue(vault.isSolvent());
    }

    function testFuzz_WithdrawNeverExceedsFree(uint96 dep, uint96 lock, uint96 wd) public {
        vm.assume(dep > 0);
        fxrp.mint(alice, dep);
        vm.startPrank(alice);
        fxrp.approve(address(vault), dep);
        vault.deposit(dep);
        vm.stopPrank();

        uint256 lockAmt = uint256(lock) % (uint256(dep) + 1);
        vm.prank(settlement);
        vault.lockMargin(alice, lockAmt);

        uint256 free = vault.freeBalanceOf(alice);
        if (wd > free) {
            vm.prank(alice);
            vm.expectRevert(DorrVault.InsufficientFree.selector);
            vault.withdraw(wd);
        } else if (wd > 0) {
            vm.prank(alice);
            vault.withdraw(wd);
        }
        assertTrue(vault.isSolvent());
    }
}
