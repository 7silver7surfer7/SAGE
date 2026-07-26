import { expect } from 'chai';
import { ethers } from 'ethers';
import { publishMessage } from '../constants/publish';
import { verifyPublishSignature } from './dropDeployServer';

/**
 * The publish signature is the only thing standing between an API call and the
 * platform spending gas, so its failure modes matter more than its happy path.
 */
describe('publish signature', function () {
  this.timeout(20000);
  const artist = ethers.Wallet.createRandom();
  const someoneElse = ethers.Wallet.createRandom();
  const now = () => new Date().toISOString();

  it('accepts the drop owner', async () => {
    const at = now();
    const sig = await artist.signMessage(publishMessage(7, at));
    verifyPublishSignature(7, artist.address, at, sig); // throws on failure
  });

  it('rejects a signature from anyone else', async () => {
    const at = now();
    const sig = await someoneElse.signMessage(publishMessage(7, at));
    expect(() => verifyPublishSignature(7, artist.address, at, sig)).to.throw(/not from this drop/);
  });

  it('rejects a signature lifted onto a DIFFERENT drop', async () => {
    const at = now();
    const sig = await artist.signMessage(publishMessage(7, at));
    // same artist, same moment, different drop id — must not authorise drop 8
    expect(() => verifyPublishSignature(8, artist.address, at, sig)).to.throw(/not from this drop/);
  });

  it('rejects a stale signature', async () => {
    const old = new Date(Date.now() - 40 * 60 * 1000).toISOString();
    const sig = await artist.signMessage(publishMessage(7, old));
    expect(() => verifyPublishSignature(7, artist.address, old, sig)).to.throw(/expired/);
  });

  it('rejects garbage rather than throwing something unreadable', () => {
    expect(() => verifyPublishSignature(7, artist.address, now(), '0xdeadbeef')).to.throw(
      /could not be read/
    );
  });
});
