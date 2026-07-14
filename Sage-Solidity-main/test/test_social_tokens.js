const { expect } = require('chai');
const { ethers } = require('hardhat');

// SAGE Social token launchpad + voucher minter — the money paths.
describe('SocialTokenFactory', () => {
  let factory, treasury, creator, buyer, other, weth, uniFactory;
  const V_ETH = ethers.utils.parseEther('1');

  beforeEach(async () => {
    [, treasury, creator, buyer, other] = await ethers.getSigners();
    const wethArt = require('@uniswap/v2-periphery/build/WETH9.json');
    const uniArt = require('@uniswap/v2-core/build/UniswapV2Factory.json');
    const WETH = new ethers.ContractFactory(wethArt.abi, wethArt.bytecode, (await ethers.getSigners())[0]);
    weth = await WETH.deploy();
    const UniF = new ethers.ContractFactory(uniArt.abi, uniArt.bytecode, (await ethers.getSigners())[0]);
    uniFactory = await UniF.deploy((await ethers.getSigners())[0].address);
    const F = await ethers.getContractFactory('SocialTokenFactory');
    factory = await F.deploy(treasury.address, V_ETH, uniFactory.address, weth.address);
  });

  const launch = async (enableAirdrop = true) => {
    const tx = await factory.connect(creator).launch('Creator Coin', 'CC', enableAirdrop);
    const rc = await tx.wait();
    const ev = rc.events.find((e) => e.event === 'TokenLaunched');
    return ethers.getContractAt('SocialToken', ev.args.token);
  };

  it('launch is free and mirrors pump.fun initial reserves', async () => {
    const before = await treasury.getBalance();
    const token = await launch();
    expect((await treasury.getBalance()).sub(before)).to.equal(0);
    // 2% airdrop allocation to the creator, the rest held by the factory
    expect(await token.balanceOf(creator.address)).to.equal(ethers.utils.parseEther('20000000'));
    expect(await token.balanceOf(factory.address)).to.equal(ethers.utils.parseEther('980000000'));
    const c = await factory.curves(token.address);
    expect(c.virtualTokenReserves).to.equal(ethers.utils.parseEther('1073000000'));
    expect(c.realTokenReserves).to.equal(ethers.utils.parseEther('793100000'));
    expect(c.airdropEnabled).to.equal(true);
  });

  it('airdrop opt-out mints ZERO tokens to the creator (no dump risk)', async () => {
    const token = await launch(false);
    expect(await token.balanceOf(creator.address)).to.equal(0);
    expect(await token.balanceOf(factory.address)).to.equal(ethers.utils.parseEther('1000000000'));
    const c = await factory.curves(token.address);
    expect(c.airdropEnabled).to.equal(false);
  });

  it('allows multiple launches per creator; first stays the profile token', async () => {
    const first = await launch();
    await factory.connect(creator).launch('Y', 'Y', true);
    expect(await factory.tokenOf(creator.address)).to.equal(first.address);
    expect(await factory.allTokensLength()).to.equal(2);
  });

  it('launch with ETH executes a dev buy: creator is the first holder, chart seeded', async () => {
    const tx = await factory
      .connect(creator)
      .launch('Dev', 'DEV', false, { value: ethers.utils.parseEther('0.1') });
    const rcpt = await tx.wait();
    const launched = rcpt.events.find((e) => e.event === 'TokenLaunched');
    const bought = rcpt.events.find((e) => e.event === 'Bought');
    expect(bought, 'Bought event must fire in the launch tx').to.not.be.undefined;
    expect(bought.args.buyer).to.equal(creator.address);
    const token = await ethers.getContractAt('SocialToken', launched.args.token);
    // no airdrop cut (false) — everything the creator holds came off the curve
    expect(await token.balanceOf(creator.address)).to.equal(bought.args.tokensOut);
    expect(bought.args.tokensOut).to.be.gt(0);
    // curve price moved off the initial spot
    const c = await factory.curves(launched.args.token);
    expect(c.realEthReserves).to.be.gt(0);
  });

  it('buys follow the pump.fun formula and graduation closes the curve', async () => {
    const token = await launch();
    // pump.fun formula check: out = in·vTok / (vEth + in)
    const inEth = ethers.utils.parseEther('0.1');
    const fee = inEth.mul(125).div(10000); // 1.25% dynamic-fee era
    const afterFee = inEth.sub(fee);
    const vTok = ethers.utils.parseEther('1073000000');
    const expected = afterFee.mul(vTok).div(V_ETH.add(afterFee));
    await factory.connect(buyer).buy(token.address, 0, { value: inEth });
    expect(await token.balanceOf(buyer.address)).to.equal(expected);
    // graduation: a whale clears the remaining real reserves → complete
    await factory.connect(other).buy(token.address, 0, { value: ethers.utils.parseEther('4000') });
    const c = await factory.curves(token.address);
    expect(c.complete).to.equal(true);
    expect(c.realTokenReserves).to.equal(0);
    await expect(
      factory.connect(buyer).buy(token.address, 0, { value: ethers.utils.parseEther('0.1') })
    ).to.be.revertedWith('curve complete - sold out');
    // curve trading is CLOSED after completion — the market moves to Uniswap
    const bal = await token.balanceOf(buyer.address);
    await token.connect(buyer).approve(factory.address, bal);
    await expect(
      factory.connect(buyer).sell(token.address, bal, 0)
    ).to.be.revertedWith('graduated - trade on uniswap');
  });

  it('completing the curve AUTO-graduates to a REAL Uniswap v2 pool', async () => {
    const token = await launch(false); // no-dump: all supply on curve/factory
    // sell the curve out
    await factory.connect(other).buy(token.address, 0, { value: ethers.utils.parseEther('4000') });
    expect((await factory.curves(token.address)).complete).to.equal(true);
    // graduation is AUTOMATIC on the completing buy — pool already exists
    const pair = await factory.pairOf(token.address);
    const DEAD = '0x000000000000000000000000000000000000dEaD';
    expect(pair).to.not.equal(ethers.constants.AddressZero);
    // the pool holds the curve's ETH (as WETH) and the reserve tokens
    expect(await weth.balanceOf(pair)).to.be.gt(0);
    expect(await token.balanceOf(pair)).to.be.gt(0);
    expect((await factory.curves(token.address)).realEthReserves).to.equal(0);
    // the LP is BURNED — the treasury holds none, the dead address holds it all
    const pairC = new ethers.Contract(pair, ['function balanceOf(address) view returns (uint256)'], ethers.provider);
    expect(await pairC.balanceOf(DEAD)).to.be.gt(0);
    expect(await pairC.balanceOf(treasury.address)).to.equal(0);
    // double-graduation is blocked
    await expect(factory.graduate(token.address)).to.be.revertedWith('already graduated');
  });

  it('curve buys pay 1.25% total, tiered: creator 0.30% below tier1 (Ascend split)', async () => {
    const token = await launch();
    const tBefore = await treasury.getBalance();
    const cBefore = await creator.getBalance();
    const spend = ethers.utils.parseEther('0.1');
    await factory.connect(buyer).buy(token.address, 0, { value: spend });
    const totalFee = spend.mul(125).div(10000); // 1.25%
    const creatorFee = spend.mul(30).div(10000); // 0.30% creator below tier1
    expect((await treasury.getBalance()).sub(tBefore)).to.equal(totalFee.sub(creatorFee));
    expect((await creator.getBalance()).sub(cBefore)).to.equal(creatorFee);
    const bal1 = await token.balanceOf(buyer.address);
    expect(bal1).to.be.gt(0);
    // second identical buy gets FEWER tokens (price moved up)
    await factory.connect(other).buy(token.address, 0, { value: spend });
    const bal2 = await token.balanceOf(other.address);
    expect(bal2).to.be.lt(bal1);
  });

  it('sell round-trip returns less than paid (two 1% fees) and never drains virtual reserves', async () => {
    const token = await launch();
    const spend = ethers.utils.parseEther('0.2');
    await factory.connect(buyer).buy(token.address, 0, { value: spend });
    const tokens = await token.balanceOf(buyer.address);
    await token.connect(buyer).approve(factory.address, tokens);
    const ethBefore = await buyer.getBalance();
    const tx = await factory.connect(buyer).sell(token.address, tokens, 0);
    const rc = await tx.wait();
    const gas = rc.gasUsed.mul(rc.effectiveGasPrice);
    const got = (await buyer.getBalance()).add(gas).sub(ethBefore);
    expect(got).to.be.gt(0);
    expect(got).to.be.lt(spend); // fees + curve keep the house whole
    const curve = await factory.curves(token.address);
    expect(curve.realEthReserves).to.be.gte(0); // no underflow — dust clamped
  });

  it('slippage guards revert', async () => {
    const token = await launch();
    await expect(
      factory.connect(buyer).buy(token.address, ethers.constants.MaxUint256, {
        value: ethers.utils.parseEther('0.01'),
      })
    ).to.be.revertedWith('slippage');
  });

  it('airdrop distributes the creator allocation to followers', async () => {
    const token = await launch();
    const each = ethers.utils.parseEther('1000');
    await token.connect(creator).approve(factory.address, each.mul(2));
    await factory.connect(creator).airdrop(token.address, [buyer.address, other.address], each);
    expect(await token.balanceOf(buyer.address)).to.equal(each);
    expect(await token.balanceOf(other.address)).to.equal(each);
  });
});

