//SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

interface IBalanceOf {
    function balanceOf(address owner) external view returns (uint256 balance);
}

// Mock whitelist used for tests
contract Whitelist {
    mapping(address => bool) whitelisted;

    constructor() {}

    /**
     * @notice Assess whether an address meets requirements to be considered whitelisted
     * Will check if the address has the target token balance.
     * @param _address The address to assess whitelist status.
     * @return True if the address is whitelisted, false otherwise.
     */
    function isWhitelisted(address _address, uint256 _collectionId)
        public
        view
        returns (bool)
    {
        return whitelisted[_address];
    }

    function addAddress(address _address) public {
        whitelisted[_address] = true;
    }
}
