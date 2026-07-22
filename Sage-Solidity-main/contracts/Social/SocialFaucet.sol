// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

import '@openzeppelin/contracts/token/ERC20/IERC20.sol';
import '@openzeppelin/contracts/access/Ownable.sol';
import '@openzeppelin/contracts/security/ReentrancyGuard.sol';
import '@openzeppelin/contracts/utils/cryptography/ECDSA.sol';
import '@openzeppelin/contracts/utils/cryptography/draft-EIP712.sol';

/**
 * SocialFaucet — a wallet's ONE lifetime SAGE claim, gated by a platform-
 * signed EIP-712 voucher (same shape as SocialCollectMinter's buyer-paid
 * mint vouchers). A contract has no way to see a caller's IP address, so the
 * one-claim-per-network rule is enforced off-chain: the server only signs a
 * voucher for (this contract, claimant) after checking its own DB that
 * neither that wallet nor that request's IP hash has claimed before. This
 * contract independently enforces the once-per-WALLET half on-chain via
 * {claimed}, so a leaked/forwarded voucher still can't be redeemed twice.
 *
 * The owner can {setActive} to pause/resume, retune {setDripAmount},
 * rotate {setVoucherSigner} if that key ever needs to change, and {drain}
 * the contract's SAGE back out (partial amount, or amount=0 for
 * everything).
 */
contract SocialFaucet is Ownable, ReentrancyGuard, EIP712 {
    bytes32 private constant VOUCHER_TYPEHASH = keccak256('FaucetVoucher(address claimant)');

    IERC20 public immutable sage;
    uint256 public dripAmount;
    bool public active = true;
    address public voucherSigner;
    mapping(address => bool) public claimed;

    event Claimed(address indexed user, uint256 amount);
    event FaucetToggled(bool active);
    event DripAmountUpdated(uint256 amount);
    event VoucherSignerUpdated(address signer);
    event Funded(address indexed from, uint256 amount);
    event Drained(address indexed to, uint256 amount);

    constructor(
        address sageToken,
        uint256 initialDripAmount,
        address _voucherSigner
    ) EIP712('SAGESocialFaucet', '1') {
        require(sageToken != address(0), 'bad token');
        require(_voucherSigner != address(0), 'bad signer');
        sage = IERC20(sageToken);
        dripAmount = initialDripAmount;
        voucherSigner = _voucherSigner;
    }

    /** One claim per wallet, ever. `signature` proves the server cleared this wallet's IP too. */
    function claim(bytes calldata signature) external nonReentrant {
        require(active, 'faucet is paused');
        require(!claimed[msg.sender], 'already claimed');
        require(dripAmount > 0, 'drip amount is zero');
        require(sage.balanceOf(address(this)) >= dripAmount, 'faucet is empty');
        bytes32 digest = _hashTypedDataV4(keccak256(abi.encode(VOUCHER_TYPEHASH, msg.sender)));
        require(ECDSA.recover(digest, signature) == voucherSigner, 'invalid voucher');
        claimed[msg.sender] = true;
        require(sage.transfer(msg.sender, dripAmount), 'transfer failed');
        emit Claimed(msg.sender, dripAmount);
    }

    /** Pause or resume claims without moving any funds. */
    function setActive(bool _active) external onlyOwner {
        active = _active;
        emit FaucetToggled(_active);
    }

    /** Tune how much SAGE each claim pays out. */
    function setDripAmount(uint256 amount) external onlyOwner {
        dripAmount = amount;
        emit DripAmountUpdated(amount);
    }

    /** Rotate the platform voucher-signing key (e.g. operator key rotation). */
    function setVoucherSigner(address _voucherSigner) external onlyOwner {
        require(_voucherSigner != address(0), 'bad signer');
        voucherSigner = _voucherSigner;
        emit VoucherSignerUpdated(_voucherSigner);
    }

    /** Top up the faucet — caller must approve this contract for `amount` first. */
    function fund(uint256 amount) external {
        require(sage.transferFrom(msg.sender, address(this), amount), 'transferFrom failed');
        emit Funded(msg.sender, amount);
    }

    /** Pull SAGE back out — amount=0 drains the entire balance. */
    function drain(address to, uint256 amount) external onlyOwner nonReentrant {
        require(to != address(0), 'bad recipient');
        uint256 bal = sage.balanceOf(address(this));
        uint256 sendAmount = amount == 0 ? bal : amount;
        require(sendAmount <= bal, 'amount exceeds balance');
        require(sage.transfer(to, sendAmount), 'transfer failed');
        emit Drained(to, sendAmount);
    }
}
