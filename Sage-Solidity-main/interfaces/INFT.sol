pragma solidity >=0.6.0;

//SPDX-License-Identifier: MIT

interface INFT {
    function safeMint(address _to, string memory _uri) external;

    function owner() external view returns (address);

    function artist() external view returns (address);

    // Public getter on new-generation SageNFT contracts only — probed inside
    // try/catch by the Marketplace; reverting here marks a legacy contract.
    function artistShare() external view returns (uint256);
}
