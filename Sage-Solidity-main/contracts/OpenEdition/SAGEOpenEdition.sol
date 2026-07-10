//SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import "@openzeppelin/contracts/security/Pausable.sol";
import "../../interfaces/IRewards.sol";
import "../../interfaces/IWhitelist.sol";
import "../../interfaces/ISageStorage.sol";
import "../../interfaces/INFT.sol";

contract SAGEOpenEdition is Pausable {
    ISageStorage private sageStorage;
    address private signerAddress;
    IRewards public rewardsContract;
    IERC20 public token;
    mapping(uint256 => mapping(address => uint256)) public mintedByUser;
    uint256 private constant ARTIST_SHARE = 8000;

    struct OpenEdition {
        uint32 startTime; // Timestamp where users can start minting
        uint32 closeTime; // Timestamp where minting ends
        uint32 costPoints; // Cost per mint in Pixel points
        uint32 limitPerUser; // Amount of NFTs each user can mint
        uint32 mintCount; // Number of NFTs minted
        string nftUri; // URI of the NFT to be minted
        INFT nftContract; // reference to the NFT Contract
        IWhitelist whitelist; // whitelist contract address
        uint256 costTokens; // Cost per mint in ASH
        uint256 id; // Open edition id
    }

    event OpenEditionCreated(uint256 indexed id, address indexed nftContract);
    event BatchMint(address indexed user, uint256 indexed id, uint256 amount);

    // mapping openEditionId => OpenEdition
    mapping(uint256 => OpenEdition) public openEditions;

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
    ) public {
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

    function createOpenEdition(OpenEdition calldata oe) public onlyAdmin {
        require(
            oe.startTime > 0 && oe.closeTime > oe.startTime,
            "Invalid times"
        );
        openEditions[oe.id] = oe;
    }

    function setWhitelist(uint256 _id, address _whitelist) public onlyAdmin {
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

    function batchMint(uint256 _id, uint256 _amount) public whenNotPaused {
        require(_amount > 0, "Can't mint 0");
        OpenEdition storage oe = openEditions[_id];
        require(
            oe.startTime <= block.timestamp && oe.closeTime > block.timestamp,
            "Not open"
        );

        isWhitelisted(oe);

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
            uint256 artistShare = (totalCostInTokens * ARTIST_SHARE) / 10000;
            token.transferFrom(
                msg.sender,
                oe.nftContract.artist(),
                artistShare
            );
            token.transferFrom(
                msg.sender,
                sageStorage.multisig(),
                totalCostInTokens - artistShare
            );
        }
        for (uint256 i = 0; i < _amount; i++) {
            oe.nftContract.safeMint(msg.sender, nftUri);
        }

        emit BatchMint(msg.sender, _id, _amount);
    }
}
