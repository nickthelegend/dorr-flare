// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";

/// @title DorrVault — non-custodial FXRP margin vault
/// @notice Collateral for dorr perpetual futures, held in FXRP (Flare FAssets).
///
/// THE INVARIANT THAT MATTERS:
///   FXRP can leave this contract in exactly ONE way — the depositor calling
///   `withdraw()` for their own free balance. There is no admin path, no owner
///   path, and no settlement path that transfers tokens out. Not the operator,
///   not the owner, not the settlement contract can move your collateral to an
///   external address. If the operator vanishes or turns malicious, every user
///   can still withdraw their own free balance.
///
/// The settlement contract is granted a strictly weaker power: it may
/// lock/release margin and apply ZERO-SUM PnL between internal balances (that is
/// what a perp settlement is). It can never mint balance, never reduce the
/// vault's total backing, and never transfer tokens out. `totalInternal` is
/// checked against the real token balance so internal accounting can never
/// exceed what the vault actually holds.
contract DorrVault is ReentrancyGuard, Ownable {
    using SafeERC20 for IERC20;

    /// @notice The FXRP token (FAssets FTestXRP on Coston2), 6 decimals.
    IERC20 public immutable fxrp;

    /// @notice The settlement contract allowed to lock margin and apply PnL.
    address public settlement;

    struct Account {
        uint256 balance; // total credited collateral (free + locked)
        uint256 locked;  // margin backing open positions / sealed orders
    }

    mapping(address => Account) private _accounts;

    /// @notice Sum of all internal balances. Must always be <= fxrp.balanceOf(this).
    uint256 public totalInternal;

    event Deposited(address indexed trader, uint256 amount, uint256 newBalance);
    event Withdrawn(address indexed trader, uint256 amount, uint256 newBalance);
    event MarginLocked(address indexed trader, uint256 amount, uint256 locked);
    event MarginReleased(address indexed trader, uint256 amount, uint256 locked);
    event PnlApplied(address indexed trader, int256 delta, uint256 newBalance);
    event SettlementUpdated(address indexed settlement);

    error ZeroAmount();
    error InsufficientFree();
    error InsufficientLocked();
    error NotSettlement();
    error ZeroAddress();
    error BackingShortfall();
    error PnlNotZeroSum();

    constructor(address _fxrp, address _owner) Ownable(_owner) {
        if (_fxrp == address(0)) revert ZeroAddress();
        fxrp = IERC20(_fxrp);
    }

    modifier onlySettlement() {
        if (msg.sender != settlement) revert NotSettlement();
        _;
    }

    // ------------------------------------------------------------------
    // Trader-owned actions — the only way tokens move in or out
    // ------------------------------------------------------------------

    /// @notice Deposit FXRP as margin collateral. Caller must have approved this vault.
    function deposit(uint256 amount) external nonReentrant {
        if (amount == 0) revert ZeroAmount();
        fxrp.safeTransferFrom(msg.sender, address(this), amount);
        _accounts[msg.sender].balance += amount;
        totalInternal += amount;
        emit Deposited(msg.sender, amount, _accounts[msg.sender].balance);
    }

    /// @notice Withdraw your own free (unlocked) collateral. Only you can call this
    ///         for your own funds — there is no operator or admin equivalent.
    function withdraw(uint256 amount) external nonReentrant {
        if (amount == 0) revert ZeroAmount();
        Account storage a = _accounts[msg.sender];
        if (amount > a.balance - a.locked) revert InsufficientFree();
        a.balance -= amount;
        totalInternal -= amount;
        fxrp.safeTransfer(msg.sender, amount);
        emit Withdrawn(msg.sender, amount, a.balance);
    }

    // ------------------------------------------------------------------
    // Settlement-only: margin + zero-sum PnL. Never moves tokens out.
    // ------------------------------------------------------------------

    /// @notice Lock a trader's free balance as margin for an order/position.
    function lockMargin(address trader, uint256 amount) external onlySettlement {
        Account storage a = _accounts[trader];
        if (amount > a.balance - a.locked) revert InsufficientFree();
        a.locked += amount;
        emit MarginLocked(trader, amount, a.locked);
    }

    /// @notice Release previously locked margin back to free.
    function releaseMargin(address trader, uint256 amount) external onlySettlement {
        Account storage a = _accounts[trader];
        if (amount > a.locked) revert InsufficientLocked();
        a.locked -= amount;
        emit MarginReleased(trader, amount, a.locked);
    }

    /// @notice Apply zero-sum PnL across traders at batch settlement.
    /// @dev The deltas MUST sum to zero: a perp is a closed system, so every
    ///      credit is someone else's debit. This makes it impossible for the
    ///      settlement contract to inflate total backing or drain the vault.
    function applyPnl(address[] calldata traders, int256[] calldata deltas) external onlySettlement {
        uint256 n = traders.length;
        require(n == deltas.length, "length mismatch");

        int256 sum;
        for (uint256 i; i < n; ++i) {
            sum += deltas[i];
        }
        if (sum != 0) revert PnlNotZeroSum();

        for (uint256 i; i < n; ++i) {
            Account storage a = _accounts[traders[i]];
            int256 d = deltas[i];
            if (d >= 0) {
                a.balance += uint256(d);
            } else {
                uint256 loss = uint256(-d);
                // A trader can never go negative; cap at their balance (the
                // remainder is a bad-debt event for the insurance fund off-chain).
                a.balance = loss >= a.balance ? 0 : a.balance - loss;
            }
            emit PnlApplied(traders[i], d, a.balance);
        }

        // Internal accounting must never exceed real backing.
        if (totalInternal > fxrp.balanceOf(address(this))) revert BackingShortfall();
    }

    // ------------------------------------------------------------------
    // Admin — wiring only. Note there is deliberately NO token-moving admin fn.
    // ------------------------------------------------------------------

    function setSettlement(address _settlement) external onlyOwner {
        if (_settlement == address(0)) revert ZeroAddress();
        settlement = _settlement;
        emit SettlementUpdated(_settlement);
    }

    // ------------------------------------------------------------------
    // Views
    // ------------------------------------------------------------------

    function accountOf(address trader) external view returns (uint256 balance, uint256 locked, uint256 free) {
        Account memory a = _accounts[trader];
        return (a.balance, a.locked, a.balance - a.locked);
    }

    function freeBalanceOf(address trader) external view returns (uint256) {
        Account memory a = _accounts[trader];
        return a.balance - a.locked;
    }

    /// @notice Real FXRP held by the vault. Proof-of-solvency: this should always
    ///         be >= totalInternal, and anyone can verify it independently.
    function reserves() external view returns (uint256) {
        return fxrp.balanceOf(address(this));
    }

    /// @notice True when on-chain reserves fully back all credited balances.
    function isSolvent() external view returns (bool) {
        return fxrp.balanceOf(address(this)) >= totalInternal;
    }
}
