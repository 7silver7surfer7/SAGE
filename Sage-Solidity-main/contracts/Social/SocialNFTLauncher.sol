// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

import '@openzeppelin/contracts/token/ERC721/ERC721.sol';
import '@openzeppelin/contracts/security/ReentrancyGuard.sol';
import '@openzeppelin/contracts/utils/Strings.sol';

interface IMintable {
    function mintTo(address to) external returns (uint256);
    function minted() external view returns (uint256);
}

/**
 * An open-edition NFT launched from SAGE Social: every token shares the
 * edition's metadata URI, ids are sequential, and only the launcher mints.
 */
contract SocialEditionNFT is ERC721 {
    address public immutable launcher;
    address public immutable artist;
    string private _uri;
    uint256 public immutable maxSupply;
    uint256 public minted;

    constructor(
        string memory name_,
        string memory symbol_,
        string memory uri_,
        uint256 maxSupply_,
        address artist_
    ) ERC721(name_, symbol_) {
        launcher = msg.sender;
        artist = artist_;
        _uri = uri_;
        maxSupply = maxSupply_;
    }

    function tokenURI(uint256 tokenId) public view override returns (string memory) {
        require(tokenId > 0 && tokenId <= minted, 'no such token');
        return _uri;
    }

    function mintTo(address to) external returns (uint256 tokenId) {
        require(msg.sender == launcher, 'launcher only');
        require(minted < maxSupply, 'sold out');
        tokenId = ++minted;
        _safeMint(to, tokenId);
    }
}

/**
 * A generative collection launched from SAGE Social: each token has UNIQUE
 * metadata at baseUri/{tokenId}.json (a Filebase/IPFS directory built from
 * the artist's uploaded ZIP). Sequential mint, launcher-only.
 */
contract SocialCollectionNFT is ERC721 {
    using Strings for uint256;

    address public immutable launcher;
    address public immutable artist;
    string public baseUri; // ipfs://CID/  (trailing slash)
    uint256 public immutable maxSupply;
    uint256 public minted;

    constructor(
        string memory name_,
        string memory symbol_,
        string memory baseUri_,
        uint256 maxSupply_,
        address artist_
    ) ERC721(name_, symbol_) {
        launcher = msg.sender;
        artist = artist_;
        baseUri = baseUri_;
        maxSupply = maxSupply_;
    }

    function tokenURI(uint256 tokenId) public view override returns (string memory) {
        require(tokenId > 0 && tokenId <= minted, 'no such token');
        return string(abi.encodePacked(baseUri, tokenId.toString(), '.json'));
    }

    function mintTo(address to) external returns (uint256 tokenId) {
        require(msg.sender == launcher, 'launcher only');
        require(minted < maxSupply, 'sold out');
        tokenId = ++minted;
        _safeMint(to, tokenId);
    }
}

/**
 * SocialNFTLauncher — self-serve NFT edition mints for SAGE Social artists
 * and projects, with pump.fun-shaped fees:
 *  - creating an edition is FREE (gas only)
 *  - every mint pays FEE_BPS (1%) of the mint price to the platform
 *    treasury; the remaining 99% goes straight to the artist
 *  - the MINTER pays their own gas (they call mint themselves)
 */
contract SocialNFTLauncher is ReentrancyGuard {
    uint16 public constant FEE_BPS = 100; // 1% of mint volume to the platform

    address public immutable treasury;

    struct Edition {
        address artist;
        uint256 priceWei;
        uint256 maxSupply;
        bool isCollection; // true = per-token metadata (ZIP batch)
    }

    mapping(address => Edition) public editions;
    address[] public allEditions;

    event EditionCreated(
        address indexed edition,
        address indexed artist,
        string name,
        string symbol,
        uint256 priceWei,
        uint256 maxSupply,
        bool isCollection
    );
    event Minted(address indexed edition, address indexed minter, uint256 tokenId, uint256 paid, uint256 fee);

    constructor(address _treasury) {
        require(_treasury != address(0), 'bad treasury');
        treasury = _treasury;
    }

    function allEditionsLength() external view returns (uint256) {
        return allEditions.length;
    }

    /** Create an edition — FREE, pump.fun-style (gas only). */
    function createEdition(
        string calldata name_,
        string calldata symbol_,
        string calldata uri_,
        uint256 maxSupply_,
        uint256 priceWei_
    ) external nonReentrant returns (address edition) {
        require(bytes(name_).length > 0 && bytes(symbol_).length > 0, 'name/symbol required');
        require(maxSupply_ > 0 && maxSupply_ <= 1_000_000, 'supply 1-1000000');
        edition = address(new SocialEditionNFT(name_, symbol_, uri_, maxSupply_, msg.sender));
        editions[edition] = Edition({ artist: msg.sender, priceWei: priceWei_, maxSupply: maxSupply_, isCollection: false });
        allEditions.push(edition);
        emit EditionCreated(edition, msg.sender, name_, symbol_, priceWei_, maxSupply_, false);
    }

    /**
     * Create a generative COLLECTION — each token gets unique metadata at
     * baseUri_/{id}.json (a Filebase/IPFS directory built off the artist's
     * ZIP). Free to create, same 1%/99% mint split as an edition.
     */
    function createCollection(
        string calldata name_,
        string calldata symbol_,
        string calldata baseUri_,
        uint256 maxSupply_,
        uint256 priceWei_
    ) external nonReentrant returns (address edition) {
        require(bytes(name_).length > 0 && bytes(symbol_).length > 0, 'name/symbol required');
        require(maxSupply_ > 0 && maxSupply_ <= 1_000_000, 'supply 1-1000000');
        edition = address(new SocialCollectionNFT(name_, symbol_, baseUri_, maxSupply_, msg.sender));
        editions[edition] = Edition({ artist: msg.sender, priceWei: priceWei_, maxSupply: maxSupply_, isCollection: true });
        allEditions.push(edition);
        emit EditionCreated(edition, msg.sender, name_, symbol_, priceWei_, maxSupply_, true);
    }

    /** Mint one — the minter pays price + their own gas. 1% to the treasury, 99% to the artist. */
    function mint(address edition) external payable nonReentrant returns (uint256 tokenId) {
        Edition storage e = editions[edition];
        require(e.artist != address(0), 'unknown edition');
        require(msg.value >= e.priceWei, 'underpaid');
        // both SocialEditionNFT and SocialCollectionNFT expose mintTo(address)
        tokenId = IMintable(edition).mintTo(msg.sender);
        uint256 fee = (msg.value * FEE_BPS) / 10000;
        _pay(treasury, fee);
        _pay(e.artist, msg.value - fee);
        emit Minted(edition, msg.sender, tokenId, msg.value, fee);
    }

    function mintedOf(address edition) external view returns (uint256) {
        return IMintable(edition).minted();
    }

    function _pay(address to, uint256 amount) private {
        if (amount == 0) return;
        (bool ok, ) = payable(to).call{value: amount}('');
        require(ok, 'eth transfer failed');
    }
}
