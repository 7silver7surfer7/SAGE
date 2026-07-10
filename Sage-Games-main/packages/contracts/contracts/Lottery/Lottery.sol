//SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

import "@openzeppelin/contracts-upgradeable/access/AccessControlUpgradeable.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts-upgradeable/utils/cryptography/MerkleProofUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/security/PausableUpgradeable.sol";
import "../../interfaces/IRewards.sol";
import "../../interfaces/IRandomNumberGenerator.sol";
import "../../interfaces/INFT.sol";
import "../../interfaces/ILottery.sol";
import "../../interfaces/IWhitelist.sol";

contract Lottery is
    Initializable,
    AccessControlUpgradeable,
    ILottery,
    UUPSUpgradeable,
    PausableUpgradeable
{
    bytes32 internal requestId_;

    // Address of the randomness generator
    IRandomNumberGenerator public randomGenerator;
    IRewards public rewardsContract;

    uint256[] public lotteries;

    //lotteryId => LotteryInfo
    mapping(uint256 => LotteryInfo) internal lotteryHistory;

    // lotteryId => whitelist contract address
    mapping(uint256 => address) public whitelists;

    // loteryId => merkle tree root
    mapping(uint256 => bytes32) public prizeMerkleRoots;

    // participant address => lottery ids he entered
    mapping(address => uint256[]) internal participantHistory;

    //lotteryid => prizeIds
    mapping(uint256 => PrizeInfo[]) public prizes;

    // lotteryId => ticketNumber => claimed state
    mapping(uint256 => mapping(uint256 => bool)) public claimedPrizes;

    //lotteryid => address => participantInfo
    mapping(uint256 => mapping(address => ParticipantInfo)) public participants;

    //loteryId => randomNumber received from RNG
    mapping(uint256 => uint256) public randomSeeds;

    //lotteryId => address array
    mapping(uint256 => Ticket[]) public lotteryTickets;

    //lotteryId => value already withdrawed from the lottery
    mapping(uint256 => uint256) public withdrawals;

    // Information about lotteries
    struct LotteryInfo {
        uint32 startTime; // Timestamp where users can start buying tickets
        uint32 closeTime; // Timestamp where ticket sales end
        uint32 participantsCount; // number of participants
        uint32 maxTickets; // max number of tickets for the lottery
        uint32 maxTicketsPerUser; // max number of tickets per user
        uint32 numberOfTicketsSold; // number of tickets sold
        Status status; // Status for lotto
        INFT nftContract; // reference to the NFT Contract
        bool isRefundable; // if true, users who don't win can withdraw their ETH back
        uint256 lotteryID; // ID for lotto
        uint256 dropId;
        uint256 memberTicketCostPoints; // Cost per ticket in points for member users (who earned points)
        uint256 memberTicketCostCoins; // Cost per ticket in ETH for member users (who earned points)
        uint256 nonMemberTicketCostCoins; // Cost per ticket in ETH for regular users
        uint256 defaultPrizeId; // prize all participants win if no other prizes are given
    }

    struct ParticipantInfo {
        uint16 totalTicketsBought;
        bool claimedPrize;
        uint256 refundablePoints; // points are only refunded in case of a cancellation
        uint256 refundableValue;
    }

    struct PrizeInfo {
        uint256 prizeId;
        uint16 numberOfEditions;
    }

    struct Ticket {
        uint256 ticketCostInCoins;
        address owner;
    }

    enum Status {
        Created, // The lottery has been created
        Cancelled, // A lottery that got canceled
        Closed, // Entries are closed. Must be closed to draw numbers
        Completed // The lottery has been completed and the numbers drawn
    }

    enum PriceTier {
        Member,
        NonMember
    }

    event ResponseReceived(bytes32 indexed requestId);
    event LotteryPrizesCountChanged(
        uint256 indexed lotteryId,
        uint256 numberOfPrizes
    );
    event LotteryStatusChanged(
        uint256 indexed lotteryId,
        Status indexed status
    );
    event RequestNumbers(uint256 indexed lotteryId, bytes32 indexed requestId);
    event TicketCostChanged(
        address operator,
        uint256 lotteryId,
        uint256 priceOfTicket
    );
    event TicketSold(
        uint256 indexed lotteryId,
        uint256 ticketNumber,
        address indexed participantAddress,
        PriceTier tier
    );
    event PrizeClaimed(
        uint256 indexed lotteryId,
        address indexed participantAddress,
        uint256 indexed prizeId
    );
    event Refunded(
        uint256 indexed lotteryId,
        address indexed participantAddress,
        uint256 refundAmount
    );

    /**
     * @notice Throws if not called by an admin account.
     */
    modifier onlyAdmin() {
        require(hasRole(DEFAULT_ADMIN_ROLE, msg.sender), "Admin calls only");
        _;
    }

    /**
     * @notice Throws an error if the lottery has a whitelist and the msg.sender is not whitelisted.
     */
    modifier isWhitelisted(uint256 _lotteryId) {
        // checks if the lottery has a whitelist
        if (whitelists[_lotteryId] != address(0)) {
            // if lottery has a whitelist, requires msg.sender to be whitelisted, else throws
            require(
                IWhitelist(whitelists[_lotteryId]).isWhitelisted(
                    msg.sender,
                    _lotteryId
                ),
                "Not whitelisted"
            );
        }
        _;
    }

    /**
     * @dev Constructor for an upgradable contract
     */
    function initialize(address _rewardsContract, address _admin)
        public
        initializer
    {
        __AccessControl_init();
        __Pausable_init();
        __UUPSUpgradeable_init();
        _grantRole(DEFAULT_ADMIN_ROLE, _admin);
        rewardsContract = IRewards(_rewardsContract);
    }

    function setPrizeMerkleRoot(uint256 _lotteryId, bytes32 _root)
        public
        onlyAdmin
    {
        prizeMerkleRoots[_lotteryId] = _root;
    }

    function getWhitelist(uint256 _lotteryId) public view returns (address) {
        return whitelists[_lotteryId];
    }

    function setWhitelist(uint256 _lotteryId, address _whitelist)
        public
        onlyAdmin
    {
        whitelists[_lotteryId] = _whitelist;
    }

    function setMaxTickets(uint256 _lotteryId, uint32 _maxTickets)
        public
        onlyAdmin
    {
        lotteryHistory[_lotteryId].maxTickets = _maxTickets;
    }

    function setMaxTicketsPerUser(uint256 _lotteryId, uint32 _maxTicketsPerUser)
        public
        onlyAdmin
    {
        lotteryHistory[_lotteryId].maxTicketsPerUser = _maxTicketsPerUser;
    }

    function getParticipantHistory(address _participant)
        public
        view
        returns (uint256[] memory)
    {
        return participantHistory[_participant];
    }

    function _burnUserPoints(address _user, uint256 _amount)
        internal
        returns (uint256)
    {
        return rewardsContract.burnUserPoints(_user, _amount);
    }

    function setRewardsContract(address _rewardsContract) public onlyAdmin {
        rewardsContract = IRewards(_rewardsContract);
    }

    function changeCloseTime(uint256 _lotteryId, uint32 _time)
        public
        onlyAdmin
    {
        LotteryInfo storage lottery = lotteryHistory[_lotteryId];
        require(lottery.startTime > 0, "Lottery id not found");
        require(
            _time > lottery.startTime,
            "Close time must be after start time"
        );
        lottery.closeTime = _time;
    }

    function setRandomGenerator(address _IRandomNumberGenerator)
        external
        onlyAdmin
    {
        require(
            _IRandomNumberGenerator != address(0),
            "Contracts cannot be 0 address"
        );
        randomGenerator = IRandomNumberGenerator(_IRandomNumberGenerator);
    }

    function getPrizes(uint256 _lotteryId)
        public
        view
        returns (PrizeInfo[] memory)
    {
        return prizes[_lotteryId];
    }

    function prizeClaimed(uint256 _lotteryId, uint256 _ticketNumber)
        public
        view
        returns (bool)
    {
        return claimedPrizes[_lotteryId][_ticketNumber];
    }

    /**
     * @notice Get the number of tickets sold for a lottery
     * @param _lotteryId The lottery ID
     * @return Amount tickets for a lottery
     */
    function getLotteryTicketCount(uint256 _lotteryId)
        public
        view
        returns (uint256)
    {
        return lotteryHistory[_lotteryId].numberOfTicketsSold;
    }

    function getLotteryCount() public view returns (uint256) {
        return lotteries.length;
    }

    /**
     * @notice Query lottery info
     * @param _lotteryId The lottery ID
     * @return Lottery info
     */
    function getLotteryInfo(uint256 _lotteryId)
        public
        view
        returns (LotteryInfo memory)
    {
        return (lotteryHistory[_lotteryId]);
    }

    modifier onlyRandomGenerator() {
        require(msg.sender == address(randomGenerator), "Only RNG address");
        _;
    }

    function removePrize(uint256 _lotteryId, uint256 _index) public onlyAdmin {
        require(_index < prizes[_lotteryId].length, "Index out of bounds");

        prizes[_lotteryId][_index] = prizes[_lotteryId][
            prizes[_lotteryId].length - 1
        ];
        prizes[_lotteryId].pop();
    }

    /**
     * @notice Defines prizes for a lottery.
     * @param _lotteryId The lottery ID
     * @param _prizeIds array with prize ids
     * @param _prizeAmounts array with prize supply
     */
    function addPrizes(
        uint256 _lotteryId,
        uint256[] calldata _prizeIds,
        uint16[] calldata _prizeAmounts
    ) public onlyAdmin {
        LotteryInfo memory lottery = lotteryHistory[_lotteryId];
        require(lottery.startTime > 0, "Lottery does not exist");
        require(_prizeIds.length > 0, "Number of prizes can't be 0");
        require(
            _prizeIds.length == _prizeAmounts.length,
            "Number of prize ids and amounts must be equal"
        );
        for (uint256 i; i < _prizeIds.length; i++) {
            prizes[_lotteryId].push(PrizeInfo(_prizeIds[i], _prizeAmounts[i]));
        }

        emit LotteryPrizesCountChanged(_lotteryId, _prizeIds.length);
    }

    function updateLottery(
        uint256 lotteryId,
        uint256 _memberTicketCostPoints,
        uint256 _memberTicketCostCoins,
        uint256 _nonMemberTicketCostCoins,
        uint32 _startTime,
        uint32 _closeTime,
        INFT _nftContract,
        uint16 _maxTickets,
        uint256 _defaultPrizeId,
        Status _status,
        bool _isRefundable
    ) public onlyAdmin {
        LotteryInfo storage lottery = lotteryHistory[lotteryId];
        require(lottery.startTime > 0, "Lottery does not exist");
        lottery.startTime = _startTime;
        lottery.closeTime = _closeTime;
        lottery.memberTicketCostPoints = _memberTicketCostPoints;
        lottery.memberTicketCostCoins = _memberTicketCostCoins;
        lottery.nonMemberTicketCostCoins = _nonMemberTicketCostCoins;
        lottery.nftContract = _nftContract;
        lottery.maxTickets = _maxTickets;
        lottery.defaultPrizeId = _defaultPrizeId;
        lottery.status = _status;
        lottery.isRefundable = _isRefundable;
        emit LotteryStatusChanged(lotteryId, _status);
    }

    /**
     * @notice Creates a new lottery.
     * @param _lotteryId the lottery id
     * @param _collectionId the NFT collection id
     * @param _memberTicketCostPoints cost in pixels for members
     * @param _memberTicketCostCoins cost in ETH for members
     * @param _nonMemberTicketCostCoins cost in ETH for non-members
     * @param _startTime lottery start time
     * @param _closeTime lottery closing time
     * @param _nftContract reference to the NFT contract
     * @param _isRefundable refundable games allow users who didn't win to receive their ETH back
     * @param _defaultPrizeId default prize id
     */
    function createNewLottery(
        uint256 _lotteryId,
        uint256 _collectionId,
        uint256 _memberTicketCostPoints,
        uint256 _memberTicketCostCoins,
        uint256 _nonMemberTicketCostCoins,
        uint32 _startTime,
        uint32 _closeTime,
        INFT _nftContract,
        bool _isRefundable,
        uint256 _defaultPrizeId
    ) public onlyAdmin {
        require(_closeTime > _startTime, "Close time must be after start time");
        require(
            _nftContract.collectionExists(_collectionId),
            "Collection does not exist"
        );
        lotteries.push(_collectionId);
        LotteryInfo memory newLottery = LotteryInfo(
            _startTime,
            _closeTime,
            0,
            0,
            0,
            0,
            Status.Created,
            _nftContract,
            _isRefundable,
            _lotteryId,
            _collectionId,
            _memberTicketCostPoints,
            _memberTicketCostCoins,
            _nonMemberTicketCostCoins,
            _defaultPrizeId
        );
        lotteryHistory[_lotteryId] = newLottery;
        emit LotteryStatusChanged(_collectionId, Status.Created);
    }

    /**
     * @notice Called by the team to request a random number to a particular lottery.
     * @param _lotteryId ID of the lottery the random number is for
     */
    function requestRandomNumber(uint256 _lotteryId) external onlyAdmin {
        LotteryInfo storage lottery = lotteryHistory[_lotteryId];
        require(lottery.closeTime < block.timestamp, "Lottery is not closed");
        if (lottery.status == Status.Created) {
            lottery.status = Status.Closed;
            emit LotteryStatusChanged(_lotteryId, lottery.status);
        }
        // should fail if the lottery is completed (already called drawWinningNumbers and received a response)
        require(lottery.status == Status.Closed, "Lottery must be closed!");
        requestId_ = randomGenerator.getRandomNumber(_lotteryId);
        // Emits that random number has been requested
        emit RequestNumbers(_lotteryId, requestId_);
    }

    /**
     * @notice Callback function called by the RNG contract after receiving the chainlink response.
     * Will use the received random number to assign prizes to random participants.
     * @param _lotteryId ID of the lottery the random number is for
     * @param _requestId ID of the request that was sent to the RNG contract
     * @param _randomNumber Random number provided by the VRF chainlink oracle
     */
    function receiveRandomNumber(
        uint256 _lotteryId,
        bytes32 _requestId,
        uint256 _randomNumber
    ) external onlyRandomGenerator {
        LotteryInfo storage lottery = lotteryHistory[_lotteryId];
        require(lottery.status == Status.Closed, "Lottery must be closed");
        emit ResponseReceived(_requestId);
        lottery.status = Status.Completed;
        randomSeeds[_lotteryId] = _randomNumber;
        emit LotteryStatusChanged(_lotteryId, lottery.status);
    }

    /**
     * @notice Returns an array of tickets sold for a lottery within a range.
     * @param _lotteryId The lottery ID
     * @param _from The start index of the array
     * @param _to The end index of the array
     * @return Array with tickets for a lottery inside the requested range
     */
    function getLotteryTickets(
        uint256 _lotteryId,
        uint256 _from,
        uint256 _to
    ) public view returns (Ticket[] memory) {
        Ticket[] memory result = new Ticket[](_to - _from + 1);
        for (uint256 i = _from; i <= _to; i++) {
            result[i] = lotteryTickets[_lotteryId][i];
        }
        return result;
    }

    /**
     * @notice Get the number of participants in a lottery.
     * @param _lotteryId The lottery ID
     * @return Amount of different addresses that have entered the lottery
     */
    function getParticipantsCount(uint256 _lotteryId)
        public
        view
        returns (uint32)
    {
        return lotteryHistory[_lotteryId].participantsCount;
    }

    /**
     * @notice Change the lottery state to canceled.
     * @param _lotteryId ID of the lottery to canccel
     */
    function cancelLottery(uint256 _lotteryId) public onlyAdmin {
        LotteryInfo storage lottery = lotteryHistory[_lotteryId];
        require(
            lottery.status != Status.Completed,
            "Lottery already completed"
        );
        // set status to canceled, allowing users to ask for a refund
        lottery.status = Status.Cancelled;
        emit LotteryStatusChanged(_lotteryId, lottery.status);
    }

    /**
     * @notice Function called by users to claim points and buy lottery tickets on same tx
     * @param _lotteryId ID of the lottery to buy tickets for
     * @param _numberOfTicketsToBuy Number of tickets to buy
     * @param _points Total user claimable points
     * @param _proof Proof of the user's claimable points
     * @param _tier Price tier to buy tickets with. Could be Member or NonMember
     */
    function claimPointsAndBuyTickets(
        uint256 _lotteryId,
        uint256 _numberOfTicketsToBuy,
        uint256 _points,
        bytes32[] calldata _proof,
        PriceTier _tier
    ) public payable returns (uint256) {
        if (rewardsContract.totalPointsEarned(msg.sender) < _points) {
            rewardsContract.claimPointsWithProof(msg.sender, _points, _proof);
        }
        return buyTickets(_lotteryId, _numberOfTicketsToBuy, _tier);
    }

    /**
     * @notice Function called by users to buy lottery tickets using points or ETH
     * @param _lotteryId ID of the lottery to buy tickets for
     * @param _numberOfTicketsToBuy Number of tickets to buy
     * @param _tier Price tier to buy tickets with. Could be Member or NonMember
     */
    function buyTickets(
        uint256 _lotteryId,
        uint256 _numberOfTicketsToBuy,
        PriceTier _tier
    ) public payable whenNotPaused isWhitelisted(_lotteryId) returns (uint256) {
        LotteryInfo storage lottery = lotteryHistory[_lotteryId];
        uint256 remainingPoints;
        uint256 totalCostInCoins;
        uint256 totalCostInPoints;
        uint256 costPerTicketCoins;

        if (lottery.maxTickets != 0) {
            require(
                lottery.numberOfTicketsSold + _numberOfTicketsToBuy <=
                    lottery.maxTickets,
                "Tickets sold out"
            );
        }

        ParticipantInfo storage participantInfo = participants[_lotteryId][
            msg.sender
        ];
        uint256 numTicketsBought = participantInfo.totalTicketsBought;
        if (lottery.maxTicketsPerUser > 0) {
            require(
                numTicketsBought + _numberOfTicketsToBuy <=
                    lottery.maxTicketsPerUser,
                "Can't buy this amount of tickets"
            );
        }
        require(
            lottery.startTime <= block.timestamp &&
                lottery.closeTime > block.timestamp,
            "Lottery is not open"
        );
        // Members (those who hold ASH or provide liquidity)
        // NonMembers (those who don't fit the previous descriptions)
        if (_tier == PriceTier.Member) {
            costPerTicketCoins = lottery.memberTicketCostCoins;
            totalCostInPoints =
                _numberOfTicketsToBuy *
                lottery.memberTicketCostPoints;
            participantInfo.refundablePoints += totalCostInPoints;
            remainingPoints = _burnUserPoints(msg.sender, totalCostInPoints);
        } else {
            costPerTicketCoins = lottery.nonMemberTicketCostCoins;
        }

        totalCostInCoins = _numberOfTicketsToBuy * costPerTicketCoins;
        participantInfo.refundableValue += totalCostInCoins;
        lottery.numberOfTicketsSold += uint32(_numberOfTicketsToBuy);
        require(
            msg.value >= totalCostInCoins,
            "Didn't transfer enough funds to buy tickets"
        );
        if (numTicketsBought == 0) {
            participantHistory[msg.sender].push(_lotteryId);
            ++lottery.participantsCount;
            participants[_lotteryId][msg.sender] = participantInfo;
        }
        participantInfo.totalTicketsBought += uint16(_numberOfTicketsToBuy);
        for (uint256 i; i < _numberOfTicketsToBuy; ++i) {
            assignNewTicketToParticipant(
                _lotteryId,
                msg.sender,
                costPerTicketCoins,
                _tier
            );
        }
        return remainingPoints;
    }

    /**
     * @notice Function called when user buys a ticket. Gives the user a new lottery entry.
     * @param _lotteryId ID of the lottery to buy tickets for
     * @param _participantAddress Address of the participant that will receive the new entry
     */
    function assignNewTicketToParticipant(
        uint256 _lotteryId,
        address _participantAddress,
        uint256 _ticketValue,
        PriceTier _tier
    ) private {
        Ticket memory ticket = Ticket(_ticketValue, _participantAddress);
        lotteryTickets[_lotteryId].push(ticket);
        emit TicketSold(
            _lotteryId,
            lotteryTickets[_lotteryId].length,
            _participantAddress,
            _tier
        );
    }

    function claimPrize(
        uint256 _lotteryId,
        address _winner,
        uint256 _prizeId,
        uint256 _ticketNumber,
        bytes32[] calldata _proof
    ) public whenNotPaused {
        ParticipantInfo storage participantInfo = participants[_lotteryId][
            _winner
        ];
        LotteryInfo storage lottery = lotteryHistory[_lotteryId];
        require(
            !claimedPrizes[_lotteryId][_ticketNumber],
            "Participant already claimed prize"
        );
        if (lottery.isRefundable) {
            uint256 ticketValue = lotteryTickets[_lotteryId][_ticketNumber]
                .ticketCostInCoins;

            require(
                participantInfo.refundableValue >= ticketValue,
                "Participant has requested a refund"
            );
            // make the claimed ticket value non-refundable
            participantInfo.refundableValue -= ticketValue;
        }

        require(
            _verify(
                _leaf(_lotteryId, _winner, _prizeId, _ticketNumber),
                prizeMerkleRoots[_lotteryId],
                _proof
            ),
            "Invalid merkle proof"
        );

        participants[_lotteryId][_winner].claimedPrize = true;
        INFT nftContract = lotteryHistory[_lotteryId].nftContract;

        claimedPrizes[_lotteryId][_ticketNumber] = true;
        nftContract.mint(_winner, _prizeId, 1, lottery.dropId, "");
        emit PrizeClaimed(_lotteryId, _winner, _prizeId);
    }

    function _leaf(
        uint256 _lotteryId,
        address _winner,
        uint256 _prizeId,
        uint256 _ticketNumber
    ) internal pure returns (bytes32) {
        return
            keccak256(abi.encode(_lotteryId, _winner, _prizeId, _ticketNumber));
    }

    function _verify(
        bytes32 _leafHash,
        bytes32 _root,
        bytes32[] memory _proof
    ) internal pure returns (bool) {
        return MerkleProofUpgradeable.verify(_proof, _root, _leafHash);
    }

    function getRefundableCoinBalance(uint256 _lotteryId, address _user)
        public
        view
        returns (uint256)
    {
        LotteryInfo storage lottery = lotteryHistory[_lotteryId];
        ParticipantInfo storage participantInfo = participants[_lotteryId][
            _user
        ];
        if (
            (lottery.status == Status.Completed ||
                lottery.status == Status.Cancelled) && lottery.isRefundable
        ) {
            return participantInfo.refundableValue;
        }
        return 0;
    }

    function getTicketCountPerUser(uint256 _lotteryId, address _user)
        public
        view
        returns (uint256)
    {
        ParticipantInfo storage participantInfo = participants[_lotteryId][
            _user
        ];
        return participantInfo.totalTicketsBought;
    }

    function askForRefund(uint256 _lotteryId) public whenNotPaused {
        LotteryInfo storage lottery = lotteryHistory[_lotteryId];

        // get the ParticipantInfo
        ParticipantInfo storage participantInfo = participants[_lotteryId][
            msg.sender
        ];

        if (lottery.status == Status.Completed) {
            // check if the participant has any refundable tickets
            require(
                lottery.isRefundable && participantInfo.refundableValue > 0,
                "Participant has no refundable tickets"
            );
        } else if (lottery.status == Status.Cancelled) {
            require(participantInfo.refundableValue > 0, "Already refunded");
            // points are only refunded if the lottery is canceled
            rewardsContract.refundPoints(
                msg.sender,
                participantInfo.refundablePoints
            );
        } else {
            revert("Can't ask for a refund on this lottery");
        }

        uint256 refundAmount = participantInfo.refundableValue;
        participantInfo.refundableValue = 0;
        (bool sent, ) = msg.sender.call{value: refundAmount}("");
        require(sent, "Refund failed");
        emit Refunded(_lotteryId, msg.sender, refundAmount);
    }

    /**
     * @notice Function called to withdraw funds (native tokens) from the contract.
     * @param _to Recipient of the funds
     * @param _amount Amount to withdraw
     */
    function withdraw(address payable _to, uint256 _amount) external onlyAdmin {
        (bool sent, ) = _to.call{value: _amount}("");
        require(sent, "Withdrawal failed");
    }

    function pause() external onlyAdmin {
        _pause();
    }

    function unpause() external onlyAdmin {
        _unpause();
    }

    function _authorizeUpgrade(address newImplementation)
        internal
        override
        onlyAdmin
    {}
}

interface IBalanceOf {
    /**
     * @dev Returns the number of tokens in ``owner``'s account.
     */
    function balanceOf(address owner) external view returns (uint256 balance);
}
