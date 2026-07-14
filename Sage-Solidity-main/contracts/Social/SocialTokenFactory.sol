// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

import '@openzeppelin/contracts/token/ERC20/ERC20.sol';
import '@openzeppelin/contracts/security/ReentrancyGuard.sol';

/**
 * A creator coin launched from SAGE Social. Fixed 1B supply minted at
 * construction: an OPTIONAL creator allocation (for follower airdrops) plus
 * the curve reserve held by the factory.
 */
contract SocialToken is ERC20 {
    constructor(
        string memory name_,
        string memory symbol_,
        address curve,
        address creator,
        uint256 creatorCut,
        uint256 totalSupply_
    ) ERC20(name_, symbol_) {
        if (creatorCut > 0) _mint(creator, creatorCut);
        _mint(curve, totalSupply_ - creatorCut);
    }
}

/**
 * SocialTokenFactory v3 — a faithful port of pump.fun's bonding curve
 * (pump.fun/docs/bonding-curve) to ETH on Robinhood Chain.
 *
 * Curve mechanics (dual virtual/real reserve accounting, x·y=k):
 *   buy:  tokensOut = ethIn·vTok / (vEth + ethIn), capped by realTok
 *         vEth += ethIn; vTok -= out; realTok -= out; realEth += ethIn
 *   sell: ethOut = amt·vEth / (vTok + amt)
 *         vTok += amt; vEth -= ethOut; realEth -= ethOut
 *   graduation: realTok == 0 → curve complete. pump.fun migrates to an AMM;
 *   Robinhood Chain has no DEX yet, so completion CLOSES BUYS but keeps
 *   sells open as an exit hatch (documented divergence).
 *
 * Initial state mirrors pump.fun's shape: 1B total supply, 1.073B virtual
 * token reserves, 793.1M real (sellable) token reserves; the remaining
 * ~206.9M stays locked in the factory as the future migration reserve.
 * Virtual ETH is a constructor parameter (pump.fun uses 30 virtual SOL).
 *
 * Fees mirror pump.fun/docs/fees: creation FREE; 1% of ETH volume per trade,
 * 0.05% to the creator, the remainder to the platform treasury.
 *
 * Airdrop opt-out: launch(..., enableAirdrop). ON → 20M (2%) is minted to
 * the creator for follower airdrops. OFF → the creator holds ZERO tokens at
 * launch, so the token cannot be dumped on recipients or by the creator.
 */
interface IUniswapV2FactoryMin {
    function getPair(address, address) external view returns (address);
    function createPair(address, address) external returns (address);
}

interface IUniswapV2PairMin {
    function mint(address to) external returns (uint256);
}

interface IWETHMin {
    function deposit() external payable;
    function transfer(address, uint256) external returns (bool);
}

