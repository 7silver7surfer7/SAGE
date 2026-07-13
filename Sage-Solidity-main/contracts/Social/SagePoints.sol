// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

import '@openzeppelin/contracts/token/ERC20/ERC20.sol';
import '@openzeppelin/contracts/access/Ownable.sol';

/**
 * SagePoints — the "pixels" economy as an on-chain ERC20, with a controller
 * role for the platform (the oracle mints accrual; the app burns spends) and
 * an OWNER-ADJUSTABLE economics config so the token model can be tuned over
 * time without redeploying.
 *
 * Design note (tradeoff): moving points on-chain makes balances transparent
 * and composable, but every spend becomes a gas-paying transaction. The app
 * keeps a fast off-chain ledger for UX; this contract is the settlement +
 * source-of-truth layer and the place to change the economics.
 *
 * Adjustable economics (owner-only, emitted on change for indexers):
 *  - pointsPerSagePerDay : accrual rate for holding SAGE
 *  - collectFloorPoints  : minimum pixel price a post can be sold for
 *  - verificationPoints  : pixel cost of the checkmark (0 = pay in SAGE/ETH)
 *  - transferable        : whether holders can move points peer-to-peer
 */
contract SagePoints is ERC20, Ownable {
    mapping(address => bool) public isController; // platform minters/burners

    struct Economics {
        uint256 pointsPerSagePerDay;
        uint256 collectFloorPoints;
        uint256 verificationPoints;
        bool transferable;
    }
    Economics public economics;

    event ControllerSet(address indexed who, bool enabled);
    event EconomicsUpdated(
        uint256 pointsPerSagePerDay,
        uint256 collectFloorPoints,
        uint256 verificationPoints,
        bool transferable
    );

    constructor() ERC20('SAGE Pixels', 'PIXELS') {
        economics = Economics({
            pointsPerSagePerDay: 25, // 0.25/day scaled ×100, matches the oracle
            collectFloorPoints: 1,
            verificationPoints: 0,
            transferable: false // points are earned/spent, not traded, by default
        });
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
    function setEconomics(
        uint256 pointsPerSagePerDay,
        uint256 collectFloorPoints,
        uint256 verificationPoints,
        bool transferable
    ) external onlyOwner {
        economics = Economics(
            pointsPerSagePerDay,
            collectFloorPoints,
            verificationPoints,
            transferable
        );
        emit EconomicsUpdated(
            pointsPerSagePerDay,
            collectFloorPoints,
            verificationPoints,
            transferable
        );
    }

    /** Oracle accrual + refunds. */
    function mint(address to, uint256 amount) external onlyController {
        _mint(to, amount);
    }

    /** Spends (collects, verification) burn from the spender's balance. */
    function burnFrom(address from, uint256 amount) external onlyController {
        _burn(from, amount);
    }

    /**
     * Points are non-transferable unless economics.transferable is on — mint
     * and burn (from/to the zero address) always pass so accrual/spend work.
     */
    function _beforeTokenTransfer(address from, address to, uint256 amount) internal override {
        super._beforeTokenTransfer(from, to, amount);
        if (from == address(0) || to == address(0)) return; // mint/burn always allowed
        require(economics.transferable, 'points are non-transferable');
    }
}
