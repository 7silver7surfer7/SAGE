//SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

import "@openzeppelin/contracts/access/AccessControl.sol";
import "@openzeppelin/contracts/utils/cryptography/MerkleProof.sol";
import "../../interfaces/IRewards.sol";

contract Rewards is AccessControl, IRewards {
    bytes32 public constant MANAGE_POINTS_ROLE =
        keccak256("MANAGE_POINTS_ROLE");
    bytes32 public pointsMerkleRoot;

    mapping(address => uint256) public totalPointsUsed;

    mapping(address => uint256) public totalPointsEarned;

    mapping(address => RewardInfo) public rewardInfo;

    address[] public rewardTokenAddresses;

    struct RewardInfo {
        uint16 chainId;
        // points rewarded per day per position size considering 8 decimals
        uint256 pointRewardPerDay;
        // amount of tokens required to get the reward per day. ie 100,000 tokens (18 decimals) to get 1 point
        uint256 positionSize;
        // the rewards are capped at this amount of tokens
        uint256 positionSizeLimit;
    }

    event RewardChanged(
        address indexed token,
        uint256 pointRewardPerDay,
        uint256 positionSize,
        uint256 positionSizeLimit
    );
    event PointsUsed(address indexed user, uint256 amount, uint256 remaining);
    event PointsEarned(address indexed user, uint256 amount);

    modifier onlyAdmin() {
        require(hasRole(DEFAULT_ADMIN_ROLE, msg.sender), "Admin calls only");
        _;
    }

    constructor(address _admin) {
        _setupRole(DEFAULT_ADMIN_ROLE, _admin);
    }

    function getPointsUsedBatch(address[] calldata addresses)
        public
        view
        returns (uint256[] memory)
    {
        uint256[] memory result = new uint256[](addresses.length);
        for (uint256 i; i < addresses.length; ++i) {
            result[i] = totalPointsUsed[addresses[i]];
        }
        return result;
    }

    function setRewardRate(
        address _token,
        uint16 _chainId,
        uint256 _pointRewardPerDay,
        uint256 _positionSize,
        uint256 _positionSizeLimit
    ) public onlyAdmin {
        rewardInfo[_token] = RewardInfo(
            _chainId,
            _pointRewardPerDay,
            _positionSize,
            _positionSizeLimit
        );
        emit RewardChanged(
            _token,
            _pointRewardPerDay,
            _positionSize,
            _positionSizeLimit
        );
        for (uint256 i = 0; i < rewardTokenAddresses.length; ++i) {
            if (rewardTokenAddresses[i] == _token) {
                return;
            }
        }
        // push token address to the list, if not already present
        rewardTokenAddresses.push(_token);
    }

    function removeReward(uint256 _index) public onlyAdmin {
        require(_index < rewardTokenAddresses.length, "Index out of bounds");
        rewardTokenAddresses[_index] = rewardTokenAddresses[
            rewardTokenAddresses.length - 1
        ];
        rewardTokenAddresses.pop();
    }

    function availablePoints(address user) public view returns (uint256) {
        return totalPointsEarned[user] - totalPointsUsed[user];
    }

    function burnUserPoints(address _account, uint256 _amount)
        public
        returns (uint256)
    {
        require(
            hasRole(MANAGE_POINTS_ROLE, msg.sender),
            "Smart contract role required"
        );
        uint256 available = totalPointsEarned[_account] -
            totalPointsUsed[_account];
        require(_amount > 0, "Can't use 0 points");
        require(_amount <= available, "Not enough points");
        totalPointsUsed[_account] += _amount;

        emit PointsUsed(_account, _amount, available - _amount);
        return available - _amount;
    }

    function refundPoints(address _account, uint256 _points) public {
        require(
            hasRole(MANAGE_POINTS_ROLE, msg.sender),
            "No role to do refunds"
        );
        require(_points > 0, "Can't refund 0 points");
        uint256 used = totalPointsUsed[_account];
        require(_points <= used, "Can't refund more points than used");
        totalPointsUsed[_account] = used - _points;
    }

    function setPointsMerkleRoot(bytes32 _root) public onlyAdmin {
        pointsMerkleRoot = _root;
    }

    function claimPointsWithProof(
        address _address,
        uint256 _points,
        bytes32[] calldata _proof
    ) public returns (uint256) {
        require(
            _verify(_leaf(_address, _points), pointsMerkleRoot, _proof),
            "Invalid proof"
        );
        uint256 newPoints = _points - totalPointsEarned[_address];
        require(newPoints > 0, "Participant already claimed all points");

        totalPointsEarned[_address] = _points;
        emit PointsEarned(_address, newPoints);
        return newPoints;
    }

    function _leaf(address _address, uint256 _points)
        internal
        pure
        returns (bytes32)
    {
        return keccak256(abi.encode(_address, _points));
    }

    function _verify(
        bytes32 _leafHash,
        bytes32 _root,
        bytes32[] memory _proof
    ) internal pure returns (bool) {
        return MerkleProof.verify(_proof, _root, _leafHash);
    }
}
