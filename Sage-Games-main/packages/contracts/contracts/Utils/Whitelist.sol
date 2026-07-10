//SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

import "../../interfaces/IWhitelist.sol";
import "@openzeppelin/contracts/access/AccessControl.sol";

interface IBalanceOf {
    function balanceOf(address owner) external view returns (uint256 balance);
}

contract Whitelist is AccessControl, IWhitelist {
    mapping(uint256 => WhitelistTarget[]) public whitelist;

    struct WhitelistTarget {
        // user must have a balance on contractAddress of at least minBalance to be whitelisted
        address contractAddress;
        uint256 minBalance;
    }

    constructor(address _admin) {
        _setupRole(DEFAULT_ADMIN_ROLE, _admin);
    }

    /**
     * @dev Throws if not called by an admin account.
     */
    modifier onlyAdmin() {
        require(hasRole(DEFAULT_ADMIN_ROLE, msg.sender), "Admin calls only");
        _;
    }

    /**
     * @notice Assess whether an address meets requirements to be considered whitelisted
     * Will check if the address contains at least minBalance tokens on any of the stored contract addresses.
     * @param _address The address to assess whitelist status.
     * @return True if the address is whitelisted, false otherwise.
     */
    function isWhitelisted(address _address, uint256 _collectionId)
        public
        view
        returns (bool)
    {
        WhitelistTarget[] memory targets = whitelist[_collectionId];
        for (uint256 i = 0; i < targets.length; i++) {
            WhitelistTarget memory target = targets[i];
            if (
                // works for ERC-20 or ERC-721 tokens
                IBalanceOf(target.contractAddress).balanceOf(_address) >=
                target.minBalance
            ) {
                return true;
            }
        }
        return false;
    }

    /**
     * @notice Add a new contract address (ERC-20 or ERC-721) and minBalance.
     * If an address has at least minBalance tokens on any added contract it will be whitelisted.
     * @param _address, ERC-20/ERC-721 contract address
     * @param _minBalance mininum balance to be considered whitelisted
     * @param _collectionId collection id for which the requirements will be applied
     */
    function addAddress(
        address _address,
        uint256 _minBalance,
        uint256 _collectionId
    ) public onlyAdmin {
        require(_minBalance > 0, "Min balance must be greater than 0");
        WhitelistTarget memory param = WhitelistTarget(_address, _minBalance);
        whitelist[_collectionId].push(param);
    }

    /**
     * @notice remove a contract address from the requirements list
     * @param _address contract address to be removed
     * @param _collectionId collection id for which the requirements apply
     */
    function removeAddress(address _address, uint256 _collectionId)
        public
        onlyAdmin
    {
        WhitelistTarget[] storage list = whitelist[_collectionId];

        for (uint256 i = 0; i < list.length; i++) {
            if (list[i].contractAddress == _address) {
                list[i] = list[list.length - 1];
                list.pop();
                return;
            }
        }
    }
}
