//SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

import "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/security/PausableUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/security/ReentrancyGuardUpgradeable.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "../../interfaces/INFT.sol";
import "../../interfaces/ISageStorage.sol";
import "../../interfaces/ISageConfig.sol";

contract Auction is
    Initializable,
    UUPSUpgradeable,
    PausableUpgradeable,
    ReentrancyGuardUpgradeable
{
    ISageStorage private sageStorage;

    mapping(uint256 => AuctionInfo) public auctions;
    uint256 public constant DEFAULT_EXTENSION = 600;
    uint256 private constant bidIncrementPercentage = 100; // 1,00% higher than the previous bid
    // Fallback artist share of primary sales; the live value is read from
    // SageConfig at settle time (_primaryArtistShare) so the platform cut is
    // dashboard-settable without another upgrade. Constants use no storage
    // slots — proxy layout unchanged.
    uint256 private constant DEFAULT_ARTIST_SHARE = 8000;
    bytes32 private constant CONFIG_KEY =
        keccak256(abi.encodePacked("address.config"));
    bytes32 private constant PRIMARY_ARTIST_SHARE_KEY =
        keccak256(abi.encodePacked("share.primaryArtist"));

    IERC20 public token;

    // Artist share (bps) FROZEN per auction at creation, so a drop's split
    // can never shift mid-sale when the dashboard dial changes. 0 = created
    // before this feature -> falls back to the live SageConfig value.
    // APPEND-ONLY: declared after all pre-existing state vars (UUPS layout).
    mapping(uint256 => uint256) public auctionArtistShare;

    // Payment currency per auction. address(0) = the SAGE token (mapping
    // default, so every auction created before this feature keeps its
    // original currency); NATIVE_CURRENCY = native ETH. APPEND-ONLY.
    mapping(uint256 => address) public auctionCurrency;

    // ETH owed to addresses whose refund/payout .call failed (e.g. a
    // contract bidder with a reverting receive()). Pull-payment escape
    // hatch so one bad receiver can never block bids, cancels or settles.
    mapping(address => uint256) public pendingReturns;

    // Sentinel meaning "native ETH" (constants use no storage slots).
    address public constant NATIVE_CURRENCY =
        0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE;

    struct AuctionInfo {
        address highestBidder;
        INFT nftContract;
        uint32 startTime;
        uint32 endTime;
        uint32 duration;
        bool settled;
        uint256 minimumPrice;
        uint256 highestBid;
        uint256 auctionId;
        string nftUri;
    }

    event AuctionCreated(uint256 auctionId, address nftContract);

    event AuctionCancelled(
        uint256 indexed auctionId,
        address indexed previousBidder
    );

    event AuctionSettled(
        uint256 indexed auctionId,
        address indexed highestBidder,
        uint256 highestBid
    );

    event BidPlaced(
        uint256 indexed auctionId,
        address indexed newBidder,
        address indexed previousBidder,
        uint256 bidAmount,
        uint256 newEndTime
    );

    /**
     * @dev Throws if not called by the multisig account.
     */
    modifier onlyMultisig() {
        require(sageStorage.hasRole(0x00, msg.sender), "Admin calls only");
        _;
    }

    modifier onlyAdmin() {
        require(
            sageStorage.hasRole(keccak256("role.admin"), msg.sender),
            "Admin calls only"
        );
        _;
    }

    /** Lets the self-serve social launcher register a game against the
     *  caller's OWN NFT contract without needing on-chain admin rights —
     *  admins can still create on anyone's behalf (the curated dashboard
     *  flow). Safe because the auction's payout/mint target IS the same
     *  nftContract being checked here: nothing lets a caller register a
     *  game that pays out or mints anywhere but their own contract. */
    modifier onlyAdminOrArtist(INFT _nftContract) {
        require(
            sageStorage.hasRole(keccak256("role.admin"), msg.sender) ||
                msg.sender == _nftContract.artist(),
            "Admin or the NFT's artist only"
        );
        _;
    }

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() {
        _disableInitializers();
    }

    /** Artist share of primary sales in bps, read live from SageConfig
     *  (resolved via SageStorage's address.config key). Falls back to the
     *  historical 8000 while the config contract or key is unset. */
    function _primaryArtistShare() internal view returns (uint256) {
        address cfg = sageStorage.getAddress(CONFIG_KEY);
        if (cfg == address(0)) return DEFAULT_ARTIST_SHARE;
        uint256 share = ISageConfig(cfg).getUint(PRIMARY_ARTIST_SHARE_KEY);
        return share == 0 ? DEFAULT_ARTIST_SHARE : share;
    }

    /**
     * @dev Constructor for an upgradable contract
     */
    function initialize(address _token, address _storage) public initializer {
        __Pausable_init();
        __UUPSUpgradeable_init();
        token = IERC20(_token);
        sageStorage = ISageStorage(_storage);
    }

    function createAuction(AuctionInfo calldata _auctionInfo)
        public
        onlyAdminOrArtist(_auctionInfo.nftContract)
    {
        require(
            _auctionInfo.endTime == 0 ||
                _auctionInfo.endTime > _auctionInfo.startTime,
            "Invalid auction time"
        );
        require(
            auctions[_auctionInfo.auctionId].startTime == 0,
            "Auction already exists"
        );
        auctions[_auctionInfo.auctionId] = _auctionInfo;
        // freeze the platform split for this auction at its creation-time value
        auctionArtistShare[_auctionInfo.auctionId] = _primaryArtistShare();

        emit AuctionCreated(
            _auctionInfo.auctionId,
            address(_auctionInfo.nftContract)
        );
    }

    /** Creates an auction priced in an explicit currency: address(0) for the
     *  SAGE token or NATIVE_CURRENCY for native ETH. The original
     *  createAuction stays SAGE-only for back-compat. */
    function createAuctionWithCurrency(
        AuctionInfo calldata _auctionInfo,
        address _currency
    ) external onlyAdminOrArtist(_auctionInfo.nftContract) {
        require(
            _currency == address(0) || _currency == NATIVE_CURRENCY,
            "Unsupported currency"
        );
        createAuction(_auctionInfo);
        auctionCurrency[_auctionInfo.auctionId] = _currency;
    }

    /** Pays out `_amount` of an auction's currency. ETH payouts that fail
     *  (reverting receiver) are credited to pendingReturns instead of
     *  reverting, so a hostile receiver can't lock the auction. */
    function _payOut(
        address _currency,
        address _to,
        uint256 _amount
    ) internal {
        if (_amount == 0) return;
        if (_currency == NATIVE_CURRENCY) {
            (bool ok, ) = _to.call{value: _amount, gas: 30000}("");
            if (!ok) {
                pendingReturns[_to] += _amount;
            }
        } else {
            token.transfer(_to, _amount);
        }
    }

    /** Claims ETH credited after a failed refund/payout .call. */
    function withdrawPendingReturns() external nonReentrant {
        uint256 amount = pendingReturns[msg.sender];
        require(amount > 0, "Nothing to withdraw");
        pendingReturns[msg.sender] = 0;
        (bool ok, ) = msg.sender.call{value: amount}("");
        require(ok, "ETH transfer failed");
    }

    /** Corrective/backfill setter for a game's frozen artist share.
     *  0 resets the game to follow the live SageConfig value. */
    function setAuctionArtistShare(uint256 _auctionId, uint256 _shareBps)
        external
    {
        require(auctions[_auctionId].startTime > 0, "Auction doesn't exist");
        require(
            sageStorage.hasRole(keccak256("role.admin"), msg.sender) ||
                msg.sender == auctions[_auctionId].nftContract.artist(),
            "Admin or the NFT's artist only"
        );
        require(_shareBps <= 10000, "Invalid share");
        auctionArtistShare[_auctionId] = _shareBps;
    }

    // per-item auth check happens inside createAuction; a mixed-artist batch
    // (the admin dashboard's use case) still works since the admin clause
    // there passes for every item regardless of whose auction it is
    function createAuctionBatch(AuctionInfo[] calldata _auctions) public {
        uint256 length = _auctions.length;
        for (uint256 i = 0; i < length; ++i) {
            createAuction(_auctions[i]);
        }
    }

    function settleAuction(uint256 _auctionId)
        public
        nonReentrant
        whenNotPaused
    {
        AuctionInfo storage auction = auctions[_auctionId];
        require(!auction.settled, "Auction already settled");
        uint256 highestBid = auction.highestBid;
        address highestBidder = auction.highestBidder;
        uint256 endTime = auction.endTime;
        require(
            endTime > 0 && block.timestamp > endTime,
            "Auction is still running"
        );

        auction.settled = true;
        if (highestBidder != address(0)) {
            auction.nftContract.safeMint(highestBidder, auction.nftUri);
            uint256 share = auctionArtistShare[_auctionId];
            if (share == 0) share = _primaryArtistShare();
            uint256 artistShare = (highestBid * share) / 10000;
            address currency = auctionCurrency[_auctionId];
            _payOut(currency, auction.nftContract.artist(), artistShare);
            _payOut(currency, sageStorage.multisig(), highestBid - artistShare);
        }

        emit AuctionSettled(_auctionId, highestBidder, highestBid);
    }

    function getPercentageOfBid(uint256 _bid, uint256 _percentage)
        internal
        pure
        returns (uint256)
    {
        return (_bid * _percentage) / 10000;
    }

    function updateAuction(
        uint256 _auctionId,
        uint256 _minimumPrice,
        uint32 _endTime
    ) public onlyAdmin {
        require(!auctions[_auctionId].settled, "Auction already settled");
        require(auctions[_auctionId].startTime > 0, "Auction not found");
        AuctionInfo storage auction = auctions[_auctionId];
        auction.minimumPrice = _minimumPrice;
        auction.endTime = _endTime;
    }

    function cancelAuction(uint256 _auctionId) public nonReentrant onlyAdmin {
        AuctionInfo storage auction = auctions[_auctionId];
        require(!auction.settled, "Auction is already finished");
        address previousBidder = auction.highestBidder;
        uint256 previousBid = auction.highestBid;
        // checks-effects-interactions: close the auction out completely
        // BEFORE the refund leaves the contract (mandatory now that the
        // refund can be a native-ETH call into arbitrary receiver code)
        auction.highestBidder = address(0);
        auction.highestBid = 0;
        auction.settled = true;

        if (previousBidder != address(0)) {
            _payOut(auctionCurrency[_auctionId], previousBidder, previousBid);
        }
        emit AuctionCancelled(_auctionId, previousBidder);
    }

    function bid(uint256 _auctionId, uint256 _amount)
        public
        payable
        nonReentrant
        whenNotPaused
    {
        AuctionInfo storage auction = auctions[_auctionId];
        uint256 endTime = auction.endTime;
        uint256 startTime = auction.startTime;
        uint256 timestamp = block.timestamp;
        require(startTime > 0, "Auction doesn't exist");
        require(timestamp >= startTime, "Auction not available");
        require(endTime == 0 || endTime > timestamp, "Auction has ended");
        require(!auction.settled, "Auction already settled");
        require(
            _amount > 0 && _amount >= auction.minimumPrice,
            "Bid is lower than minimum"
        );

        require(
            _amount >=
                (auction.highestBid * (10000 + bidIncrementPercentage)) / 10000,
            "Bid is lower than highest bid increment"
        );
        address currency = auctionCurrency[_auctionId];
        if (currency == NATIVE_CURRENCY) {
            require(msg.value == _amount, "Wrong ETH amount");
        } else {
            require(msg.value == 0, "Auction is not priced in ETH");
            token.transferFrom(msg.sender, address(this), _amount);
        }

        // revert previous bid
        address previousBidder = auction.highestBidder;
        uint256 previousBid = auction.highestBid;
        auction.highestBidder = msg.sender;
        auction.highestBid = _amount;

        if (previousBidder != address(0)) {
            _payOut(currency, previousBidder, previousBid);
        }

        if (endTime == 0) {
            auction.endTime = uint32(timestamp + auction.duration);
        } else {
            if (endTime - timestamp < DEFAULT_EXTENSION) {
                endTime = timestamp + DEFAULT_EXTENSION;
                auction.endTime = uint32(endTime);
            }
        }

        emit BidPlaced(
            _auctionId,
            msg.sender,
            previousBidder,
            _amount,
            endTime
        );
    }

    function getAuction(uint256 _auctionId)
        public
        view
        returns (AuctionInfo memory)
    {
        return auctions[_auctionId];
    }

    function getBidIncrementPercentage() public pure returns (uint256) {
        return bidIncrementPercentage;
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
        onlyMultisig
    {}
}
