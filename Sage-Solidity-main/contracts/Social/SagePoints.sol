// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

import '@openzeppelin/contracts/token/ERC20/IERC20.sol';
import '@openzeppelin/contracts/access/Ownable.sol';

/**
 * SagePoints v2 — the "pixels" economy, fully on-chain with STREAMING accrual.
 *
 * Hold SAGE → earn pixels continuously, per second, no oracle and no cron:
 *   pointsOf(user) = settled[user] + heldSage × rate × secondsSinceLastSync
 * where heldSage is read LIVE from the SAGE ERC20 and capped (whale cap).
 * Any state-changing touch (spend/credit) first settles the stream into
 * `settled` and stamps `lastSync`, so spends always come out of a fresh
 * balance.
 *
 * Approximation note: the stream between two syncs uses the CURRENT SAGE
 * balance for the whole window (the SAGE token has no transfer hooks we can
 * observe). Windows are short in practice — every spend/credit syncs — and
 * the daily cap bounds any distortion.
 *
 * Controllers (the platform server) move pixels: spendFrom (burn),
 * creditTo (mint, e.g. seller earnings), transferPoints (buyer→seller in one
 * tx). Economics are owner-adjustable at any time, no redeploy:
 *  - rateScaled   : pixels per SAGE per day × 100 (25 = 0.25/day)
 *  - capSage      : max whole SAGE that accrues (100_000 → 25k pixels/day max)
 *  - transferable : reserved for future peer-to-peer pixels
 */
contract SagePoints is Ownable {
    IERC20 public immutable sage;
    uint256 public immutable deployedAt;

    mapping(address => bool) public isController;
    mapping(address => uint256) public settled; // pixels banked at last sync
    mapping(address => uint256) public lastSync; // 0 = never touched → stream from deployedAt
    uint256 public totalSpent; // lifetime pixels burned (analytics)

    struct Economics {
        uint256 rateScaled; // pixels/SAGE/day × 100
        uint256 capSage; // whale cap, in whole SAGE
        bool transferable;
    }
    Economics public economics;

    event ControllerSet(address indexed who, bool enabled);
    event EconomicsUpdated(uint256 rateScaled, uint256 capSage, bool transferable);
    event Synced(address indexed user, uint256 streamed, uint256 newSettled);
    event Spent(address indexed from, uint256 amount, string reason);
    event Credited(address indexed to, uint256 amount, string reason);

    constructor(address sageToken) {
        require(sageToken != address(0), 'bad token');
        sage = IERC20(sageToken);
        deployedAt = block.timestamp;
        economics = Economics({ rateScaled: 25, capSage: 100_000, transferable: false });
        isController[msg.sender] = true;
        emit ControllerSet(msg.sender, true);
    }

    modifier onlyController() {
        require(isController[msg.sender], 'not a controller');
        _;
    }

    function setController(address who, bool enabled) external onlyOwner {
        isController[who] = enabled;
        emit ControllerSet(who, enabled);
    }

    /** Tune the economics at any time — no redeploy, no migration. */
    function setEconomics(uint256 rateScaled, uint256 capSage, bool transferable) external onlyOwner {
        economics = Economics(rateScaled, capSage, transferable);
        emit EconomicsUpdated(rateScaled, capSage, transferable);
    }

    /** Un-synced pixels streamed since the user's last touch. */
    function pendingStream(address user) public view returns (uint256) {
        uint256 from = lastSync[user] == 0 ? deployedAt : lastSync[user];
        if (block.timestamp <= from) return 0;
        uint256 heldWhole = sage.balanceOf(user) / 1 ether;
        if (heldWhole > economics.capSage) heldWhole = economics.capSage;
        // pixels = sage × (rateScaled/100)/day × elapsed
        return (heldWhole * economics.rateScaled * (block.timestamp - from)) / (100 * 1 days);
    }

    /** The user's live pixel balance — what every UI and gate should read. */
    function pointsOf(address user) external view returns (uint256) {
        return settled[user] + pendingStream(user);
    }

    /** Pixels this user earns per day at their current SAGE balance. */
    function dailyRateOf(address user) external view returns (uint256) {
        uint256 heldWhole = sage.balanceOf(user) / 1 ether;
        if (heldWhole > economics.capSage) heldWhole = economics.capSage;
        return (heldWhole * economics.rateScaled) / 100;
    }

    function _sync(address user) internal {
        uint256 streamed = pendingStream(user);
        if (streamed > 0) settled[user] += streamed;
        lastSync[user] = block.timestamp;
        emit Synced(user, streamed, settled[user]);
    }

    /** Burn pixels from a user (collects, verification, …). */
    function spendFrom(address from, uint256 amount, string calldata reason) public onlyController {
        _sync(from);
        require(settled[from] >= amount, 'insufficient pixels');
        settled[from] -= amount;
        totalSpent += amount;
        emit Spent(from, amount, reason);
    }

    /** Credit pixels to a user (seller earnings, promos, refunds). */
    function creditTo(address to, uint256 amount, string calldata reason) public onlyController {
        _sync(to);
        settled[to] += amount;
        emit Credited(to, amount, reason);
    }

    /** Buyer pays seller in one tx — the collect flow's primitive. */
    function transferPoints(
        address from,
        address to,
        uint256 amount,
        string calldata reason
    ) external onlyController {
        spendFrom(from, amount, reason);
        // spendFrom burned it from the buyer; re-mint to the seller
        _sync(to);
        settled[to] += amount;
        totalSpent -= amount; // net-zero: moved, not burned
        emit Credited(to, amount, reason);
    }
}
