//SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

import "../../interfaces/ISageStorage.sol";

/**
 * Central on-chain uint config, keyed by bytes32.
 *
 * Exists because SageStorage (which every live contract references immutably)
 * only stores addresses and is not upgradeable — this contract adds the uint
 * layer WITHOUT touching it. Its own address is registered in SageStorage
 * under keccak256("address.config"); consumers resolve it from there and fall
 * back to their historical hardcoded values while it is unset (or a key is 0),
 * so deploying/registering this contract changes nothing by itself.
 *
 * Known keys:
 *   keccak256("share.primaryArtist") — artist share of PRIMARY sales in bps
 *   (8000 = 80% artist / 20% platform). 0/unset = fallback 8000.
 */
contract SageConfig {
    ISageStorage private immutable sageStorage;
    mapping(bytes32 => uint256) private uints;

    event UintSet(bytes32 indexed key, uint256 value);

    modifier onlyAdminOrMultisig() {
        require(
            sageStorage.hasRole(keccak256("role.admin"), msg.sender) ||
                sageStorage.multisig() == msg.sender,
            "Admin calls only"
        );
        _;
    }

    constructor(address _sageStorage) {
        sageStorage = ISageStorage(_sageStorage);
    }

    function getUint(bytes32 _key) public view returns (uint256) {
        return uints[_key];
    }

    function setUint(bytes32 _key, uint256 _value) external onlyAdminOrMultisig {
        uints[_key] = _value;
        emit UintSet(_key, _value);
    }
}
