// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";

/**
 * @title SAGE
 * @notice Fixed-supply ERC20 meme token with an optional buy/sell fee.
 *
 * The full supply is minted once at deploy; there is no mint function, so the
 * supply can never grow. A fee is charged only on trades against a designated
 * AMM pair (set via {setAMMPair}); plain wallet-to-wallet transfers are always
 * fee-free. Fees are capped at {MAX_FEE} so they can never be cranked to a rug.
 */
contract SageToken is ERC20, Ownable {
    /// @notice Hard cap on either fee, in basis points (1% = 100 bps).
    /// @dev The fee can provably never exceed 1%, even by the owner.
    uint256 public constant MAX_FEE = 100;

    /// @notice Fee charged when buying from an AMM pair, in basis points.
    uint256 public buyFeeBps;
    /// @notice Fee charged when selling to an AMM pair, in basis points.
    uint256 public sellFeeBps;

    /// @notice Wallet that receives collected fees.
    address public treasury;

    /// @notice Addresses marked as AMM pairs (buy/sell detection).
    mapping(address => bool) public isAMMPair;
    /// @notice Addresses exempt from fees.
    mapping(address => bool) public isFeeExempt;

    event AMMPairSet(address indexed pair, bool isPair);
    event FeesSet(uint256 buyFeeBps, uint256 sellFeeBps);
    event FeeExemptSet(address indexed account, bool exempt);
    event TreasurySet(address indexed treasury);

    /**
     * @param name_        Token name.
     * @param symbol_      Token symbol.
     * @param supply_      Total supply in whole tokens (18 decimals added here).
     * @param owner_       Address that receives the supply and controls the token.
     * @param treasury_    Address that receives collected fees.
     * @param buyFeeBps_   Initial buy fee in basis points (<= MAX_FEE).
     * @param sellFeeBps_  Initial sell fee in basis points (<= MAX_FEE).
     */
    constructor(
        string memory name_,
        string memory symbol_,
        uint256 supply_,
        address owner_,
        address treasury_,
        uint256 buyFeeBps_,
        uint256 sellFeeBps_
    ) ERC20(name_, symbol_) {
        require(owner_ != address(0), "owner=0");
        require(treasury_ != address(0), "treasury=0");
        require(buyFeeBps_ <= MAX_FEE && sellFeeBps_ <= MAX_FEE, "fee>max");

        buyFeeBps = buyFeeBps_;
        sellFeeBps = sellFeeBps_;
        treasury = treasury_;

        // Owner, treasury, and this contract never pay fees.
        isFeeExempt[owner_] = true;
        isFeeExempt[treasury_] = true;
        isFeeExempt[address(this)] = true;

        _mint(owner_, supply_ * 10 ** decimals());
        _transferOwnership(owner_);
    }

    // --- Owner controls -----------------------------------------------------

    /// @notice Designate (or clear) an address as an AMM pair for fee purposes.
    function setAMMPair(address pair, bool isPair) external onlyOwner {
        require(pair != address(0), "pair=0");
        isAMMPair[pair] = isPair;
        emit AMMPairSet(pair, isPair);
    }

    /// @notice Update buy/sell fees. Both are hard-capped at {MAX_FEE}.
    function setFees(uint256 buyFeeBps_, uint256 sellFeeBps_) external onlyOwner {
        require(buyFeeBps_ <= MAX_FEE && sellFeeBps_ <= MAX_FEE, "fee>max");
        buyFeeBps = buyFeeBps_;
        sellFeeBps = sellFeeBps_;
        emit FeesSet(buyFeeBps_, sellFeeBps_);
    }

    /// @notice Mark or unmark an address as fee-exempt.
    function setFeeExempt(address account, bool exempt) external onlyOwner {
        isFeeExempt[account] = exempt;
        emit FeeExemptSet(account, exempt);
    }

    /// @notice Change the fee-receiving treasury wallet.
    function setTreasury(address treasury_) external onlyOwner {
        require(treasury_ != address(0), "treasury=0");
        treasury = treasury_;
        emit TreasurySet(treasury_);
    }

    // --- Transfer with fee --------------------------------------------------

    function _transfer(
        address from,
        address to,
        uint256 amount
    ) internal override {
        uint256 fee;
        if (!isFeeExempt[from] && !isFeeExempt[to]) {
            if (isAMMPair[from]) {
                // buy: tokens leaving the pair
                fee = (amount * buyFeeBps) / 10000;
            } else if (isAMMPair[to]) {
                // sell: tokens entering the pair
                fee = (amount * sellFeeBps) / 10000;
            }
        }

        if (fee > 0) {
            super._transfer(from, treasury, fee);
            super._transfer(from, to, amount - fee);
        } else {
            super._transfer(from, to, amount);
        }
    }
}
