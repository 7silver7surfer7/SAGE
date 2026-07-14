// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

import '@openzeppelin/contracts/token/ERC20/IERC20.sol';
import '@openzeppelin/contracts/security/ReentrancyGuard.sol';

interface ISocialTokenFactoryMin {
    function pairOf(address token) external view returns (address);
    function curves(address token)
        external
        view
        returns (
            uint256 virtualTokenReserves,
            uint256 virtualEthReserves,
            uint256 realTokenReserves,
            uint256 realEthReserves,
            address creator,
            bool complete,
            bool airdropEnabled
        );
}

interface IUniswapV2PairMin {
    function getReserves() external view returns (uint112 reserve0, uint112 reserve1, uint32 blockTimestampLast);
    function token0() external view returns (address);
    function swap(uint256 amount0Out, uint256 amount1Out, address to, bytes calldata data) external;
}

interface IWETHMin {
    function deposit() external payable;
    function withdraw(uint256) external;
    function transfer(address, uint256) external returns (bool);
}

/**
 * SageSwapRouter — post-graduation trading with CREATOR REVENUE SHARING.
 *
 * Graduated tokens live on a Uniswap v2 pool whose LP is BURNED (liquidity
 * locked forever). This router is the app's trading path for those pools,
 * mirroring PumpSwap's economics on top of Uniswap's own 0.30% LP fee:
 *
 *   0.25% protocol fee on the ETH side of every swap
 *     ├─ 0.05% accrues to the token's CREATOR (claimable any time)
 *     └─ 0.20% goes to the platform treasury instantly
 *
 * The pool itself stays permissionless — anyone can bypass the router and
 * trade the pair directly with zero protocol fee. The router is the default
 * in-app path, exactly like pump.fun's own AMM frontend.
 *
 * Events mirror the curve factory's Bought/Sold so charts, trade feeds and
 * holder tracking keep working across the graduation boundary unchanged.
 */
