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
 *         vTok += amt; vEth -= ethOut; realTok += amt; realEth -= ethOut
 *   graduation: realTok == 0 (curve's sellable reserve fully bought out, NET
 *   of sells) → curve complete, and the market auto-migrates to a Uniswap v2
 *   pair: the curve's collected ETH plus the factory's remaining ~206.9M
 *   migration reserve seed the pool, LP is held by the treasury. realTok MUST round-trip on
 *   sell (the `realTok += amt` above) or graduation fires early on gross buys
 *   and _graduate over-seeds the pool with sold-back tokens, opening the AMM
 *   price below the curve's final price.
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
    // sends (balance - reserves) of each token to `to` — used to sweep any
    // tokens donated to the pair before we seed it (front-run defense).
    function skim(address to) external;
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
    // ── CURVE FEES — pump.fun's official schedule (docs/fees) ──
    // Bonding-curve trades pay a FLAT 1.25% total: 0.30% to the creator,
    // 0.95% to the protocol, 0% LP (there is no pool yet). The market-cap
    // STAGGERING pump.fun documents applies only post-graduation, on the AMM
    // — see SageSwapRouter's 25-tier table.
    uint16 public constant FEE_BPS = 125; // 1.25% total trade fee
    uint16 public constant CREATOR_FEE_BPS = 30; // 0.30% creator, flat on the curve

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

    /** Current mcap in wei: spot price × 1B supply. */
    function mcapWei(address token) public view returns (uint256) {
        Curve storage c = curves[token];
        if (c.virtualTokenReserves == 0) return 0;
        return (c.virtualEthReserves * 1 ether * 1_000_000_000) / c.virtualTokenReserves;
    }

    /** The creator's bps share of FEE_BPS — flat on the curve (pump.fun). */
    function creatorFeeBps(address) public pure returns (uint16) {
        return CREATOR_FEE_BPS;
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
        // Front-run defense: the pair address is deterministic, so an attacker
        // can transfer token/WETH to it BEFORE graduation to skew the opening
        // price (Uniswap mint() prices off the pair's live balances, not the
        // amounts we send). skim() sweeps any bare pre-donation (balance above
        // reserves) to the treasury, so a freshly-created pair opens solely on
        // our migration ratio. Graduation is atomic — no in-tx window to
        // re-donate after this. Residual (accepted for v1): an attacker who
        // additionally sync()s the pair or mints LP locks their donation INTO
        // reserves, which skim can't sweep — but doing so forfeits that
        // donation to the treasury-held pool and only skews the opening price
        // rather than stealing, an expensive and unprofitable griefing move.
        IUniswapV2PairMin(pair).skim(treasury);
        IWETHMin(weth).deposit{ value: ethAmt }();
        require(IWETHMin(weth).transfer(pair, ethAmt), 'weth transfer failed');
        require(IERC20(token).transfer(pair, tokenAmt), 'token transfer failed');
        // LP is minted to the TREASURY (multisig), not burned. The earlier
        // burn-to-dEaD design ("pump.fun's Raydium-era guarantee") torched the
        // 0.30% LP fee stream permanently: its claimed revenue fallback — the
        // Uniswap factory feeTo switch — was never armed (feeTo == 0x0), and
        // for a burned pool feeTo only realizes on LP events that never come.
        // SAGE's own pool paid ~$1.2k of unclaimable fees on its first $400k
        // of volume before this was caught. Treasury custody keeps the fee
        // growth harvestable (and can be moved into a withdraw-only fee
        // locker later — burning was the only irreversible choice).
        IUniswapV2PairMin(pair).mint(treasury);
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
        uint256 creatorFee = (value * creatorFeeBps(token)) / 10000;
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
        uint256 creatorFee = (ethOut * creatorFeeBps(token)) / 10000;
        require(ethOut - fee >= minEthOut, 'slippage');
        c.virtualTokenReserves += amount;
        c.virtualEthReserves -= ethOut;
        // sold tokens return to the curve's sellable reserve — the mirror of
        // _executeBuy's `realTokenReserves -= out`. Omitting this made realTok
        // a monotonic gross-buys odometer: graduation (realTok == 0) fired on
        // cumulative buys regardless of sells, and _graduate then dumped the
        // factory's full (sell-inflated) balance into Uniswap, seeding it
        // token-heavy and opening the pool below the curve's final price.
        c.realTokenReserves += amount;
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
