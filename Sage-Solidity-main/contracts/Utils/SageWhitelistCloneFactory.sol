//SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

import "@openzeppelin/contracts/proxy/Clones.sol";
import "../../interfaces/ISageStorage.sol";

/**
 * @title SageWhitelistCloneable
 * @notice Behaviourally identical to SageWhitelist (same isWhitelisted hook
 * the Lottery/OpenEdition contracts already call, same admin-gated batch
 * add/remove) but constructor-free so it works behind EIP-1167 minimal
 * proxies: a per-drop whitelist deploy drops from ~400k gas (full bytecode)
 * to ~45k (a 45-byte proxy). State lives in each clone; code lives once in
 * the implementation.
 */
contract SageWhitelistCloneable {
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

    /** Clone initializer — replaces the constructor; callable exactly once. */
    function initialize(address _sageStorage) external {
        require(address(sageStorage) == address(0), "Already initialized");
        require(_sageStorage != address(0), "Bad storage");
        sageStorage = ISageStorage(_sageStorage);
    }

    /** IWhitelist hook called by Lottery/OpenEdition; id ignored (one
     *  whitelist covers every game in its drop, same as SageWhitelist). */
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

/**
 * @title SageWhitelistCloneFactory
 * @notice One implementation, unlimited ~45k-gas clones. createWhitelist is
 * admin-gated (the platform key holds role.admin) so the factory's event log
 * stays a clean registry of real drop whitelists.
 */
contract SageWhitelistCloneFactory {
    address public immutable implementation;
    address public immutable sageStorage;

    event WhitelistCloned(address indexed clone);

    modifier onlyAdmin() {
        require(
            ISageStorage(sageStorage).hasRole(
                keccak256("role.admin"),
                msg.sender
            ),
            "Admin calls only"
        );
        _;
    }

    constructor(address _sageStorage) {
        require(_sageStorage != address(0), "Bad storage");
        sageStorage = _sageStorage;
        SageWhitelistCloneable impl = new SageWhitelistCloneable();
        // initialize the implementation itself so nobody else can claim it;
        // clones start uninitialized regardless (they have their own storage)
        impl.initialize(_sageStorage);
        implementation = address(impl);
    }

    function createWhitelist() external onlyAdmin returns (address clone) {
        clone = Clones.clone(implementation);
        SageWhitelistCloneable(clone).initialize(sageStorage);
        emit WhitelistCloned(clone);
    }
}
