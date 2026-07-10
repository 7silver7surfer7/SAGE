//SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;
import "@openzeppelin/contracts/token/ERC1155/extensions/ERC1155Supply.sol";

import "@openzeppelin/contracts/access/AccessControl.sol";
import "../Utils/StringUtils.sol";
import "../../interfaces/INFT.sol";

contract NFT is ERC1155Supply, AccessControl, INFT {
    bytes4 private constant INTERFACE_ID_ERC2981 = 0x2a55205a;
    bytes32 public constant MINTER_ROLE = keccak256("MINTER_ROLE");

    string public name;
    // Contract symbol
    string public symbol;

    // tokenId => collectionId
    mapping(uint256 => uint256) public tokenToCollection;

    // collectionId => collection info
    mapping(uint256 => CollectionInfo) public collections;

    // collectionId => array of NFT ids
    mapping(uint256 => uint256[]) public nftsInCollection;

    event CollectionCreated(
        uint256 collectionId,
        address royaltyDestination,
        uint16 royaltyPercentage,
        string baseMetadataURI
    );
    struct CollectionInfo {
        uint16 royalty;
        address royaltyDestination;
        address primarySalesDestination;
        string dropMetadataURI;
    }

    /**
     * @dev Throws if not called by an admin account.
     */
    modifier onlyAdmin() {
        require(hasRole(DEFAULT_ADMIN_ROLE, msg.sender), "Admin calls only");
        _;
    }

    function supportsInterface(bytes4 interfaceId)
        public
        view
        virtual
        override(AccessControl, ERC1155)
        returns (bool)
    {
        return
            interfaceId == type(IERC1155).interfaceId ||
            interfaceId == INTERFACE_ID_ERC2981 ||
            interfaceId == type(IAccessControl).interfaceId ||
            super.supportsInterface(interfaceId);
    }

    constructor(
        string memory _name,
        string memory _symbol,
        address _admin
    ) ERC1155("") {
        name = _name;
        symbol = _symbol;
        _setupRole(DEFAULT_ADMIN_ROLE, _admin);
    }

    function getCollectionInfo(uint256 _collectionId)
        public
        view
        returns (
            address,
            uint16,
            string memory,
            address
        )
    {
        return (
            collections[_collectionId].royaltyDestination,
            collections[_collectionId].royalty,
            collections[_collectionId].dropMetadataURI,
            collections[_collectionId].primarySalesDestination
        );
    }

    /**
     * @notice Changes information about a collection (drop).
     * @param _collectionId the collectionId
     * @param _royaltyDestination the royalty destination address
     * @param _royaltyPercentage the royalty percentage in base points (200 = 2%)
     * @param _dropMetadataURI the metadata URI of the drop
     */
    function setCollection(
        uint256 _collectionId,
        address _royaltyDestination,
        uint16 _royaltyPercentage,
        address _primarySalesDestination,
        string memory _dropMetadataURI
    ) public {
        require(
            hasRole(DEFAULT_ADMIN_ROLE, msg.sender),
            "NFT: Only Admin can set collection info"
        );
        require(_royaltyDestination != address(0));
        collections[_collectionId].royaltyDestination = _royaltyDestination;
        collections[_collectionId]
            .primarySalesDestination = _primarySalesDestination;
        collections[_collectionId].royalty = _royaltyPercentage;
        collections[_collectionId].dropMetadataURI = _dropMetadataURI;
    }

    /**
     * @notice Creates a new collection.
     * @param _collectionId the collection id
     * @param _royaltyDestination the wallet address of the artist
     * @param _royaltyPercentage the royalty percentage in base points (200 = 2%)
     * @param _dropMetadataURI the metadata URI of the drop
     * @param _primarySalesDestination the wallet address to receive primary sales of the collection
     */
    function createCollection(
        uint256 _collectionId,
        address _royaltyDestination,
        uint16 _royaltyPercentage,
        string memory _dropMetadataURI,
        address _primarySalesDestination
    ) external {
        require(
            hasRole(DEFAULT_ADMIN_ROLE, msg.sender),
            "ERC1155.createCollection only Admin or Minter can create"
        );
        require(
            collections[_collectionId].royaltyDestination == address(0),
            "Collection already exists"
        );
        require(
            _royaltyDestination != address(0),
            "Royalty destination address can't be 0"
        );
        CollectionInfo memory collection = CollectionInfo(
            _royaltyPercentage,
            _royaltyDestination,
            _primarySalesDestination,
            _dropMetadataURI
        );

        collections[_collectionId] = collection;

        emit CollectionCreated(
            _collectionId,
            _royaltyDestination,
            _royaltyPercentage,
            _dropMetadataURI
        );
    }

    function collectionExists(uint256 _collectionId)
        public
        view
        returns (bool)
    {
        return collections[_collectionId].primarySalesDestination != address(0);
    }

    /**
     * @dev Mints some amount of tokens to an address
     * @param _to          Address of the future owner of the token
     * @param _id          Token ID to mint
     * @param _quantity    Amount of tokens to mint
     * @param _data        Data to pass if receiver is contract
     */
    function mint(
        address _to,
        uint256 _id,
        uint32 _quantity,
        uint256 _collectionId,
        bytes memory _data
    ) public {
        require(hasRole(MINTER_ROLE, msg.sender), "NFT: No minting privileges");
        if (tokenToCollection[_id] == 0) {
            tokenToCollection[_id] = _collectionId;
            nftsInCollection[_collectionId].push(_id);
        }
        _mint(_to, _id, _quantity, _data);
    }

    function setCollectionBaseMetadataURI(
        uint256 _collectionId,
        string memory _newBaseMetadataURI
    ) public onlyAdmin {
        collections[_collectionId].dropMetadataURI = _newBaseMetadataURI;
    }

    function uri(uint256 _id) public view override returns (string memory) {
        require(exists(_id), "NONEXISTENT_TOKEN");

        return
            string.concat(
                collections[tokenToCollection[_id]].dropMetadataURI,
                StringUtils.uint2str(_id)
            );
    }

    /**
     * @notice Calculates royalties based on a sale price provided following EIP-2981.
     * Solution is agnostic of the sale price unit and will answer using the same unit.
     * @return  address to receive royaltyAmount, amount to be paid as royalty.
     */
    function royaltyInfo(uint256 tokenId, uint256 salePrice)
        external
        view
        returns (address, uint256)
    {
        CollectionInfo storage collection = collections[
            tokenToCollection[tokenId]
        ];
        return (
            collection.royaltyDestination,
            (salePrice * collection.royalty) / 10000
        );
    }

    function burn(
        address account,
        uint256 id,
        uint256 value
    ) public virtual {
        require(
            account == _msgSender() || isApprovedForAll(account, _msgSender()),
            "ERC1155: caller is not owner nor approved"
        );

        _burn(account, id, value);
    }

    function burnBatch(
        address account,
        uint256[] memory ids,
        uint256[] memory values
    ) public virtual {
        require(
            account == _msgSender() || isApprovedForAll(account, _msgSender()),
            "ERC1155: caller is not owner nor approved"
        );

        _burnBatch(account, ids, values);
    }
}
