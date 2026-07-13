const { expect } = require('chai');
const { ethers } = require('hardhat');

// SAGE Social token launchpad + voucher minter — the money paths.
describe('SocialTokenFactory', () => {
  let factory, treasury, creator, buyer, other;
  const V_ETH = ethers.utils.parseEther('1');

  beforeEach(async () => {
    [, treasury, creator, buyer, other] = await ethers.getSigners();
    const F = await ethers.getContractFactory('SocialTokenFactory');
    factory = await F.deploy(treasury.address, V_ETH);
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

  it('rejects duplicate creators', async () => {
    await launch();
    await expect(factory.connect(creator).launch('Y', 'Y', true))
      .to.be.revertedWith('one token per creator');
  });

  it('buys follow the pump.fun formula and graduation closes the curve', async () => {
    const token = await launch();
    // pump.fun formula check: out = in·vTok / (vEth + in)
    const inEth = ethers.utils.parseEther('0.1');
    const fee = inEth.div(100);
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
    // exit hatch: sells still work after completion
    const bal = await token.balanceOf(buyer.address);
    await token.connect(buyer).approve(factory.address, bal);
    await factory.connect(buyer).sell(token.address, bal, 0);
  });

  it('buys pay 1% total: 0.95% treasury + 0.05% creator (pump.fun split)', async () => {
    const token = await launch();
    const tBefore = await treasury.getBalance();
    const cBefore = await creator.getBalance();
    const spend = ethers.utils.parseEther('0.1');
    await factory.connect(buyer).buy(token.address, 0, { value: spend });
    const totalFee = spend.div(100); // 1%
    const creatorFee = spend.mul(5).div(10000); // 0.05%
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
  let points, owner, oracle, alice, bob;
  beforeEach(async () => {
    [owner, oracle, alice, bob] = await ethers.getSigners();
    const P = await ethers.getContractFactory('SagePoints');
    points = await P.deploy();
  });

  it('controller mints accrual; non-controllers cannot', async () => {
    await points.setController(oracle.address, true);
    await points.connect(oracle).mint(alice.address, 1000);
    expect(await points.balanceOf(alice.address)).to.equal(1000);
    await expect(points.connect(bob).mint(bob.address, 1000)).to.be.revertedWith('not a controller');
  });

  it('points are non-transferable by default, toggleable by owner', async () => {
    await points.mint(alice.address, 500);
    await expect(points.connect(alice).transfer(bob.address, 100)).to.be.revertedWith(
      'points are non-transferable'
    );
    await points.setEconomics(25, 1, 0, true);
    await points.connect(alice).transfer(bob.address, 100);
    expect(await points.balanceOf(bob.address)).to.equal(100);
  });

  it('owner can retune economics without redeploy', async () => {
    await points.setEconomics(50, 100, 2500, false);
    const e = await points.economics();
    expect(e.pointsPerSagePerDay).to.equal(50);
    expect(e.collectFloorPoints).to.equal(100);
    expect(e.verificationPoints).to.equal(2500);
    await expect(points.connect(alice).setEconomics(1, 1, 1, true)).to.be.revertedWith(
      'Ownable: caller is not the owner'
    );
  });

  it('controller burns spends', async () => {
    await points.mint(alice.address, 1000);
    await points.burnFrom(alice.address, 400);
    expect(await points.balanceOf(alice.address)).to.equal(600);
  });
});
