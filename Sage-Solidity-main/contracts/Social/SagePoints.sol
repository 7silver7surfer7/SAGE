// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

import '@openzeppelin/contracts/token/ERC20/IERC20.sol';
import '@openzeppelin/contracts/access/Ownable.sol';

/**
 * SagePoints v3 — the "pixels" economy, on-chain STREAMING accrual with a
 * per-user balance CHECKPOINT (fixes v2's retroactive-accrual flaw).
 *
 * Hold SAGE → earn pixels per second, no oracle and no cron:
 *   pointsOf(user) = settled[user] + pendingStream(user)
 *   pendingStream  = min(currentSage, checkpointSage) capped × rate × elapsed
 *
 * Why the checkpoint (the v2 fix):
 *   v2 streamed a user's CURRENT balance all the way back to `deployedAt` for
 *   anyone who had never been "synced". Two consequences users actually hit:
 *     (a) every whale above the cap showed the IDENTICAL point total,
 *         regardless of when they bought — the clock ran from contract deploy,
 *         not from when they acquired SAGE; and
 *     (b) a wallet could briefly spike its balance and farm the whole window
 *         (flash-balance accrual).
 *   v3 accrues only from a per-user checkpoint (set on first touch, credit 0)
 *   and uses min(current, checkpoint) so a spike never helps and a never-
 *   touched wallet reads 0 instead of a phantom lump. You earn on the balance
 *   you've actually SUSTAINED since your last sync, from when you were first
 *   observed — not retroactively from deploy.
 *
 * Controllers (the platform server) move pixels: spendFrom, creditTo,
 * transferPoints. Owner tunes economics live (rateScaled, capSage) and seeds
 * migrated balances once via seedSettled().
 */
contract SagePoints is Ownable {
    IERC20 public immutable sage;
    uint256 public immutable deployedAt;

    mapping(address => bool) public isController;
    mapping(address => uint256) public settled; // pixels banked at last sync
    mapping(address => uint256) public lastSync; // 0 = never touched → 0 stream
    // whole SAGE observed at the user's last sync — the ceiling on what the
    // next window can accrue (min'd with the live balance). 0 until first sync.
    mapping(address => uint256) public checkpointSage;
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

    constructor(address sageToken, uint256 rateScaled, uint256 capSage) {
        require(sageToken != address(0), 'bad token');
        sage = IERC20(sageToken);
        deployedAt = block.timestamp;
        economics = Economics({ rateScaled: rateScaled, capSage: capSage, transferable: false });
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

    /** Un-synced pixels streamed since the user's last touch. Accrues on the
     *  LOWER of the live balance and the checkpoint, from lastSync forward —
     *  never retroactively, never on an un-sustained spike. */
    function pendingStream(address user) public view returns (uint256) {
        uint256 from = lastSync[user];
        // never synced → no checkpoint yet → no accrual (v2 streamed from
        // deployedAt here, which is exactly the bug this fixes)
        if (from == 0 || block.timestamp <= from) return 0;
        uint256 liveWhole = sage.balanceOf(user) / 1 ether;
        uint256 heldWhole = liveWhole < checkpointSage[user] ? liveWhole : checkpointSage[user];
        if (heldWhole > economics.capSage) heldWhole = economics.capSage;
        return (heldWhole * economics.rateScaled * (block.timestamp - from)) / (100 * 1 days);
    }

    /** The user's live pixel balance — what every UI and gate should read. */
    function pointsOf(address user) external view returns (uint256) {
        return settled[user] + pendingStream(user);
    }

    /** Pixels this user earns per day at their current SAGE balance (uses the
     *  sustained-since-checkpoint balance, matching pendingStream). */
    function dailyRateOf(address user) external view returns (uint256) {
        uint256 liveWhole = sage.balanceOf(user) / 1 ether;
        uint256 cp = checkpointSage[user];
        // before a first sync there's no checkpoint; preview the live balance
        uint256 heldWhole = cp == 0 ? liveWhole : (liveWhole < cp ? liveWhole : cp);
        if (heldWhole > economics.capSage) heldWhole = economics.capSage;
        return (heldWhole * economics.rateScaled) / 100;
    }

    function _sync(address user) internal {
        uint256 streamed = pendingStream(user);
        if (streamed > 0) settled[user] += streamed;
        lastSync[user] = block.timestamp;
        // re-checkpoint at the CURRENT balance for the next window
        checkpointSage[user] = sage.balanceOf(user) / 1 ether;
        emit Synced(user, streamed, settled[user]);
    }

    /** One-time migration: seed banked balances carried over from a prior
     *  SagePoints deployment, and start each seeded user's honest accrual now
     *  (checkpoint = current balance, clock starts at seed time). Owner-only;
     *  intended to run once before/at controller cutover. */
    function seedSettled(address[] calldata users, uint256[] calldata amounts) external onlyOwner {
        require(users.length == amounts.length, 'length mismatch');
        for (uint256 i = 0; i < users.length; i++) {
            address u = users[i];
            settled[u] = amounts[i];
            lastSync[u] = block.timestamp;
            checkpointSage[u] = sage.balanceOf(u) / 1 ether;
        }
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
