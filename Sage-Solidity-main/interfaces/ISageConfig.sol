pragma solidity >=0.6.0;

//SPDX-License-Identifier: MIT

interface ISageConfig {
    function getUint(bytes32 _key) external view returns (uint256);
}
