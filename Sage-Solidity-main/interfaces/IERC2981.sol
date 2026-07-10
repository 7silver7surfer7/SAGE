pragma solidity >=0.6.0;

//SPDX-License-Identifier: MIT

interface IERC2981 {
    function royaltyInfo(uint256 tokenId, uint256 salePrice)
        external
        returns (address, uint256);
}
