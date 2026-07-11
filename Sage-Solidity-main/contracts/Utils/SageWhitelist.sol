//SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

import "../../interfaces/ISageStorage.sol";

/**
 * @title SageWhitelist
 * @notice Wallet allowlist for gating a drop's games. One instance is deployed
 * per gated drop and wired into its lotteries (Lottery.setWhitelist) and open
 * editions (OpenEdition struct / setWhitelist); those contracts call
 * isWhitelisted(msg.sender, id) before selling.
 *
 * Unlike the test mock (Whitelist.sol), writes are restricted to SageStorage
 * admins — the same role that can create games — and addresses are added or
 * removed in batches so large allowlists fit in few transactions.
 */
contract SageWhitelist {
    ISageStorage private sageStorage;
    mapping(address => bool) public whitelisted;

    event AddressesAdded(uint256 count);
    event AddressesRemoved(uint256 count);

    modifier onlyAdmin() {
        require(
            sageStorage.hasRole(keccak256("role.admin"), msg.sender),
            "Admin calls only"
        );
        _;
    }

    constructor(address _sageStorage) {
        sageStorage = ISageStorage(_sageStorage);
    }

    /**
     * @notice IWhitelist hook called by Lottery/OpenEdition. The collection id
     * is ignored — one SageWhitelist instance covers every game in its drop.
     */
    function isWhitelisted(address _address, uint256)
        public
        view
        returns (bool)
    {
        return whitelisted[_address];
    }

    function addAddresses(address[] calldata _addresses) external onlyAdmin {
        for (uint256 i = 0; i < _addresses.length; i++) {
            whitelisted[_addresses[i]] = true;
        }
        emit AddressesAdded(_addresses.length);
    }

    function removeAddresses(address[] calldata _addresses) external onlyAdmin {
        for (uint256 i = 0; i < _addresses.length; i++) {
            whitelisted[_addresses[i]] = false;
        }
        emit AddressesRemoved(_addresses.length);
    }
}
