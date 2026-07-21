pragma solidity >=0.6.0;

//SPDX-License-Identifier: MIT

interface IERC2981 {
    // Matches the real EIP-2981 spec (and OZ's own IERC2981): `view`, so
    // Marketplace's call is a STATICCALL and an untrusted NFT contract can't
    // use it as a reentrancy hook into _settleSale.
    function royaltyInfo(uint256 tokenId, uint256 salePrice)
        external
        view
        returns (address, uint256);
}