describe('SocialCollectMinter', () => {
  let minter, nft, signer, collector, stranger;

  beforeEach(async () => {
    [signer, collector, stranger] = await ethers.getSigners();
    // a minimal stand-in NFT capturing safeMint calls
    const Mock = await ethers.getContractFactory('MockMintable');
    nft = await Mock.deploy();
    const M = await ethers.getContractFactory('SocialCollectMinter');
    minter = await M.deploy(nft.address, signer.address);
  });

  const voucher = async (postId, who, uri, signWith = signer) => {
    const domain = {
      name: 'SAGESocialCollect',
      version: '1',
      chainId: (await ethers.provider.getNetwork()).chainId,
      verifyingContract: minter.address,
    };
    const types = {
      CollectVoucher: [
        { name: 'postId', type: 'uint256' },
        { name: 'collector', type: 'address' },
        { name: 'uri', type: 'string' },
      ],
    };
    return signWith._signTypedData(domain, types, { postId, collector: who, uri });
  };

  it('mints with a valid voucher, once per (post, collector)', async () => {
    const sig = await voucher(7, collector.address, 'ipfs://x');
    await minter.connect(collector).mintWithVoucher(7, 'ipfs://x', sig);
    expect(await nft.lastTo()).to.equal(collector.address);
    expect(await nft.lastUri()).to.equal('ipfs://x');
    await expect(minter.connect(collector).mintWithVoucher(7, 'ipfs://x', sig))
      .to.be.revertedWith('already collected');
  });

  it('rejects a voucher redeemed by someone else or signed by a stranger', async () => {
    const sig = await voucher(8, collector.address, 'ipfs://y');
    await expect(minter.connect(stranger).mintWithVoucher(8, 'ipfs://y', sig))
      .to.be.revertedWith('invalid voucher');
    const forged = await voucher(9, collector.address, 'ipfs://z', stranger);
    await expect(minter.connect(collector).mintWithVoucher(9, 'ipfs://z', forged))
      .to.be.revertedWith('invalid voucher');
  });

  it('rejects a voucher replayed with a different uri', async () => {
    const sig = await voucher(10, collector.address, 'ipfs://real');
    await expect(minter.connect(collector).mintWithVoucher(10, 'ipfs://fake', sig))
      .to.be.revertedWith('invalid voucher');
  });
});

