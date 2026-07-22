const { expect } = require('chai');
const { ethers } = require('hardhat');

describe('SocialFaucet', () => {
  let faucet, sage, owner, voucherSigner, otherSigner, alice, bob;
  const DRIP = ethers.utils.parseEther('10000');

  const domain = () => ({
    name: 'SAGESocialFaucet',
    version: '1',
    chainId: 31337,
    verifyingContract: faucet.address,
  });
  const types = { FaucetVoucher: [{ name: 'claimant', type: 'address' }] };
  const voucherFor = (signer, claimant) => signer._signTypedData(domain(), types, { claimant });

  beforeEach(async () => {
    [owner, otherSigner, alice, bob] = await ethers.getSigners();
    voucherSigner = ethers.Wallet.createRandom();
    const Mock = await ethers.getContractFactory('MockERC20');
    sage = await Mock.deploy(); // mints 10_000 MOCK to owner
    const Faucet = await ethers.getContractFactory('SocialFaucet');
    faucet = await Faucet.deploy(sage.address, DRIP, voucherSigner.address);
    await sage.mint(faucet.address, ethers.utils.parseEther('1000000'));
  });

  it('pays out the drip amount on a valid voucher', async () => {
    const sig = await voucherFor(voucherSigner, alice.address);
    await faucet.connect(alice).claim(sig);
    expect(await sage.balanceOf(alice.address)).to.equal(DRIP);
    expect(await faucet.claimed(alice.address)).to.equal(true);
  });

  it('rejects a second claim from the same wallet, even with a fresh voucher', async () => {
    const sig = await voucherFor(voucherSigner, alice.address);
    await faucet.connect(alice).claim(sig);
    const sig2 = await voucherFor(voucherSigner, alice.address);
    await expect(faucet.connect(alice).claim(sig2)).to.be.revertedWith('already claimed');
  });

  it('rejects a voucher signed by anyone other than voucherSigner', async () => {
    const sig = await voucherFor(otherSigner, alice.address);
    await expect(faucet.connect(alice).claim(sig)).to.be.revertedWith('invalid voucher');
  });

  it('rejects a voucher issued for a different claimant', async () => {
    const sig = await voucherFor(voucherSigner, bob.address);
    await expect(faucet.connect(alice).claim(sig)).to.be.revertedWith('invalid voucher');
  });

  it('each wallet gets its own independent one-time claim', async () => {
    await faucet.connect(alice).claim(await voucherFor(voucherSigner, alice.address));
    await faucet.connect(bob).claim(await voucherFor(voucherSigner, bob.address));
    expect(await sage.balanceOf(alice.address)).to.equal(DRIP);
    expect(await sage.balanceOf(bob.address)).to.equal(DRIP);
  });

  it('owner can pause the faucet, blocking new claims', async () => {
    await faucet.setActive(false);
    const sig = await voucherFor(voucherSigner, alice.address);
    await expect(faucet.connect(alice).claim(sig)).to.be.revertedWith('faucet is paused');
    await faucet.setActive(true);
    await faucet.connect(alice).claim(sig);
    expect(await sage.balanceOf(alice.address)).to.equal(DRIP);
  });

  it('non-owner cannot pause, tune the drip, rotate the signer, or drain', async () => {
    await expect(faucet.connect(alice).setActive(false)).to.be.revertedWith('Ownable: caller is not the owner');
    await expect(faucet.connect(alice).setDripAmount(1)).to.be.revertedWith('Ownable: caller is not the owner');
    await expect(faucet.connect(alice).setVoucherSigner(alice.address)).to.be.revertedWith(
      'Ownable: caller is not the owner'
    );
    await expect(faucet.connect(alice).drain(alice.address, 0)).to.be.revertedWith('Ownable: caller is not the owner');
  });

  it('owner can retune the drip amount', async () => {
    await faucet.setDripAmount(ethers.utils.parseEther('5'));
    const sig = await voucherFor(voucherSigner, alice.address);
    await faucet.connect(alice).claim(sig);
    expect(await sage.balanceOf(alice.address)).to.equal(ethers.utils.parseEther('5'));
  });

  it('owner can rotate the voucher signer; old signer stops working, new one does', async () => {
    const newSigner = ethers.Wallet.createRandom();
    await faucet.setVoucherSigner(newSigner.address);
    const staleSig = await voucherFor(voucherSigner, alice.address);
    await expect(faucet.connect(alice).claim(staleSig)).to.be.revertedWith('invalid voucher');
    const freshSig = await voucherFor(newSigner, alice.address);
    await faucet.connect(alice).claim(freshSig);
    expect(await sage.balanceOf(alice.address)).to.equal(DRIP);
  });

  it('claim reverts once the tank runs dry', async () => {
    await faucet.setDripAmount(ethers.utils.parseEther('10000000'));
    const sig = await voucherFor(voucherSigner, alice.address);
    await expect(faucet.connect(alice).claim(sig)).to.be.revertedWith('faucet is empty');
  });

  it('owner can drain a partial amount to any address', async () => {
    await faucet.drain(bob.address, ethers.utils.parseEther('100'));
    expect(await sage.balanceOf(bob.address)).to.equal(ethers.utils.parseEther('100'));
    expect(await sage.balanceOf(faucet.address)).to.equal(ethers.utils.parseEther('999900'));
  });

  it('owner can drain the entire balance with amount=0', async () => {
    await faucet.drain(owner.address, 0);
    expect(await sage.balanceOf(faucet.address)).to.equal(0);
  });

  it('drain reverts if amount exceeds the balance', async () => {
    await expect(
      faucet.drain(owner.address, ethers.utils.parseEther('5000000'))
    ).to.be.revertedWith('amount exceeds balance');
  });

  it('anyone can top the faucet back up via fund()', async () => {
    await sage.approve(faucet.address, ethers.utils.parseEther('50'));
    await faucet.fund(ethers.utils.parseEther('50'));
    expect(await sage.balanceOf(faucet.address)).to.equal(ethers.utils.parseEther('1000050'));
  });
});
