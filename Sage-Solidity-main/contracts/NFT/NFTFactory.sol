//SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

import "./SageNFT.sol";
import "../../interfaces/ISageStorage.sol";

error PermissionDenied();

contract NFTFactory {
    bytes32 public constant ADMIN_ROLE = keccak256("role.admin");
    uint256 private constant DEFAULT_ARTIST_SHARE = 8333;

    mapping(address => SageNFT) artistContracts;
    ISageStorage immutable sageStorage;

    event NewNFTContract(
        address indexed contractAddress,
        address indexed artistAddress
    );

    /**
     * @dev Throws if not called by an admin account.
     */
    modifier onlyAdmin() {
        require(
            sageStorage.hasRole(ADMIN_ROLE, msg.sender),
            "Admin calls only"
        );
        _;
    }

    // Was checking DEFAULT_ADMIN_ROLE (0x00) instead of the real multisig —
    // SageStorage's constructor grants DEFAULT_ADMIN_ROLE to the admin
    // wallet too, not just the multisig, so this let a plain admin key pass
    // a check meant to require the higher-security multisig. Fixed to match
    // Auction/SageNFT/SAGEOpenEdition/SageCollection/Rewards/Lottery.
    modifier onlyMultisig() {
        require(sageStorage.multisig() == msg.sender, "Admin calls only");
        _;
    }

    constructor(address _sageStorage) {
        sageStorage = ISageStorage(_sageStorage);
    }

    function setArtistContract(address _artist, address payable _contract)
        public
        onlyMultisig
    {
        artistContracts[_artist] = SageNFT(_contract);
    }

    function createNFTContract(
        address artistAddress,
        string calldata name,
        string calldata symbol,
        uint256 artistShare
    ) internal returns (SageNFT) {
        require(
            address(artistContracts[artistAddress]) == address(0),
            "Contract already exists"
        );

        // 1200 matches the historical fixed royalty SageNFT always started
        // at before it took this as a constructor param — unchanged
        // behavior for the shared, factory-registered artist contract
        // (setDefaultRoyalty still corrects it per-drop same as before).
        SageNFT newContract = new SageNFT(
            name,
            symbol,
            address(sageStorage),
            artistAddress,
            artistShare,
            1200
        );
        artistContracts[artistAddress] = newContract;
        emit NewNFTContract(address(newContract), artistAddress);
        return newContract;
    }

    function deployByAdmin(
        address artistAddress,
        string calldata name,
        string calldata symbol,
        uint256 artistShare
    ) public onlyAdmin {
        createNFTContract(artistAddress, name, symbol, artistShare);
    }

    // Open to any wallet — matches the self-serve social launcher's
    // permissionless createEdition/createCollection (no role gate there
    // either). createNFTContract's own "one contract per artist" check is
    // the only guard: a wallet can deploy its OWN first artist contract
    // for free, but can't redeploy over an existing one or anyone else's.
    function deployByArtist(string calldata name, string calldata symbol)
        public
    {
        createNFTContract(msg.sender, name, symbol, DEFAULT_ARTIST_SHARE);
    }

    function getContractAddress(address artistAddress)
        public
        view
        returns (address)
    {
        return address(artistContracts[artistAddress]);
    }
}
