//SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/security/Pausable.sol";
import "@openzeppelin/contracts/utils/Strings.sol";
import "../../interfaces/IWhitelist.sol";
import "../../interfaces/ISageStorage.sol";
import "../../interfaces/ISageConfig.sol";
import "../../interfaces/INFT.sol";

/**
 * Fixed-price SEQUENTIAL collection mint ("PFP-style" drop): a collection of
 * N unique pre-uploaded images; token i receives metadata `{baseUri}{i}.json`
 * (an Arweave path-manifest URL), assigned in order as mints come in. Clone
 * of SAGEOpenEdition's economics — same window/whitelist/limit gates and the
 * same frozen-at-creation artist share with live SageConfig fallback — but
 * every token is unique (per-index URI) and supply is CAPPED at maxSupply
 * (the number of images uploaded). SAGE-token payment only (no points path).
 */
contract SageCollection is Pausable {
    ISageStorage private sageStorage;
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

    struct Collection {
        uint32 startTime; // Timestamp when minting opens
        uint32 closeTime; // Timestamp when minting ends; 0 = NO deadline, open until sold out
        uint32 maxSupply; // Number of unique images == hard mint cap
        uint32 mintCount; // Number minted so far (next token gets index mintCount+1)
        uint32 limitPerUser; // Max mints per wallet (0 = unlimited)
        string baseUri; // e.g. https://arweave.net/{manifestId}/ — token i's metadata at {baseUri}{i}.json
        INFT nftContract; // the artist's SageNFT contract
        IWhitelist whitelist; // optional allowlist gate (AddressZero = open)
        uint256 costTokens; // Mint price in SAGE wei (or ETH wei for ETH collections)
        uint256 id; // Collection id
        address currency; // address(0) = SAGE token, NATIVE_CURRENCY = native ETH
    }

    // Sentinel meaning "native ETH"
    address public constant NATIVE_CURRENCY =
        0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE;

    event CollectionCreated(uint256 indexed id, address indexed nftContract);
    event CollectionMint(
        address indexed user,
        uint256 indexed id,
        uint256 amount,
        uint256 firstIndex
    );

    // collectionId => Collection
    mapping(uint256 => Collection) public collections;

    // Artist share (bps) FROZEN per collection at creation, so a drop's split
    // can never shift mid-sale when the dashboard dial changes. 0 = falls
    // back to the live SageConfig value.
    mapping(uint256 => uint256) public collectionArtistShare;

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
    // as a codehash reference (see _isTrustedNft), never called into. Works
    // equally well for collection drops' STANDALONE per-drop NFT contracts
    // (not registered in NFTFactory) since it's a pure bytecode comparison,
    // not a factory-registry lookup.
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
     *  flow). Safe because the collection's payout/mint target IS the same
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

    constructor(address _sageStorage, address _token) {
        sageStorage = ISageStorage(_sageStorage);
        token = IERC20(_token);
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

    function isWhitelisted(Collection memory _c) internal view {
        IWhitelist whitelist = _c.whitelist;
        if (address(whitelist) != address(0)) {
            require(whitelist.isWhitelisted(msg.sender, 0), "Not whitelisted");
        }
    }

    function createCollection(Collection calldata c)
        public
        onlyAdminOrArtist(c.nftContract)
    {
        require(
            c.startTime > 0 &&
                (c.closeTime == 0 || c.closeTime > c.startTime),
            "Invalid times"
        );
        require(c.maxSupply > 0, "Invalid supply");
        require(bytes(c.baseUri).length > 0, "Invalid baseUri");
        require(
            c.currency == address(0) || c.currency == NATIVE_CURRENCY,
            "Unsupported currency"
        );
        // required once non-admins can call this — a self-serve caller could
        // otherwise pass an existing id + their OWN nftContract and overwrite
        // someone else's collection (the DB's ids are sequential/guessable)
        require(collections[c.id].startTime == 0, "Collection already exists");
        collections[c.id] = c;
        // freeze the platform split for this collection at its creation-time value
        collectionArtistShare[c.id] = _primaryArtistShare();
        emit CollectionCreated(c.id, address(c.nftContract));
    }

    /** Corrective/backfill setter for a collection's frozen artist share.
     *  0 resets the collection to follow the live SageConfig value. */
    function setCollectionArtistShare(uint256 _id, uint256 _shareBps)
        external
    {
        require(collections[_id].startTime > 0, "Collection doesn't exist");
        require(
            sageStorage.hasRole(keccak256("role.admin"), msg.sender) ||
                msg.sender == collections[_id].nftContract.artist(),
            "Admin or the NFT's artist only"
        );
        require(_shareBps <= 10000, "Invalid share");
        collectionArtistShare[_id] = _shareBps;
    }

    function setWhitelist(uint256 _id, address _whitelist) public {
        require(collections[_id].startTime > 0, "Collection doesn't exist");
        require(
            sageStorage.hasRole(keccak256("role.admin"), msg.sender) ||
                msg.sender == collections[_id].nftContract.artist(),
            "Admin or the NFT's artist only"
        );
        collections[_id].whitelist = IWhitelist(_whitelist);
    }

    function getCollection(uint256 _id)
        public
        view
        returns (Collection memory)
    {
        return collections[_id];
    }

    function getMintCount(uint256 _id) public view returns (uint32) {
        return collections[_id].mintCount;
    }

    function mint(uint256 _id, uint256 _amount) public payable whenNotPaused {
        require(_amount > 0, "Can't mint 0");
        Collection storage c = collections[_id];
        // closeTime 0 = no deadline: the mint stays open until the supply cap
        // below closes it naturally (sell-out IS the closing condition)
        require(
            c.startTime <= block.timestamp &&
                (c.closeTime == 0 || c.closeTime > block.timestamp),
            "Not open"
        );
        require(
            c.mintCount + _amount <= c.maxSupply,
            "Not enough supply left"
        );

        isWhitelisted(c);

        if (c.limitPerUser > 0) {
            require(
                _amount + mintedByUser[_id][msg.sender] <= c.limitPerUser,
                "Mint limit reached"
            );
        }

        mintedByUser[_id][msg.sender] += _amount;
        uint256 firstIndex = c.mintCount + 1;
        c.mintCount += uint32(_amount);

        uint256 totalCostInTokens = c.costTokens * _amount;
        if (totalCostInTokens > 0) {
            uint256 share = collectionArtistShare[_id];
            if (share == 0) share = _primaryArtistShare();
            uint256 artistShare = (totalCostInTokens * share) / 10000;
            if (c.currency == NATIVE_CURRENCY) {
                require(msg.value == totalCostInTokens, "Wrong ETH amount");
                (bool okArtist, ) = c.nftContract.artist().call{
                    value: artistShare
                }("");
                require(okArtist, "Artist ETH transfer failed");
                (bool okPlatform, ) = sageStorage.multisig().call{
                    value: totalCostInTokens - artistShare
                }("");
                require(okPlatform, "Platform ETH transfer failed");
            } else {
                require(msg.value == 0, "Collection is not priced in ETH");
                token.transferFrom(
                    msg.sender,
                    c.nftContract.artist(),
                    artistShare
                );
                token.transferFrom(
                    msg.sender,
                    sageStorage.multisig(),
                    totalCostInTokens - artistShare
                );
            }
        } else {
            require(msg.value == 0, "Mint is free");
        }

        // sequential assignment: token k (k = firstIndex..firstIndex+amount-1)
        // gets metadata {baseUri}{k}.json — image k of the uploaded set
        for (uint256 i = 0; i < _amount; i++) {
            c.nftContract.safeMint(
                msg.sender,
                string(
                    abi.encodePacked(
                        c.baseUri,
                        Strings.toString(firstIndex + i),
                        ".json"
                    )
                )
            );
        }

        emit CollectionMint(msg.sender, _id, _amount, firstIndex);
    }

    function pause() external onlyAdmin {
        _pause();
    }

    function unpause() external onlyAdmin {
        _unpause();
    }
}