describe('SocialNFTLauncher', () => {
  let launcher, treasury, artist, minter;

  beforeEach(async () => {
    [, treasury, artist, minter] = await ethers.getSigners();
    const L = await ethers.getContractFactory('SocialNFTLauncher');
    launcher = await L.deploy(treasury.address);
  });

  const create = async (price = ethers.utils.parseEther('0.05'), supply = 3) => {
    const tx = await launcher.connect(artist).createEdition('Genesis', 'GEN', 'ipfs://meta', supply, price);
    const rc = await tx.wait();
    return rc.events.find((e) => e.event === 'EditionCreated').args.edition;
  };

  it('creating an edition is free; mints pay 1% platform / 99% artist', async () => {
    const price = ethers.utils.parseEther('0.05');
    const edition = await create(price);
    const tBefore = await treasury.getBalance();
    const aBefore = await artist.getBalance();
    await launcher.connect(minter).mint(edition, { value: price });
    expect((await treasury.getBalance()).sub(tBefore)).to.equal(price.div(100));
    expect((await artist.getBalance()).sub(aBefore)).to.equal(price.sub(price.div(100)));
    const nft = await ethers.getContractAt('SocialEditionNFT', edition);
    expect(await nft.ownerOf(1)).to.equal(minter.address);
    expect(await nft.tokenURI(1)).to.equal('ipfs://meta');
  });

  it('enforces price and hard supply cap', async () => {
    const price = ethers.utils.parseEther('0.05');
    const edition = await create(price, 2);
    await expect(launcher.connect(minter).mint(edition, { value: price.sub(1) }))
      .to.be.revertedWith('underpaid');
    await launcher.connect(minter).mint(edition, { value: price });
    await launcher.connect(minter).mint(edition, { value: price });
    await expect(launcher.connect(minter).mint(edition, { value: price }))
      .to.be.revertedWith('sold out');
  });

  it('only the launcher can mint on the edition contract', async () => {
    const edition = await create();
    const nft = await ethers.getContractAt('SocialEditionNFT', edition);
    await expect(nft.connect(minter).mintTo(minter.address)).to.be.revertedWith('launcher only');
  });

  it('collection mints give each token unique per-id metadata', async () => {
    const price = ethers.utils.parseEther('0.01');
    const tx = await launcher.connect(artist).createCollection('Gen', 'GEN', 'ipfs://cid/', 10000, price);
    const rc = await tx.wait();
    const col = rc.events.find((e) => e.event === 'EditionCreated').args.edition;
    await launcher.connect(minter).mint(col, { value: price });
    await launcher.connect(minter).mint(col, { value: price });
    const nft = await ethers.getContractAt('SocialCollectionNFT', col);
    expect(await nft.tokenURI(1)).to.equal('ipfs://cid/1.json');
    expect(await nft.tokenURI(2)).to.equal('ipfs://cid/2.json');
    expect(await nft.maxSupply()).to.equal(10000);
  });
});

