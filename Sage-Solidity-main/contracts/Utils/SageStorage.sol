//SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

import "../../interfaces/ISageStorage.sol";
import "@openzeppelin/contracts/access/AccessControl.sol";

contract SageStorage is ISageStorage, AccessControl {
    bytes32 public constant ADMIN_ROLE = keccak256("role.admin");
    bytes32 public constant ARTIST_ROLE = keccak256("role.artist");
    bytes32 public constant MINTER_ROLE = keccak256("role.minter");
    bytes32 public constant BURNER_ROLE = keccak256("role.burner");
    bytes32 public constant MANAGE_POINTS_ROLE = keccak256("role.points");

    address public multisig;

    /**
     * @dev Throws if not called by the multisig account.
     */
    modifier onlyMultisig() {
        require(msg.sender == multisig, "Multisig calls only");
        _;
    }

    modifier onlyAdmin() {
        require(hasRole(ADMIN_ROLE, msg.sender), "Admin calls only");
        _;
    }

    /// @dev Construct
    constructor(address _admin, address _multisig) {
        multisig = _multisig;
        // SECURITY (audit H1): DEFAULT_ADMIN_ROLE is the role-admin of every
        // operational role (MINTER/BURNER/ADMIN/MANAGE_POINTS), so whoever holds
        // it can grantRole itself MINTER on every SageNFT — and revokeRole the
        // multisig. The multisig is the SOLE custodian of DEFAULT_ADMIN_ROLE;
        // the operational key (_admin, the server-side oracle wallet) must get
        // only ADMIN_ROLE, never DEFAULT_ADMIN_ROLE. (Previously _admin was also
        // granted DEFAULT_ADMIN_ROLE here, letting the hot key take over the
        // whole platform — see scripts/revoke_admin_default_admin_role.js for
        // the fix on already-deployed instances.)
        _setupRole(DEFAULT_ADMIN_ROLE, _multisig);
        _setupRole(ADMIN_ROLE, _admin);
        _setRoleAdmin(ARTIST_ROLE, ADMIN_ROLE);
    }

    function setRoleAdmin(bytes32 role, bytes32 adminRole) public onlyMultisig {
        _setRoleAdmin(role, adminRole);
    }

    // Storage maps
    mapping(bytes32 => address) private addressStorage;

    function setMultisig(address _multisig) public onlyMultisig {
        multisig = _multisig;
    }

    /// @param _key The key for the record
    function getAddress(bytes32 _key) public view returns (address r) {
        return addressStorage[_key];
    }

    /// @param _key The key for the record
    function setAddress(bytes32 _key, address _value) public onlyAdmin {
        addressStorage[_key] = _value;
    }

    /// @param _key The key for the record
    function deleteAddress(bytes32 _key) public onlyAdmin {
        delete addressStorage[_key];
    }
}
