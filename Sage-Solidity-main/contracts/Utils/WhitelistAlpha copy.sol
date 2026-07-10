//SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

interface IBalanceOf {
    function balanceOf(address owner) external view returns (uint256 balance);
}

contract WhitelistAlpha {
    address constant ALPHA = 0x48AF7b1c9dac8871C064f62FcEC0d9d6F7c269f5;

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
        return (IBalanceOf(ALPHA).balanceOf(_address) > 0);
    }
}