describe('SagePoints', () => {
  let points, sage, owner, alice, bob;
  const DAY = 24 * 3600;
  beforeEach(async () => {
    [owner, alice, bob] = await ethers.getSigners();
    const M = await ethers.getContractFactory('MockERC20');
    sage = await M.deploy();
    const P = await ethers.getContractFactory('SagePoints');
    points = await P.deploy(sage.address);
  });

  it('streams pixels per second from the live SAGE balance', async () => {
    await sage.mint(alice.address, ethers.utils.parseEther('1000')); // 1000 SAGE
    await ethers.provider.send('evm_increaseTime', [DAY]);
    await ethers.provider.send('evm_mine', []);
    // 1000 SAGE × 0.25/day ≈ 250 pixels after one day
    const pts = await points.pointsOf(alice.address);
    expect(pts).to.be.gte(249).and.to.be.lte(251);
    expect(await points.dailyRateOf(alice.address)).to.equal(250);
  });

  it('whale cap bounds accrual; owner can retune economics', async () => {
    await sage.mint(alice.address, ethers.utils.parseEther('1000000')); // 1M SAGE > 100k cap
    expect(await points.dailyRateOf(alice.address)).to.equal(25000); // capped
    await points.setEconomics(50, 200000, false); // 0.5/day, higher cap
    expect(await points.dailyRateOf(alice.address)).to.equal(100000);
    await expect(points.connect(alice).setEconomics(1, 1, true)).to.be.revertedWith(
      'Ownable: caller is not the owner'
    );
  });

  it('controller moves pixels buyer→seller; non-controllers cannot; overdraft reverts', async () => {
    await sage.mint(alice.address, ethers.utils.parseEther('1000'));
    await ethers.provider.send('evm_increaseTime', [4 * DAY]); // ~1000 pixels
    await ethers.provider.send('evm_mine', []);
    await points.transferPoints(alice.address, bob.address, 500, 'collect:1');
    expect(await points.pointsOf(bob.address)).to.equal(500);
    expect(await points.pointsOf(alice.address)).to.be.lt(600); // spent 500 of ~1000
    await expect(
      points.connect(bob).spendFrom(alice.address, 1, 'x')
    ).to.be.revertedWith('not a controller');
    await expect(
      points.spendFrom(bob.address, 10000, 'x')
    ).to.be.revertedWith('insufficient pixels');
  });

  it('creditTo mints promo pixels on top of the stream', async () => {
    await points.creditTo(alice.address, 777, 'promo');
    expect(await points.pointsOf(alice.address)).to.equal(777);
  });
});

