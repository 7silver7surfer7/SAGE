//SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import "@openzeppelin/contracts/security/Pausable.sol";
import "../../interfaces/IRewards.sol";
import "../../interfaces/IWhitelist.sol";
import "../../interfaces/ISageStorage.sol";
import "../../interfaces/ISageConfig.sol";
import "../../interfaces/INFT.sol";

contract SAGEOpenEdition is Pausable {
    ISageStorage private sageStorage;
    address private signerAddress;
    IRewards public rewardsContract;
    IERC20 public token;
    mapping(uint256 => mapping(address => uint256)) public mintedByUser;
    // Fallback artist share of primary sales; the live value is read from
    // SageConfig at mint time (_primaryArtistShare) so the platform cut is
    // dashboard-settable without a redeploy.
    uint256 private constant DEFAULT_ARTIST_SHARE = 8000;
    bytes32 private constant CONFIG_KEY =
        keccak256(abi.encodePacked("address.config"));
    bytes32 private constant PRIMARY_ARTIST_SHARE_KEY =
        keccak256(abi.encodePacked("share.primaryArtist"));

    struct OpenEdition {
        uint32 startTime; // Timestamp where users can start minting
        uint32 closeTime; // Timestamp where minting ends
        uint32 costPoints; // Cost per mint in Pixel points
        uint32 limitPerUser; // Amount of NFTs each user can mint
        uint32 mintCount; // Number of NFTs minted
        string nftUri; // URI of the NFT to be minted
        INFT nftContract; // reference to the NFT Contract
        IWhitelist whitelist; // whitelist contract address
        uint256 costTokens; // Cost per mint (SAGE wei, or ETH wei for ETH editions)
        uint256 id; // Open edition id
        address currency; // address(0) = SAGE token, NATIVE_CURRENCY = native ETH
        // When true, this edition can ONLY be minted through
        // batchMintWithVoucher (a platform-signed per-wallet voucher) — the
        // open batchMint path is closed. This is how a drop is gated WITHOUT a
        // per-drop whitelist contract or any server-paid whitelist write.
        bool voucherGated;
    }

    // Sentinel meaning "native ETH"
    address public constant NATIVE_CURRENCY =
        0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE;

    event OpenEditionCreated(uint256 indexed id, address indexed nftContract);
    event BatchMint(address indexed user, uint256 indexed id, uint256 amount);

    // mapping openEditionId => OpenEdition
    mapping(uint256 => OpenEdition) public openEditions;

    // Artist share (bps) FROZEN per edition at creation, so a drop's split
    // can never shift mid-sale when the dashboard dial changes. 0 = falls
    // back to the live SageConfig value.
    mapping(uint256 => uint256) public editionArtistShare;

    modifier onlyMultisig() {
        require(sageStorage.multisig() == msg.sender, "Admin calls only");
        _;
    }

    /**
     * @dev Throws if not called by an admin account.
     */
    modifier onlyAdmin() {
        require(
            sageStorage.hasRole(keccak256("role.admin"), msg.sender),
            "Admin calls only"
        );
        _;
    }

    // Any already-verified, genuinely-deployed SageNFT instance — used only
    // as a codehash reference (see _isTrustedNft), never called into.
    address public trustedNftReference;

    /** Set once (or updated) by an admin to any real, previously-deployed
     *  SageNFT — including one deployed for a totally unrelated artist.
     *  Only its runtime CODE matters here, not its data. */
    function setTrustedNftReference(address _ref) external onlyAdmin {
        trustedNftReference = _ref;
    }

    /** True only if `_c` is a REAL SageNFT deployment — checked by comparing
     *  runtime bytecode against a known-good reference, not by calling into
     *  `_c` (an attacker's contract can return whatever it wants from its
     *  own functions, including a spoofed artist()/interface, but it cannot
     *  fake having SageNFT's exact compiled code). SageNFT's only immutable
     *  is `sageStorage`, which every legitimate deployment sets to the same
     *  shared platform address — so genuine deployments share one codehash
     *  regardless of which artist or drop they belong to. */
    function _isTrustedNft(address _c) internal view returns (bool) {
        return
            trustedNftReference != address(0) &&
            _c.code.length > 0 &&
            _c.codehash == trustedNftReference.codehash;
    }

    /** Lets the self-serve social launcher register a game against the
     *  caller's OWN NFT contract without needing on-chain admin rights —
     *  admins can still create on anyone's behalf (the curated dashboard
     *  flow). Safe because the edition's payout/mint target IS the same
     *  nftContract being checked here: nothing lets a caller register a
     *  game that pays out or mints anywhere but their own contract.
     *  _isTrustedNft() is required in the artist branch — without it,
     *  anyone could deploy a two-line contract whose artist() returns
     *  themselves and pass this check trivially. */
    modifier onlyAdminOrArtist(INFT _nftContract) {
        require(
            sageStorage.hasRole(keccak256("role.admin"), msg.sender) ||
                (_isTrustedNft(address(_nftContract)) &&
                    msg.sender == _nftContract.artist()),
            "Admin or the NFT's artist only"
        );
        _;
    }

    constructor(
        address _rewardsContract,
        address _admin,
        address _sageStorage,
        address _token
    ) {
        sageStorage = ISageStorage(_sageStorage);
        token = IERC20(_token);
        rewardsContract = IRewards(_rewardsContract);
        signerAddress = _admin;
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

    function isWhitelisted(OpenEdition memory _oe) internal view {
        // checks if the lottery has a whitelist
        IWhitelist whitelist = _oe.whitelist;
        if (address(whitelist) != address(0)) {
            // if open edition has a whitelist, requires msg.sender to be whitelisted, else throws
            require(whitelist.isWhitelisted(msg.sender, 0), "Not whitelisted");
        }
    }

    function _burnUserPoints(address _user, uint256 _amount)
        internal
        returns (uint256)
    {
        return rewardsContract.burnUserPoints(_user, _amount);
    }

    // Builds a prefixed hash to mimic the behavior of eth_sign.
    function prefixed(bytes32 hash) internal pure returns (bytes32) {
        return
            keccak256(
                abi.encodePacked("\x19Ethereum Signed Message:\n32", hash)
            );
    }

    function claimPointsAndMint(
        uint256 _id,
        uint256 _amount,
        uint256 _points,
        bytes calldata _sig
    ) public payable {
        address _user = msg.sender;
        bytes32 message = prefixed(keccak256(abi.encode(_user, _points)));
        require(
            ECDSA.recover(message, _sig) == signerAddress,
            "Invalid signature"
        );

        if (rewardsContract.totalPointsEarned(_user) < _points) {
            rewardsContract.claimPoints(_user, _points);
        }

        batchMint(_id, _amount);
    }

    function createOpenEdition(OpenEdition calldata oe)
        public
        onlyAdminOrArtist(oe.nftContract)
    {
        require(
            oe.startTime > 0 && oe.closeTime > oe.startTime,
            "Invalid times"
        );
        require(
            oe.currency == address(0) || oe.currency == NATIVE_CURRENCY,
            "Unsupported currency"
        );
        // required once non-admins can call this — a self-serve caller could
        // otherwise pass an existing id + their OWN nftContract and overwrite
        // someone else's edition (the DB's ids are sequential/guessable)
        require(openEditions[oe.id].startTime == 0, "Edition already exists");
        openEditions[oe.id] = oe;
        // freeze the platform split for this edition at its creation-time value
        editionArtistShare[oe.id] = _primaryArtistShare();
    }

    /** Corrective/backfill setter for an edition's frozen artist share.
     *  0 resets the edition to follow the live SageConfig value. */
    function setEditionArtistShare(uint256 _id, uint256 _shareBps) external {
        require(openEditions[_id].startTime > 0, "Edition doesn't exist");
        require(
            sageStorage.hasRole(keccak256("role.admin"), msg.sender) ||
                msg.sender == openEditions[_id].nftContract.artist(),
            "Admin or the NFT's artist only"
        );
        require(_shareBps <= 10000, "Invalid share");
        editionArtistShare[_id] = _shareBps;
    }

    function setWhitelist(uint256 _id, address _whitelist) public {
        require(openEditions[_id].startTime > 0, "Edition doesn't exist");
        require(
            sageStorage.hasRole(keccak256("role.admin"), msg.sender) ||
                msg.sender == openEditions[_id].nftContract.artist(),
            "Admin or the NFT's artist only"
        );
        openEditions[_id].whitelist = IWhitelist(_whitelist);
    }

    function getOpenEdition(uint256 _id)
        public
        view
        returns (OpenEdition memory)
    {
        return openEditions[_id];
    }

    function getMintCount(uint256 _id) public view returns (uint32) {
        return openEditions[_id].mintCount;
    }

    function batchMint(uint256 _id, uint256 _amount) public payable {
        OpenEdition storage oe = openEditions[_id];
        // a voucher-gated edition is mintable ONLY via batchMintWithVoucher;
        // the open path stays closed so an edition with no whitelist isn't
        // silently public
        require(!oe.voucherGated, "Voucher required");
        isWhitelisted(oe);
        _mintCore(_id, _amount);
    }

    // Voucher path: a platform-signed voucher proves eligibility INLINE, so a
    // gated drop needs no per-drop whitelist contract and no server-paid
    // whitelist write — the minter carries their own gate and pays only their
    // own mint gas. The voucher is bound to (purpose, chainid, this contract,
    // minter, edition, deadline), so it cannot be replayed on another
    // chain / contract / edition / wallet; reuse within one edition is bounded
    // by that edition's own limitPerUser + closeTime, exactly like a whitelist
    // entry. The money path is UNCHANGED: both entry points funnel into the
    // identical _mintCore below, which is the pre-voucher batchMint body verbatim.
    function batchMintWithVoucher(
        uint256 _id,
        uint256 _amount,
        uint256 _deadline,
        bytes calldata _sig
    ) public payable {
        require(block.timestamp <= _deadline, "Voucher expired");
        bytes32 message = prefixed(
            keccak256(
                abi.encode(
                    "SAGE_OE_VOUCHER",
                    block.chainid,
                    address(this),
                    msg.sender,
                    _id,
                    _deadline
                )
            )
        );
        require(
            ECDSA.recover(message, _sig) == signerAddress,
            "Invalid voucher"
        );
        _mintCore(_id, _amount);
    }

    function _mintCore(uint256 _id, uint256 _amount) internal whenNotPaused {
        require(_amount > 0, "Can't mint 0");
        OpenEdition storage oe = openEditions[_id];
        require(
            oe.startTime <= block.timestamp && oe.closeTime > block.timestamp,
            "Not open"
        );

        uint256 amountMinted = mintedByUser[_id][msg.sender];

        if (oe.limitPerUser > 0) {
            require(
                _amount + amountMinted <= oe.limitPerUser,
                "Mint limit reached"
            );
        }

        mintedByUser[_id][msg.sender] += _amount;
        oe.mintCount += uint32(_amount);

        string memory nftUri = oe.nftUri;
        uint256 totalCostInPoints = _amount * oe.costPoints;

        if (totalCostInPoints > 0) {
            _burnUserPoints(msg.sender, totalCostInPoints);
        }
        uint256 totalCostInTokens = oe.costTokens * _amount;

        if (totalCostInTokens > 0) {
            uint256 share = editionArtistShare[_id];
            if (share == 0) share = _primaryArtistShare();
            uint256 artistShare = (totalCostInTokens * share) / 10000;
            if (oe.currency == NATIVE_CURRENCY) {
                require(msg.value == totalCostInTokens, "Wrong ETH amount");
                (bool okArtist, ) = oe.nftContract.artist().call{
                    value: artistShare
                }("");
                require(okArtist, "Artist ETH transfer failed");
                (bool okPlatform, ) = sageStorage.multisig().call{
                    value: totalCostInTokens - artistShare
                }("");
                require(okPlatform, "Platform ETH transfer failed");
            } else {
                require(msg.value == 0, "Edition is not priced in ETH");
                // unchecked return meant a non-standard ERC20 that returns
                // false instead of reverting on failure would silently mint
                // NFTs below while neither the artist nor the platform got
                // paid — checked everywhere else in the codebase, missed here.
                require(
                    token.transferFrom(
                        msg.sender,
                        oe.nftContract.artist(),
                        artistShare
                    ),
                    "ERC20 payout failed"
                );
                require(
                    token.transferFrom(
                        msg.sender,
                        sageStorage.multisig(),
                        totalCostInTokens - artistShare
                    ),
                    "ERC20 payout failed"
                );
            }
        } else {
            require(msg.value == 0, "Mint is free");
        }
        for (uint256 i = 0; i < _amount; i++) {
            oe.nftContract.safeMint(msg.sender, nftUri);
        }

        emit BatchMint(msg.sender, _id, _amount);
    }
}
