// SPDX-License-Identifier: MIT
pragma solidity ^0.8.7;

import "@chainlink/contracts/src/v0.8/interfaces/VRFCoordinatorV2Interface.sol";
import "@chainlink/contracts/src/v0.8/VRFConsumerBaseV2.sol";
import "../../interfaces/ILottery.sol";
import "@openzeppelin/contracts/access/Ownable.sol";

contract RNG is VRFConsumerBaseV2, Ownable {
    event RequestNumbers(uint256 indexed lotteryId, uint256 indexed requestId);
    event ResponseReceived(uint256 indexed requestId, uint256 randomWord);
    event LotteryAddressChanged(address oldAddr, address newAddr);

    mapping(uint256 => uint256) requestToLotteryId;
    VRFCoordinatorV2Interface COORDINATOR;

    uint64 s_subscriptionId;

    bytes32 internal keyHash;

    uint32 callbackGasLimit = 200000;

    uint16 requestConfirmations = 3;

    uint32 numWords = 1;

    address public lotteryAddr;

    modifier onlyLottery() {
        require(msg.sender == lotteryAddr, "Lottery calls only");
        _;
    }

    constructor(
        uint64 _subscriptionId,
        address _vrfCoordinator,
        address _lotteryAddr,
        bytes32 _keyHash
    ) VRFConsumerBaseV2(_vrfCoordinator) {
        COORDINATOR = VRFCoordinatorV2Interface(_vrfCoordinator);
        s_subscriptionId = _subscriptionId;
        keyHash = _keyHash;
        lotteryAddr = _lotteryAddr;
    }

    function requestRandomWords(uint256 _lotteryId)
        external
        onlyLottery
        returns (uint256 requestId)
    {
        // Will revert if subscription is not set and funded.
        requestId = COORDINATOR.requestRandomWords(
            keyHash,
            s_subscriptionId,
            requestConfirmations,
            callbackGasLimit,
            numWords
        );
        requestToLotteryId[requestId] = _lotteryId;
        emit RequestNumbers(_lotteryId, requestId);
        return requestId;
    }

    function fulfillRandomWords(
        uint256 _requestId,
        uint256[] memory _randomWords
    ) internal override {
        require(requestToLotteryId[_requestId] != 0, "request not found");
        ILottery(lotteryAddr).receiveRandomNumber(
            requestToLotteryId[_requestId],
            _randomWords[0]
        );
        emit ResponseReceived(_requestId, _randomWords[0]);
    }

    function setLotteryAddress(address _lotteryAddr) public onlyOwner {
        require(_lotteryAddr != address(0));
        address oldAddr = lotteryAddr;
        lotteryAddr = _lotteryAddr;
        emit LotteryAddressChanged(oldAddr, _lotteryAddr);
    }
}
