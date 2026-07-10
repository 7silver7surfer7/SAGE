//SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

interface IBalanceOf {
    function balanceOf(address owner, uint256 id)
        external
        view
        returns (uint256 balance);
}

contract WhitelistIntern {
    address constant INTERN = 0xA25Bf81AaCdB5E610EaF91a889975BBA43398cF1;

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
        return (IBalanceOf(INTERN).balanceOf(_address, 1) > 0);
    }
}