contract SageSwapRouter is ReentrancyGuard {
    uint16 public constant ROUTER_FEE_BPS = 25; // 0.25% total on the ETH side
    uint16 public constant CREATOR_FEE_BPS = 5; // of which 0.05% → creator accrual

    ISocialTokenFactoryMin public immutable curveFactory;
    address public immutable weth;
    address public immutable treasury;

    /// token → ETH accrued for its creator, claimable via claimCreatorFees
    mapping(address => uint256) public creatorFees;
    /// token → lifetime ETH earned by its creator through this router
    mapping(address => uint256) public creatorFeesLifetime;

    event Bought(address indexed token, address indexed buyer, uint256 ethIn, uint256 tokensOut, uint256 fee, uint256 creatorFee);
    event Sold(address indexed token, address indexed seller, uint256 tokensIn, uint256 ethOut, uint256 fee, uint256 creatorFee);
    event CreatorFeesClaimed(address indexed token, address indexed creator, uint256 amount);

    constructor(address _curveFactory, address _weth, address _treasury) {
        require(_curveFactory != address(0) && _weth != address(0) && _treasury != address(0), 'bad params');
        curveFactory = ISocialTokenFactoryMin(_curveFactory);
        weth = _weth;
        treasury = _treasury;
    }

    receive() external payable {} // WETH withdrawals

    function _pairFor(address token) internal view returns (address pair) {
        pair = curveFactory.pairOf(token);
        require(pair != address(0), 'not graduated');
    }

    function _creatorOf(address token) internal view returns (address creator) {
        (, , , , creator, , ) = curveFactory.curves(token);
    }

    /** Uniswap v2 output math (0.30% pool fee baked in). */
    function _getAmountOut(uint256 amountIn, uint256 reserveIn, uint256 reserveOut) internal pure returns (uint256) {
        uint256 amountInWithFee = amountIn * 997;
        return (amountInWithFee * reserveOut) / (reserveIn * 1000 + amountInWithFee);
    }

    function _reserves(address pair, address token) internal view returns (uint256 tokenReserve, uint256 wethReserve) {
        (uint112 r0, uint112 r1, ) = IUniswapV2PairMin(pair).getReserves();
        bool tokenIs0 = IUniswapV2PairMin(pair).token0() == token;
        (tokenReserve, wethReserve) = tokenIs0 ? (uint256(r0), uint256(r1)) : (uint256(r1), uint256(r0));
    }

    /** Spot price off the pool: wei per whole token (matches the curve's view). */
    function poolPriceWei(address token) external view returns (uint256) {
        (uint256 tokenReserve, uint256 wethReserve) = _reserves(_pairFor(token), token);
        if (tokenReserve == 0) return 0;
        return (wethReserve * 1 ether) / tokenReserve;
    }

    /** Quote a buy: tokens out for the post-fee ETH input. */
    function quoteBuy(address token, uint256 ethIn) external view returns (uint256) {
        uint256 fee = (ethIn * ROUTER_FEE_BPS) / 10000;
        (uint256 tokenReserve, uint256 wethReserve) = _reserves(_pairFor(token), token);
        return _getAmountOut(ethIn - fee, wethReserve, tokenReserve);
    }

    function buy(address token, uint256 minTokensOut) external payable nonReentrant {
        require(msg.value > 0, 'no eth');
        address pair = _pairFor(token);
        uint256 fee = (msg.value * ROUTER_FEE_BPS) / 10000;
        uint256 creatorFee = (msg.value * CREATOR_FEE_BPS) / 10000;
        uint256 ethIn = msg.value - fee;

        creatorFees[token] += creatorFee;
        creatorFeesLifetime[token] += creatorFee;
        _pay(treasury, fee - creatorFee);

        (uint256 tokenReserve, uint256 wethReserve) = _reserves(pair, token);
        uint256 out = _getAmountOut(ethIn, wethReserve, tokenReserve);
        require(out >= minTokensOut, 'slippage');

        IWETHMin(weth).deposit{ value: ethIn }();
        require(IWETHMin(weth).transfer(pair, ethIn), 'weth transfer failed');
        bool tokenIs0 = IUniswapV2PairMin(pair).token0() == token;
        IUniswapV2PairMin(pair).swap(tokenIs0 ? out : 0, tokenIs0 ? 0 : out, msg.sender, new bytes(0));

        emit Bought(token, msg.sender, ethIn, out, fee, creatorFee);
    }

    function sell(address token, uint256 amountIn, uint256 minEthOut) external nonReentrant {
        require(amountIn > 0, 'no tokens');
        address pair = _pairFor(token);
        (uint256 tokenReserve, uint256 wethReserve) = _reserves(pair, token);
        uint256 wethOut = _getAmountOut(amountIn, tokenReserve, wethReserve);

        require(IERC20(token).transferFrom(msg.sender, pair, amountIn), 'pull failed');
        bool tokenIs0 = IUniswapV2PairMin(pair).token0() == token;
        IUniswapV2PairMin(pair).swap(tokenIs0 ? 0 : wethOut, tokenIs0 ? wethOut : 0, address(this), new bytes(0));
        IWETHMin(weth).withdraw(wethOut);

        uint256 fee = (wethOut * ROUTER_FEE_BPS) / 10000;
        uint256 creatorFee = (wethOut * CREATOR_FEE_BPS) / 10000;
        uint256 ethOut = wethOut - fee;
        require(ethOut >= minEthOut, 'slippage');

        creatorFees[token] += creatorFee;
        creatorFeesLifetime[token] += creatorFee;
        _pay(treasury, fee - creatorFee);
        _pay(msg.sender, ethOut);

        emit Sold(token, msg.sender, amountIn, ethOut, fee, creatorFee);
    }

    /** The creator pulls their accrued revenue share — any time, any amount. */
    function claimCreatorFees(address token) external nonReentrant {
        address creator = _creatorOf(token);
        require(msg.sender == creator, 'not the creator');
        uint256 amount = creatorFees[token];
        require(amount > 0, 'nothing to claim');
        creatorFees[token] = 0;
        _pay(creator, amount);
        emit CreatorFeesClaimed(token, creator, amount);
    }

    function _pay(address to, uint256 amount) internal {
        if (amount == 0) return;
        (bool ok, ) = payable(to).call{ value: amount }('');
        require(ok, 'eth transfer failed');
    }
}
