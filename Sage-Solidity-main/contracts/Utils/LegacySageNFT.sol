//SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

import "@openzeppelin/contracts/token/ERC721/extensions/ERC721URIStorage.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "../../interfaces/ISageStorage.sol";

/**
 * TEST FIXTURE ONLY — replicates the interface surface of the PRE-royalty
 * SageNFT contracts that are already live on testnet: fixed 12% royalty paid
 * to the contract itself, `artistShare` PRIVATE (no getter — this is exactly
 * what the new Marketplace probes to detect a legacy contract), and the
 * withdraw()/withdrawERC20() pooled-split behavior. Used by test_royalty.js
 * to prove the new Marketplace keeps old artist contracts working unchanged.
 */
contract LegacySageNFT is ERC721URIStorage {
    ISageStorage private immutable sageStorage;
    address public artist;
    uint256 private artistShare; // private on legacy contracts — no getter
    uint256 private constant DEFAULT_ROYALTY_PERCENTAGE = 1200;
    uint256 private nextId = 1;

    constructor(
        address _sageStorage,
        address _artist,
        uint256 _artistShare
    ) ERC721("Legacy", "LEG") {
        sageStorage = ISageStorage(_sageStorage);
        artist = _artist;
        artistShare = _artistShare;
    }

    function mint(address to, string calldata uri) public {
        _safeMint(to, nextId);
        _setTokenURI(nextId, uri);
        nextId++;
    }

    function royaltyInfo(uint256, uint256 salePrice)
        external
        view
        returns (address, uint256)
    {
        return (address(this), (salePrice * DEFAULT_ROYALTY_PERCENTAGE) / 10000);
    }

    function withdrawERC20(address erc20) public {
        IERC20 token = IERC20(erc20);
        uint256 balance = token.balanceOf(address(this));
        uint256 _artist = (balance * artistShare) / 10000;
        require(token.transfer(artist, _artist), "artist transfer failed");
        require(
            token.transfer(sageStorage.multisig(), balance - _artist),
            "platform transfer failed"
        );
    }

    // legacy contracts whitelist the marketplace registered in SageStorage
    function isApprovedForAll(address owner, address operator)
        public
        view
        override
        returns (bool)
    {
        if (
            sageStorage.getAddress(
                keccak256(abi.encodePacked("address.marketplace"))
            ) == operator
        ) {
            return true;
        }
        return super.isApprovedForAll(owner, operator);
    }
}
