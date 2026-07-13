// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

import '@openzeppelin/contracts/utils/cryptography/ECDSA.sol';
import '@openzeppelin/contracts/utils/cryptography/draft-EIP712.sol';

interface ISageNFT {
    function safeMint(address to, string calldata uri) external;
}

/**
 * SocialCollectMinter — collectors mint SAGE Social post-NFTs THEMSELVES
 * (paying their own gas) with a platform-signed EIP-712 voucher. The server
 * settles the payment (pixels/SAGE/ETH) off-chain, signs a voucher binding
 * (postId, collector, tokenURI), and the collector redeems it here. This
 * contract holds storage role.minter so SageNFT.safeMint accepts it.
 */
contract SocialCollectMinter is EIP712 {
    bytes32 private constant VOUCHER_TYPEHASH =
        keccak256('CollectVoucher(uint256 postId,address collector,string uri)');

    ISageNFT public immutable nft;
    address public immutable voucherSigner;
    mapping(bytes32 => bool) public redeemed; // keccak(postId, collector)

    event Collected(uint256 indexed postId, address indexed collector);

    constructor(address _nft, address _voucherSigner) EIP712('SAGESocialCollect', '1') {
        require(_nft != address(0) && _voucherSigner != address(0), 'bad params');
        nft = ISageNFT(_nft);
        voucherSigner = _voucherSigner;
    }

    function mintWithVoucher(uint256 postId, string calldata uri, bytes calldata signature) external {
        bytes32 key = keccak256(abi.encode(postId, msg.sender));
        require(!redeemed[key], 'already collected');
        bytes32 digest = _hashTypedDataV4(
            keccak256(abi.encode(VOUCHER_TYPEHASH, postId, msg.sender, keccak256(bytes(uri))))
        );
        require(ECDSA.recover(digest, signature) == voucherSigner, 'invalid voucher');
        redeemed[key] = true;
        nft.safeMint(msg.sender, uri);
        emit Collected(postId, msg.sender);
    }
}
