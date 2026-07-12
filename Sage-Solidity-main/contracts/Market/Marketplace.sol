//SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

import "@openzeppelin/contracts/token/ERC721/IERC721.sol";
import "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "../../interfaces/INFT.sol";
import "../../interfaces/IERC2981.sol";
import "../../interfaces/ISageStorage.sol";
import "../../interfaces/ISageConfig.sol";

contract Marketplace {
    IERC20 public token;
    ISageStorage immutable sageStorage;
    // Fallback artist share of primary sales; the live value is read from
    // SageConfig at sale time (_primaryArtistShare) so the platform cut is
    // dashboard-settable without a redeploy.
    uint256 private constant DEFAULT_ARTIST_SHARE = 8000;
    bytes32 private constant CONFIG_KEY =
        keccak256(abi.encodePacked("address.config"));
    bytes32 private constant PRIMARY_ARTIST_SHARE_KEY =
        keccak256(abi.encodePacked("share.primaryArtist"));
    // SageStorage key holding the platform's royalty receiver; when unset the
    // platform's royalty cut falls back to the multisig.
    bytes32 private constant PLATFORM_ROYALTY_KEY =
        keccak256(abi.encodePacked("address.royalty"));

    mapping(bytes32 => bool) private cancelledOrders;

    // Sentinel meaning "native ETH". address(0) = the SAGE token. The
    // currency is part of the SIGNED offer message, so a listing priced in
    // one currency can never be executed as a payment in the other.
    address public constant NATIVE_CURRENCY =
        0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE;

    event ListedNFTSold(
        address indexed seller,
        address indexed buyer,
        address indexed contractAddress,
        uint256 tokenId,
        uint256 price
    );

    constructor(address _storage, address _token) {
        sageStorage = ISageStorage(_storage);
        token = IERC20(_token);
    }

    // Builds a prefixed hash to mimic the behavior of eth_sign.
    function prefixed(bytes32 hash) internal pure returns (bytes32) {
        return
            keccak256(
                abi.encodePacked("\x19Ethereum Signed Message:\n32", hash)
            );
    }

    function verifySignature(
        address signer,
        address contractAddress,
        uint256 price,
        uint256 tokenId,
        uint256 expiresAt,
        uint256 chainId,
        address currency,
        bool sellOrder,
        bytes calldata signature
    ) internal pure returns (bytes32) {
        bytes32 message = prefixed(
            keccak256(
                abi.encode(
                    signer,
                    contractAddress,
                    price,
                    tokenId,
                    expiresAt,
                    chainId,
                    currency,
                    sellOrder
                )
            )
        );
        require(
            ECDSA.recover(message, signature) == signer,
            "Invalid signature"
        );
        return message;
    }

    function cancelSignedOffer(
        address signer,
        address contractAddress,
        uint256 price,
        uint256 tokenId,
        uint256 expiresAt,
        uint256 chainId,
        address currency,
        bool isSellOffer,
        bytes calldata signature
    ) public {
        require(msg.sender == signer, "Can only cancel own offers");

        bytes32 message = verifySignature(
            signer,
            contractAddress,
            price,
            tokenId,
            expiresAt,
            chainId,
            currency,
            isSellOffer,
            signature
        );
        cancelledOrders[message] = true;
    }

    /**
     * @dev Shared payout for both offer directions.
     * - Artist as seller: primary economics (_primaryArtistShare, default 80/20).
     * - True secondary: EIP-2981 royalty. For new-generation SageNFT contracts
     *   (public artistShare getter) the royalty is SPLIT AT SALE TIME — artist
     *   share straight to the artist wallet, remainder to the multisig — so
     *   nothing pools in the NFT contract. Legacy SageNFTs (no getter → the
     *   probe reverts) keep the old behavior: royalty to the contract, later
     *   split by withdraw(). External 2981 receivers are paid directly.
     */
    /** Artist share of primary sales in bps, read live from SageConfig
     *  (resolved via SageStorage's address.config key). Falls back to the
     *  historical 8000 while the config contract or key is unset. */
    function _primaryArtistShare() internal view returns (uint256) {
        address cfg = sageStorage.getAddress(CONFIG_KEY);
        if (cfg == address(0)) return DEFAULT_ARTIST_SHARE;
        uint256 share = ISageConfig(cfg).getUint(PRIMARY_ARTIST_SHARE_KEY);
        return share == 0 ? DEFAULT_ARTIST_SHARE : share;
    }

    /** Platform's royalty receiver: the address.royalty storage key, or the
     *  multisig while the key is unset. Applies to ROYALTY cuts only —
     *  primary-sale platform cuts keep going to the multisig. */
    function _platformRoyaltyDest() internal view returns (address) {
        address dest = sageStorage.getAddress(PLATFORM_ROYALTY_KEY);
        return dest == address(0) ? sageStorage.multisig() : dest;
    }

    /** Moves `amount` of the sale currency from the buyer to `to`. For SAGE
     *  this pulls via transferFrom; for native ETH it forwards a slice of the
     *  msg.value already held by this contract. */
    function _pay(
        address currency,
        address payer,
        address to,
        uint256 amount
    ) internal {
        if (amount == 0) return;
        if (currency == NATIVE_CURRENCY) {
            (bool ok, ) = to.call{value: amount}("");
            require(ok, "ETH transfer failed");
        } else {
            token.transferFrom(payer, to, amount);
        }
    }

    function _settleSale(
        address payer,
        address seller,
        address contractAddress,
        uint256 tokenId,
        uint256 price,
        address currency
    ) internal {
        address artist = INFT(contractAddress).artist();
        if (seller == artist) {
            uint256 artistCut = (price * _primaryArtistShare()) / 10000;
            _pay(currency, payer, artist, artistCut);
            _pay(currency, payer, sageStorage.multisig(), price - artistCut);
            return;
        }
        (address royaltyDest, uint256 royaltyValue) = IERC2981(contractAddress)
            .royaltyInfo(tokenId, price);
        if (royaltyValue > 0) {
            if (royaltyDest == contractAddress) {
                try INFT(contractAddress).artistShare() returns (
                    uint256 share
                ) {
                    uint256 toArtist = (royaltyValue * share) / 10000;
                    _pay(currency, payer, artist, toArtist);
                    _pay(
                        currency,
                        payer,
                        _platformRoyaltyDest(),
                        royaltyValue - toArtist
                    );
                } catch {
                    _pay(currency, payer, royaltyDest, royaltyValue);
                }
            } else {
                _pay(currency, payer, royaltyDest, royaltyValue);
            }
        }
        _pay(currency, payer, seller, price - royaltyValue);
    }

    function buyFromSellOffer(
        address signer,
        address contractAddress,
        uint256 price,
        uint256 tokenId,
        uint256 expiresAt,
        uint256 chainId,
        address currency,
        bytes calldata signature
    ) public payable {
        require(expiresAt > block.timestamp, "Offer expired");
        if (currency == NATIVE_CURRENCY) {
            require(msg.value == price, "Wrong ETH amount");
        } else {
            require(currency == address(0), "Unsupported currency");
            require(msg.value == 0, "Listing is not priced in ETH");
        }
        bytes32 message = verifySignature(
            signer,
            contractAddress,
            price,
            tokenId,
            expiresAt,
            chainId,
            currency,
            true,
            signature
        );
        IERC721 nftContract = IERC721(contractAddress);
        address currentOwner = nftContract.ownerOf(tokenId);
        require(signer == currentOwner, "Offer not signed by token owner");

        require(!cancelledOrders[message], "Offer was cancelled");
        cancelledOrders[message] = true;
        nftContract.safeTransferFrom(currentOwner, msg.sender, tokenId, "");
        _settleSale(
            msg.sender,
            signer,
            contractAddress,
            tokenId,
            price,
            currency
        );
        emit ListedNFTSold(
            currentOwner,
            msg.sender,
            contractAddress,
            tokenId,
            price
        );
    }

    function sellFromBuyOffer(
        address buyer,
        address contractAddress,
        uint256 price,
        uint256 tokenId,
        uint256 expiresAt,
        uint256 chainId,
        address currency,
        bytes calldata signature
    ) public {
        require(expiresAt > block.timestamp, "Offer expired");
        // A buy offer is executed by the SELLER, so the buyer's ETH cannot
        // ride along as msg.value — native-ETH buy offers are impossible
        // without a wrapped token. SAGE only.
        require(currency == address(0), "ETH buy offers not supported");
        bytes32 message = verifySignature(
            buyer,
            contractAddress,
            price,
            tokenId,
            expiresAt,
            chainId,
            currency,
            false,
            signature
        );
        IERC721 nftContract = IERC721(contractAddress);
        address currentOwner = nftContract.ownerOf(tokenId);
        require(msg.sender == currentOwner, "Not the token owner");

        require(!cancelledOrders[message], "Offer was cancelled");
        cancelledOrders[message] = true;
        nftContract.safeTransferFrom(currentOwner, buyer, tokenId, "");
        _settleSale(
            buyer,
            currentOwner,
            contractAddress,
            tokenId,
            price,
            currency
        );
        emit ListedNFTSold(
            currentOwner,
            buyer,
            contractAddress,
            tokenId,
            price
        );
    }
}
