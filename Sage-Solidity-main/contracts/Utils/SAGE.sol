// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";

/**
 * @title SAGE
 * @notice Fixed-supply, no-tax meme token.
 *
 * The entire supply is minted once, at deploy, to a single recipient. There is
 * no owner, no mint function, and no transfer fee — every transfer moves the
 * full amount. The contract is immutable from the moment it is created: nothing
 * about it can ever be changed by anyone, so there is nothing to renounce.
 */
contract SAGE is ERC20 {
    /**
     * @param name_      Token name.
     * @param symbol_    Token symbol.
     * @param supply_    Total supply in whole tokens (18 decimals added here).
     * @param recipient_ Address that receives the entire supply.
     */
    constructor(
        string memory name_,
        string memory symbol_,
        uint256 supply_,
        address recipient_
    ) ERC20(name_, symbol_) {
        require(recipient_ != address(0), "recipient=0");
        _mint(recipient_, supply_ * 10 ** decimals());
    }
}
