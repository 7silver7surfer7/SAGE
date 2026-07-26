import { expect } from 'chai';
import { ethers } from 'ethers';
import { tradeProvider } from '../components/Agent/trade';
import { PIXELS_TOKEN_ADDRESS } from '../constants/config';

/** Exercises the exact reads the three new agent tools perform. */
describe('agent web3 read tools', function () {
  this.timeout(60000);
  const p = tradeProvider();

  it('inspect_address: classifies a 7702 wallet, a contract, and reads a token balance', async () => {
    const wallet = '0x02201d4b12A8e81B7a9e515a8f72604E8042d73b'; // real holder
    const [bal, code, tok] = await Promise.all([
      p.getBalance(wallet),
      p.getCode(wallet),
      new ethers.Contract(PIXELS_TOKEN_ADDRESS, ['function balanceOf(address) view returns (uint256)'], p)
        .balanceOf(wallet),
    ]);
    const delegated = code.toLowerCase().startsWith('0xef0100') && code.length === 2 + 23 * 2;
    const kind = code === '0x' ? 'WALLET' : delegated ? 'WALLET · EIP-7702' : 'CONTRACT';
    console.log('   wallet  ->', kind, '| eth', ethers.utils.formatEther(bal), '| token', ethers.utils.formatEther(tok));
    expect(kind).to.contain('WALLET');

    const poolCode = await p.getCode('0x8366a39CC670B4001A1121B8F6A443A643e40951'); // v4 PoolManager
    console.log('   PoolManager ->', poolCode === '0x' ? 'WALLET' : 'CONTRACT', (poolCode.length - 2) / 2, 'bytes');
    expect(poolCode).to.not.equal('0x');
  });

  it('inspect_transaction: reports a real mined transaction', async () => {
    const block = await p.getBlock('latest');
    const withTx = block.transactions.length
      ? block
      : await p.getBlock(block.number - 1);
    const hash = withTx.transactions[0];
    if (!hash) return console.log('   (no tx in the last two blocks)');
    const [tx, rcpt] = await Promise.all([p.getTransaction(hash), p.getTransactionReceipt(hash)]);
    const status = !rcpt ? 'PENDING' : rcpt.status === 1 ? 'SUCCESS' : 'REVERTED';
    console.log('   tx', hash.slice(0, 12) + '… ->', status, '| block', rcpt?.blockNumber);
    expect(tx).to.not.equal(null);
  });

  it('get_chain_info: returns a live block and gas price', async () => {
    const [block, gas] = await Promise.all([p.getBlock('latest'), p.getGasPrice()]);
    console.log('   block', block.number.toLocaleString(), '| gas', ethers.utils.formatUnits(gas, 'gwei'), 'gwei');
    expect(block.number).to.be.greaterThan(0);
  });
});
