//SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

import "@openzeppelin/contracts/token/ERC721/IERC721.sol";
import "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "../../interfaces/INFT.sol";
import "../../interfaces/IERC2981.sol";
import "../../interfaces/ISageStorage.sol";

contract Marketplace {
    IERC20 public token;
    ISageStorage immutable sageStorage;
    uint256 private constant ARTIST_SHARE = 8000;

    mapping(bytes32 => bool) private cancelledOrders;

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
            isSellOffer,
            signature
        );
        cancelledOrders[message] = true;
    }

    function buyFromSellOffer(
        address signer,
        address contractAddress,
        uint256 price,
        uint256 tokenId,
        uint256 expiresAt,
        uint256 chainId,
        bytes calldata signature
    ) public {
        require(expiresAt > block.timestamp, "Offer expired");
        bytes32 message = verifySignature(
            signer,
            contractAddress,
            price,
            tokenId,
            expiresAt,
            chainId,
            true,
            signature
        );
        IERC721 nftContract = IERC721(contractAddress);
        address currentOwner = nftContract.ownerOf(tokenId);
        require(signer == currentOwner, "Offer not signed by token owner");

        require(!cancelledOrders[message], "Offer was cancelled");
        cancelledOrders[message] = true;
        nftContract.safeTransferFrom(currentOwner, msg.sender, tokenId, "");
        if (currentOwner == INFT(contractAddress).artist()) {
            uint256 artistShare = (price * ARTIST_SHARE) / 10000;
            token.transferFrom(
                msg.sender,
                INFT(contractAddress).artist(),
                artistShare
            );
            token.transferFrom(
                msg.sender,
                sageStorage.multisig(),
                price - artistShare
            );
        } else {
            (address royaltyDest, uint256 royaltyValue) = IERC2981(
                contractAddress
            ).royaltyInfo(tokenId, price);
            token.transferFrom(msg.sender, royaltyDest, royaltyValue);
            token.transferFrom(msg.sender, signer, price - royaltyValue);
        }
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
        bytes calldata signature
    ) public {
        require(expiresAt > block.timestamp, "Offer expired");
        bytes32 message = verifySignature(
            buyer,
            contractAddress,
            price,
            tokenId,
            expiresAt,
            chainId,
            false,
            signature
        );
        IERC721 nftContract = IERC721(contractAddress);
        address currentOwner = nftContract.ownerOf(tokenId);
        require(msg.sender == currentOwner, "Not the token owner");

        require(!cancelledOrders[message], "Offer was cancelled");
        cancelledOrders[message] = true;
        nftContract.safeTransferFrom(currentOwner, buyer, tokenId, "");
        if (currentOwner == INFT(contractAddress).artist()) {
            uint256 artistShare = (price * ARTIST_SHARE) / 10000;
            token.transferFrom(
                buyer,
                INFT(contractAddress).artist(),
                artistShare
            );
            token.transferFrom(
                buyer,
                sageStorage.multisig(),
                price - artistShare
            );
        } else {
            (address royaltyDest, uint256 royaltyValue) = IERC2981(
                contractAddress
            ).royaltyInfo(tokenId, price);
            token.transferFrom(buyer, royaltyDest, royaltyValue);
            token.transferFrom(buyer, currentOwner, price - royaltyValue);
        }
        emit ListedNFTSold(
            currentOwner,
            buyer,
            contractAddress,
            tokenId,
            price
        );
    }
}
