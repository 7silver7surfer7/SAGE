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
 * running pump.fun's OFFICIAL 25-tier PumpSwap fee schedule on top of
 * Uniswap's own 0.30% LP fee: the creator fee decays 0.95% → 0.05% as market
 * cap grows ($85k → $20M+), the protocol keeps a flat 0.05% above the first
 * tier, and creator fees are claimable any time.
 *
 * The pool itself stays permissionless — anyone can bypass the router and
 * trade the pair directly with zero protocol fee. The router is the default
 * in-app path, exactly like pump.fun's own AMM frontend.
 *
 * Events mirror the curve factory's Bought/Sold so charts, trade feeds and
 * holder tracking keep working across the graduation boundary unchanged.
 */
contract SageSwapRouter is ReentrancyGuard {
    // ── DYNAMIC FEES — pump.fun's OFFICIAL PumpSwap schedule (docs/fees),
    // ported 1:1. 25 tiers by market cap; the creator fee decays 0.95% →
    // 0.05% as mcap grows, the protocol fee is 0.05% everywhere above the
    // first tier. Fees are in CENTIBPS (1/100_000) because the official
    // table has quarter-bp steps (0.275%, 0.225%, …).
    //
    // The one deliberate difference: pump.fun's 0.20% LP fee goes to its own
    // AMM's LPs; our pools are vanilla Uniswap v2 with the 0.30% pool fee
    // baked into swap math (and the LP is BURNED, so that value accrues to
    // the locked liquidity itself). Creator + protocol match the table
    // exactly.
    //
    // Thresholds are the table's USD anchors converted at deploy-time ETH
    // (~$3,500): $85k→24Ξ, $300k→86Ξ, … $20M→5714Ξ. Treasury retunes with
    // setFeeTiers as the ETH price moves — no redeploy.
    struct FeeTier {
        uint128 mcapWeiFloor; // tier applies at/above this pool mcap (tier 0: below tier 1's floor)
        uint32 creatorFeeCentibps; // 1e5 denominator: 950 = 0.95%
        uint32 protocolFeeCentibps;
    }
    FeeTier[] public feeTiers;
    event FeeTiersUpdated(uint256 tierCount);

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
        // pump.fun's official PumpSwap table, USD anchors at ~$3,500/ETH.
        // (creator%, protocol%): row 1 is 0–$85k, then decaying creator fee.
        _pushTier(0, 300, 930); //       <$85k: 0.300% / 0.93%
        _pushTier(24 ether, 950, 50); //  ≥$85k: 0.950% / 0.05%
        _pushTier(86 ether, 900, 50); //  ≥$300k: 0.900%
        _pushTier(143 ether, 850, 50); // ≥$500k: 0.850%
        _pushTier(200 ether, 800, 50); // ≥$700k: 0.800%
        _pushTier(257 ether, 750, 50); // ≥$900k: 0.750%
        _pushTier(571 ether, 700, 50); // ≥$2M: 0.700%
        _pushTier(857 ether, 650, 50); // ≥$3M: 0.650%
        _pushTier(1143 ether, 600, 50); // ≥$4M: 0.600%
        _pushTier(1429 ether, 550, 50); // ≥$5M: 0.550%
        _pushTier(1714 ether, 500, 50); // ≥$6M: 0.500%
        _pushTier(2000 ether, 450, 50); // ≥$7M: 0.450%
        _pushTier(2286 ether, 400, 50); // ≥$8M: 0.400%
        _pushTier(2571 ether, 350, 50); // ≥$9M: 0.350%
        _pushTier(2857 ether, 300, 50); // ≥$10M: 0.300%
        _pushTier(3143 ether, 275, 50); // ≥$11M: 0.275%
        _pushTier(3429 ether, 250, 50); // ≥$12M: 0.250%
        _pushTier(3714 ether, 225, 50); // ≥$13M: 0.225%
        _pushTier(4000 ether, 200, 50); // ≥$14M: 0.200%
        _pushTier(4286 ether, 175, 50); // ≥$15M: 0.175%
        _pushTier(4571 ether, 150, 50); // ≥$16M: 0.150%
        _pushTier(4857 ether, 125, 50); // ≥$17M: 0.125%
        _pushTier(5143 ether, 100, 50); // ≥$18M: 0.100%
        _pushTier(5429 ether, 75, 50); //  ≥$19M: 0.075%
        _pushTier(5714 ether, 50, 50); //  ≥$20M: 0.050%
    }

    function _pushTier(uint256 floor, uint32 creatorCentibps, uint32 protocolCentibps) internal {
        feeTiers.push(FeeTier(uint128(floor), creatorCentibps, protocolCentibps));
    }

    function feeTiersLength() external view returns (uint256) {
        return feeTiers.length;
    }

    /** Treasury retunes the whole table as the ETH price moves — no redeploy. */
    function setFeeTiers(FeeTier[] calldata tiers) external {
        require(msg.sender == treasury, 'only treasury');
        require(tiers.length >= 2, 'need tiers');
        for (uint256 i = 1; i < tiers.length; i++) {
            require(tiers[i].mcapWeiFloor > tiers[i - 1].mcapWeiFloor, 'tier order');
        }
        delete feeTiers;
        for (uint256 i = 0; i < tiers.length; i++) feeTiers.push(tiers[i]);
        emit FeeTiersUpdated(tiers.length);
    }

    /** Pool mcap in wei: pool spot price × 1B supply. */
    function poolMcapWei(address token) public view returns (uint256) {
        (uint256 tokenReserve, uint256 wethReserve) = _reserves(_pairFor(token), token);
        if (tokenReserve == 0) return 0;
        return (wethReserve * 1_000_000_000 * 1 ether) / tokenReserve;
    }

    /**
     * (totalCentibps, creatorCentibps) at the token's current pool mcap —
     * pump.fun's calculate_fee_tier semantics: below tier 1's floor the first
     * tier applies; otherwise the highest tier whose floor is ≤ mcap.
     */
    function feeCentibpsFor(address token)
        public
        view
        returns (uint32 totalCentibps, uint32 creatorCentibps)
    {
        (uint256 tokenReserve, uint256 wethReserve) = _reserves(_pairFor(token), token);
        uint256 mcap = tokenReserve == 0 ? 0 : (wethReserve * 1_000_000_000 * 1 ether) / tokenReserve;
        FeeTier storage t = feeTiers[0];
        for (uint256 i = feeTiers.length; i > 1; i--) {
            if (mcap >= feeTiers[i - 1].mcapWeiFloor) {
                t = feeTiers[i - 1];
                break;
            }
        }
        return (t.creatorFeeCentibps + t.protocolFeeCentibps, t.creatorFeeCentibps);
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
        (uint32 totalCbps, ) = feeCentibpsFor(token);
        uint256 fee = (ethIn * totalCbps) / 100_000;
        (uint256 tokenReserve, uint256 wethReserve) = _reserves(_pairFor(token), token);
        return _getAmountOut(ethIn - fee, wethReserve, tokenReserve);
    }

    function buy(address token, uint256 minTokensOut) external payable nonReentrant {
        require(msg.value > 0, 'no eth');
        address pair = _pairFor(token);
        (uint32 totalCbps, uint32 creatorCbps) = feeCentibpsFor(token);
        uint256 fee = (msg.value * totalCbps) / 100_000;
        uint256 creatorFee = (msg.value * creatorCbps) / 100_000;
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

        (uint32 totalCbps, uint32 creatorCbps) = feeCentibpsFor(token);
        uint256 fee = (wethOut * totalCbps) / 100_000;
        uint256 creatorFee = (wethOut * creatorCbps) / 100_000;
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
