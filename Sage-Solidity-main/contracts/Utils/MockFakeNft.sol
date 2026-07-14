//SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

import "../../interfaces/INFT.sol";

/** Stands in for an attacker's contract: implements INFT but artist() just
 *  returns whatever the deployer set (e.g. themselves), and safeMint() is a
 *  no-op. Used only to prove createAuction/createOpenEdition/createCollection
 *  reject a caller who ISN'T backed by real SageNFT bytecode, even when
 *  msg.sender exactly matches what this contract's artist() reports. */
contract MockFakeNft is INFT {
    address public artist;
    uint256 public artistShare = 8000;

    constructor(address _artist) {
        artist = _artist;
    }

    function safeMint(address, string memory) external override {}

    function owner() external view override returns (address) {
        return artist;
    }
}