contract SocialTokenFactory is ReentrancyGuard {
    uint256 public constant TOKEN_TOTAL_SUPPLY = 1_000_000_000 ether;
    uint256 public constant INITIAL_VIRTUAL_TOKEN_RESERVES = 1_073_000_000 ether;
    uint256 public constant INITIAL_REAL_TOKEN_RESERVES = 793_100_000 ether;
    uint256 public constant AIRDROP_CUT = 20_000_000 ether; // 2%, only when enabled
    uint16 public constant FEE_BPS = 100; // 1% total trade fee
    uint16 public constant CREATOR_FEE_BPS = 5; // 0.05% of volume to the creator

    address public immutable treasury;
    uint256 public immutable initialVirtualEth;
    // graduation target: when a curve sells out, its ETH + the reserve tokens
    // seed a REAL Uniswap v2 pool — trading continues on the open market
    address public immutable uniswapFactory;
    address public immutable weth;
    mapping(address => address) public pairOf; // token → its Uniswap pool (post-graduation)

    struct Curve {
        uint256 virtualTokenReserves;
        uint256 virtualEthReserves;
        uint256 realTokenReserves;
        uint256 realEthReserves;
        address creator;
        bool complete;
        bool airdropEnabled;
    }

    mapping(address => Curve) public curves;
    // creator → their FIRST token (the one surfaced on their profile).
    // Creators may launch any number of tokens; later launches trade the same
    // but are not the profile token.
    mapping(address => address) public tokenOf;
    address[] public allTokens;

    event TokenLaunched(
        address indexed token,
        address indexed creator,
        string name,
        string symbol,
        bool airdropEnabled
    );
    event Bought(address indexed token, address indexed buyer, uint256 ethIn, uint256 tokensOut, uint256 fee, uint256 creatorFee);
    event Sold(address indexed token, address indexed seller, uint256 tokensIn, uint256 ethOut, uint256 fee, uint256 creatorFee);
    event CurveComplete(address indexed token);
    event TokenGraduated(address indexed token, address indexed pair, uint256 ethIn, uint256 tokensIn);
    event Airdropped(address indexed token, address indexed from, uint256 recipients, uint256 amountEach);

    constructor(address _treasury, uint256 _initialVirtualEth, address _uniswapFactory, address _weth) {
        require(_treasury != address(0) && _initialVirtualEth > 0, 'bad params');
        require(_uniswapFactory != address(0) && _weth != address(0), 'bad uniswap params');
        treasury = _treasury;
        initialVirtualEth = _initialVirtualEth;
        uniswapFactory = _uniswapFactory;
        weth = _weth;
    }

    function allTokensLength() external view returns (uint256) {
        return allTokens.length;
    }

    /**
     * pump.fun-style graduation: once the curve sells out, ANYONE can migrate
     * the market to Uniswap — the curve's collected ETH is wrapped and paired
     * with the factory's remaining reserve tokens; LP goes to the treasury.
     */
    function graduate(address token) external nonReentrant returns (address pair) {
        Curve storage c = curves[token];
        require(c.creator != address(0), 'unknown token');
        require(c.complete, 'curve not complete');
        return _graduate(token);
    }

    function _graduate(address token) internal returns (address pair) {
        Curve storage c = curves[token];
        require(pairOf[token] == address(0), 'already graduated');
        uint256 ethAmt = c.realEthReserves;
        uint256 tokenAmt = IERC20(token).balanceOf(address(this));
        require(ethAmt > 0 && tokenAmt > 0, 'nothing to migrate');
        c.realEthReserves = 0;
        pair = IUniswapV2FactoryMin(uniswapFactory).getPair(token, weth);
        if (pair == address(0)) {
            pair = IUniswapV2FactoryMin(uniswapFactory).createPair(token, weth);
        }
        pairOf[token] = pair;
        IWETHMin(weth).deposit{ value: ethAmt }();
        require(IWETHMin(weth).transfer(pair, ethAmt), 'weth transfer failed');
        require(IERC20(token).transfer(pair, tokenAmt), 'token transfer failed');
        // LP is BURNED (pump.fun's Raydium-era guarantee): nobody — including
        // the platform — can ever pull a graduated pool's liquidity. Platform
        // revenue comes from the Uniswap factory's feeTo switch instead
        // (1/6 of fee growth to the treasury).
        IUniswapV2PairMin(pair).mint(0x000000000000000000000000000000000000dEaD);
        emit TokenGraduated(token, pair, ethAmt, tokenAmt);
    }

    /**
     * Launch a creator coin — creation is FREE (pump.fun-style), gas only.
     * Send ETH with the call for an optional INITIAL DEV BUY (pump.fun's
     * create-and-buy): the value executes as the first purchase on the fresh
     * curve in the same tx, seeding the chart/liquidity and making the
     * creator the first holder.
     */
    function launch(string calldata name_, string calldata symbol_, bool enableAirdrop)
        external
        payable
        nonReentrant
        returns (address token)
    {
        require(bytes(name_).length > 0 && bytes(symbol_).length > 0, 'name/symbol required');
        uint256 creatorCut = enableAirdrop ? AIRDROP_CUT : 0;
        token = address(
            new SocialToken(name_, symbol_, address(this), msg.sender, creatorCut, TOKEN_TOTAL_SUPPLY)
        );
        curves[token] = Curve({
            virtualTokenReserves: INITIAL_VIRTUAL_TOKEN_RESERVES,
            virtualEthReserves: initialVirtualEth,
            realTokenReserves: INITIAL_REAL_TOKEN_RESERVES,
            realEthReserves: 0,
            creator: msg.sender,
            complete: false,
            airdropEnabled: enableAirdrop
        });
        if (tokenOf[msg.sender] == address(0)) tokenOf[msg.sender] = token; // first = profile token
        allTokens.push(token);
        emit TokenLaunched(token, msg.sender, name_, symbol_, enableAirdrop);
        if (msg.value > 0) _executeBuy(token, msg.sender, msg.value, 0);
    }

    /** pump.fun buy quote: tokensOut for a post-fee ETH input, capped by real reserves. */
    function quoteBuy(address token, uint256 ethInAfterFee) public view returns (uint256) {
        Curve storage c = curves[token];
        uint256 out = (ethInAfterFee * c.virtualTokenReserves) /
            (c.virtualEthReserves + ethInAfterFee);
        return out > c.realTokenReserves ? c.realTokenReserves : out;
    }

    /** Spot price: wei per whole token, straight off the virtual reserves. */
    function spotPriceWei(address token) external view returns (uint256) {
        Curve storage c = curves[token];
        if (c.virtualTokenReserves == 0) return 0;
        return (c.virtualEthReserves * 1 ether) / c.virtualTokenReserves;
    }

    function buy(address token, uint256 minTokensOut) external payable nonReentrant {
        _executeBuy(token, msg.sender, msg.value, minTokensOut);
    }

    /** Shared buy path — used by buy() and the launch-time dev buy. */
    function _executeBuy(address token, address buyer, uint256 value, uint256 minTokensOut) internal {
        Curve storage c = curves[token];
        require(c.creator != address(0), 'unknown token');
        require(!c.complete, 'curve complete - sold out');
        require(value > 0, 'no eth');
        uint256 fee = (value * FEE_BPS) / 10000;
        uint256 creatorFee = (value * CREATOR_FEE_BPS) / 10000;
        uint256 ethIn = value - fee;
        uint256 out = quoteBuy(token, ethIn);
        require(out >= minTokensOut, 'slippage');
        // pump.fun reserve bookkeeping
        c.virtualEthReserves += ethIn;
        c.virtualTokenReserves -= out;
        c.realTokenReserves -= out;
        c.realEthReserves += ethIn;
        _pay(treasury, fee - creatorFee);
        _pay(c.creator, creatorFee);
        require(IERC20(token).transfer(buyer, out), 'transfer failed');
        emit Bought(token, buyer, ethIn, out, fee, creatorFee);
        if (c.realTokenReserves == 0) {
            c.complete = true;
            emit CurveComplete(token);
            // AUTO-GRADUATION: the completing buy migrates the market to
            // Uniswap in the same tx — no button, exactly pump.fun
            _graduate(token);
        }
    }

    function sell(address token, uint256 amount, uint256 minEthOut) external nonReentrant {
        Curve storage c = curves[token];
        require(c.creator != address(0), 'unknown token');
        require(!c.complete, 'graduated - trade on uniswap');
        require(amount > 0, 'no tokens');
        uint256 ethOut = (amount * c.virtualEthReserves) / (c.virtualTokenReserves + amount);
        // flooring dust can nudge past real holdings on a full round-trip
        if (ethOut > c.realEthReserves) ethOut = c.realEthReserves;
        uint256 fee = (ethOut * FEE_BPS) / 10000;
        uint256 creatorFee = (ethOut * CREATOR_FEE_BPS) / 10000;
        require(ethOut - fee >= minEthOut, 'slippage');
        c.virtualTokenReserves += amount;
        c.virtualEthReserves -= ethOut;
        c.realEthReserves -= ethOut;
        require(IERC20(token).transferFrom(msg.sender, address(this), amount), 'pull failed');
        _pay(treasury, fee - creatorFee);
        _pay(c.creator, creatorFee);
        _pay(msg.sender, ethOut - fee);
        emit Sold(token, msg.sender, amount, ethOut - fee, fee, creatorFee);
    }

    /**
     * Batch airdrop from the caller's own balance (creators use their 2%
     * allocation to reward followers). Requires a prior approve() on the token.
     */
    function airdrop(address token, address[] calldata recipients, uint256 amountEach)
        external
        nonReentrant
    {
        require(recipients.length > 0 && recipients.length <= 200, '1-200 recipients');
        for (uint256 i = 0; i < recipients.length; i++) {
            require(IERC20(token).transferFrom(msg.sender, recipients[i], amountEach), 'pull failed');
        }
        emit Airdropped(token, msg.sender, recipients.length, amountEach);
    }

    function _pay(address to, uint256 amount) private {
        if (amount == 0) return;
        (bool ok, ) = payable(to).call{value: amount}('');
        require(ok, 'eth transfer failed');
    }
}
