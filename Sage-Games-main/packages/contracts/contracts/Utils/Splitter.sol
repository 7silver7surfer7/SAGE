//SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

import "@openzeppelin/contracts/access/AccessControl.sol";
import "@openzeppelin/contracts/security/ReentrancyGuard.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";

contract Splitter is AccessControl, ReentrancyGuard {
    address[] public destinations;

    uint16[] public weights;

    uint16 totalWeight;

    modifier onlyAdmin() {
        require(hasRole(DEFAULT_ADMIN_ROLE, msg.sender), "Admin calls only");
        _;
    }

    constructor(
        address _admin,
        address[] memory _destinations,
        uint16[] memory _weights
    ) {
        _setupRole(DEFAULT_ADMIN_ROLE, _admin);

        destinations = _destinations;
        weights = _weights;
        for (uint256 i = 0; i < weights.length; i++) {
            totalWeight += weights[i];
        }
    }

    /**
     * @notice Sets the list of destination address. Each address will receive a part of the funds in proportion to its weight.
     * @param _destinations The list of destination addresses.
     */
    function setDestinations(address[] memory _destinations) public onlyAdmin {
        destinations = _destinations;
    }

    /**
     * @notice Set the weight of distribution to each destination address. The index of the destination address must be the same as the index of the weight.
     * @param _weights The weight of distribution to each destination address.
     */
    function setWeights(uint16[] memory _weights) public onlyAdmin {
        weights = _weights;
        totalWeight = 0;
        for (uint256 i = 0; i < weights.length; i++) {
            totalWeight += weights[i];
        }
    }

    /**
     * @notice Split ERC20 tokens to the destination list.
     * @param _amount The amount of tokens to split.
     * @param _erc20Address The address of the ERC20 contract.
     */
    function splitERC20(uint256 _amount, address _erc20Address)
        public
        payable
        nonReentrant
    {
        if (_erc20Address != address(0)) {
            require(
                IERC20(_erc20Address).balanceOf(address(this)) >= _amount,
                "Not enough balance"
            );
        }

        uint16 _totalWeight = totalWeight;
        for (uint256 i = 0; i < destinations.length; i++) {
            uint256 amountPerDestination = (_amount * weights[i]) /
                _totalWeight;
            if (_erc20Address != address(0)) {
                IERC20(_erc20Address).transfer(
                    destinations[i],
                    amountPerDestination
                );
            }
        }
    }

    /**
     * @dev Split native tokens to the destination list.
     * @param _amount The amount of tokens to split.
     */
    function split(uint256 _amount) public payable nonReentrant {
        require((address(this).balance) >= _amount, "Not enough balance");

        uint16 _totalWeight = totalWeight;
        for (uint256 i = 0; i < destinations.length; i++) {
            uint256 amountPerDestination = (_amount * weights[i]) /
                _totalWeight;
            (bool sent, ) = destinations[i].call{value: amountPerDestination}(
                ""
            );
            if (!sent) {
                revert();
            }
        }
    }

    receive() external payable {}
}