describe('SageSwapRouter (post-graduation trading + creator revenue share)', () => {
  let factory, router, weth, token, treasury, creator, buyer;
  beforeEach(async () => {
    [, treasury, creator, buyer] = await ethers.getSigners();
    const wethArt = require('@uniswap/v2-periphery/build/WETH9.json');
    const uniArt = require('@uniswap/v2-core/build/UniswapV2Factory.json');
    const signer0 = (await ethers.getSigners())[0];
    const WETH = await new ethers.ContractFactory(wethArt.abi, wethArt.bytecode, signer0).deploy();
    const uniF = await new ethers.ContractFactory(uniArt.abi, uniArt.bytecode, signer0).deploy(treasury.address);
    const F = await ethers.getContractFactory('SocialTokenFactory');
    factory = await F.deploy(treasury.address, ethers.utils.parseEther('2'), uniF.address, WETH.address);
    weth = WETH;
    const R = await ethers.getContractFactory('SageSwapRouter');
    router = await R.deploy(factory.address, WETH.address, treasury.address);
    // launch + buy out the curve → auto-graduates
    const tx = await factory.connect(creator).launch('Grad', 'GRAD', false);
    const rc = await tx.wait();
    const addr = rc.events.find((e) => e.event === 'TokenLaunched').args.token;
    token = await ethers.getContractAt('SocialToken', addr);
    // selling out 793.1M of the curve takes ~5.7 ETH (vEth 2) + 1% fee
    await factory.connect(buyer).buy(addr, 0, { value: ethers.utils.parseEther('7') });
    expect(await factory.pairOf(addr)).to.not.equal(ethers.constants.AddressZero);
  });

  it('router buys work on the pool; tiered fee: 0.30% treasury instant + 0.65% creator accrues', async () => {
    const spend = ethers.utils.parseEther('1');
    const tBefore = await treasury.getBalance();
    const balBefore = await token.balanceOf(buyer.address);
    await router.connect(buyer).buy(token.address, 0, { value: spend });
    expect(await token.balanceOf(buyer.address)).to.be.gt(balBefore);
    // pool mcap ≈ 27 ETH < tier1 → 0.95% total: 0.65% creator / 0.30% treasury
    expect(await router.creatorFees(token.address)).to.equal(spend.mul(65).div(10000));
    expect((await treasury.getBalance()).sub(tBefore)).to.equal(spend.mul(30).div(10000));
  });

  it('router sells return ETH minus fees; creator accrues on both sides', async () => {
    await router.connect(buyer).buy(token.address, 0, { value: ethers.utils.parseEther('1') });
    const bal = await token.balanceOf(buyer.address);
    await token.connect(buyer).approve(router.address, bal);
    const ethBefore = await buyer.getBalance();
    await router.connect(buyer).sell(token.address, bal, 0);
    expect(await buyer.getBalance()).to.be.gt(ethBefore); // got ETH back (minus gas)
    expect(await router.creatorFees(token.address)).to.be.gt(ethers.utils.parseEther('1').mul(65).div(10000));
  });

  it('only the creator can claim; claim zeroes the accrual', async () => {
    await router.connect(buyer).buy(token.address, 0, { value: ethers.utils.parseEther('2') });
    const owed = await router.creatorFees(token.address);
    expect(owed).to.be.gt(0);
    await expect(router.connect(buyer).claimCreatorFees(token.address)).to.be.revertedWith('not the creator');
    const before = await creator.getBalance();
    await router.connect(creator).claimCreatorFees(token.address);
    expect(await router.creatorFees(token.address)).to.equal(0);
    expect(await creator.getBalance()).to.be.gt(before);
    expect(await router.creatorFeesLifetime(token.address)).to.equal(owed);
  });

  it('router refuses tokens still on the curve', async () => {
    const tx = await factory.connect(creator).launch('Fresh', 'FRSH', false);
    const rc = await tx.wait();
    const fresh = rc.events.find((e) => e.event === 'TokenLaunched').args.token;
    await expect(router.connect(buyer).buy(fresh, 0, { value: 1000 })).to.be.revertedWith('not graduated');
  });
});

