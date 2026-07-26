import { expect } from 'chai';
import prisma from '../prisma/client';
import { dbBank, dbTransferPixels } from './pixelsLedger';

/**
 * Concurrency properties of the ledger, against a REAL Postgres.
 *
 * The bug these pin down is invisible in single-threaded reasoning and was
 * invisible in review: `dbBank` read `settled`, computed `settled + stream` in
 * JS, and wrote it back as a literal. Prisma emits that as `SET "settled" = $n`,
 * not `settled = settled + n`, so anything that committed in between was
 * overwritten — while its journal row survived, leaving the ledger disagreeing
 * with its own append-only record.
 *
 * Requires a local database (DATABASE_CONNECTION_POOL_URL). It writes and then
 * deletes two throwaway wallets; it must never be pointed at production.
 *
 *   npx mocha --require ts-node/register --require tsconfig-paths/register \
 *     --require dotenv/config src/utilities/pixelsLedger.concurrency.spec.ts
 */

const A = '0x00000000000000000000000000000000000A11CE';
const B = '0x00000000000000000000000000000000000B0B00';
const DAY = 86400 * 1000;

async function reset(settled: bigint, checkpoint: bigint, ageMs: number) {
  await prisma.pixelJournal.deleteMany({ where: { walletAddress: { in: [A, B] } } });
  await prisma.pixelAccount.deleteMany({ where: { walletAddress: { in: [A, B] } } });
  await prisma.pixelAccount.create({
    data: {
      walletAddress: A,
      settled,
      checkpointSage: checkpoint,
      lastSync: new Date(Date.now() - ageMs),
      streamDust: BigInt(0),
    },
  });
}

async function settledOf(addr: string): Promise<bigint> {
  const r = await prisma.pixelAccount.findUnique({ where: { walletAddress: addr } });
  return r?.settled ?? BigInt(0);
}

async function journalSum(addr: string): Promise<bigint> {
  const rows = await prisma.pixelJournal.findMany({ where: { walletAddress: addr } });
  return rows.reduce((s, r) => s + r.delta, BigInt(0));
}

describe('pixelsLedger :: concurrency', function () {
  this.timeout(30000);

  after(async () => {
    await prisma.pixelJournal.deleteMany({ where: { walletAddress: { in: [A, B] } } });
    await prisma.pixelAccount.deleteMany({ where: { walletAddress: { in: [A, B] } } });
    await prisma.$disconnect();
  });

  it('does NOT erase a spend that commits while a bank is in flight', async () => {
    await reset(BigInt(5000), BigInt(25_000_000), DAY);

    // Hold a row lock the way a spend does, so the interleaving is
    // deterministic rather than a matter of timing: dbBank must wait for this
    // transaction, observe its result, and add to it.
    let release: () => void = () => {};
    const held = new Promise<void>((r) => (release = r));
    const spender = prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT "walletAddress" FROM "PixelAccount" WHERE "walletAddress" = ${A} FOR UPDATE`;
      await held; // keep the lock until the bank is definitely queued behind it
      await tx.pixelAccount.update({ where: { walletAddress: A }, data: { settled: BigInt(3000) } });
      await tx.pixelJournal.create({
        data: { walletAddress: A, delta: BigInt(-2000), kind: 'spend', reason: 'test spend' },
      });
    });

    await new Promise((r) => setTimeout(r, 250));
    const banker = dbBank(A, BigInt(25_000_000));
    await new Promise((r) => setTimeout(r, 250));
    release();
    await spender;
    await banker;

    const settled = await settledOf(A);
    // one day at the cap = 25,000 pixels, on top of the post-spend 3,000
    expect(settled.toString()).to.equal('28000');
    // the old literal-write produced 5,000 + 25,000 = 30,000 — the 2,000 spend
    // silently refunded
    expect(settled.toString()).to.not.equal('30000');
  });

  it('keeps the journal able to reconstruct settled across a spend', async () => {
    await reset(BigInt(0), BigInt(25_000_000), DAY);
    // bank first so `settled` has a journalled starting point
    await dbBank(A, BigInt(25_000_000));
    await dbTransferPixels(A, B, BigInt(1000), 'test collect');

    expect((await journalSum(A)).toString()).to.equal((await settledOf(A)).toString());
    expect((await journalSum(B)).toString()).to.equal((await settledOf(B)).toString());
  });

  it('leaves a self-transfer exactly where it started', async () => {
    // seeded directly, so the journal starts empty and only the DELTA either
    // side of the call is meaningful here
    await reset(BigInt(10_000), BigInt(0), 0);
    const before = await settledOf(A);
    const journalBefore = await journalSum(A);
    await dbTransferPixels(A, A, BigInt(2500), 'test self-collect');
    expect((await settledOf(A)).toString()).to.equal(before.toString());
    expect(((await journalSum(A)) - journalBefore).toString()).to.equal('0');
  });

  it('refuses a spend larger than the balance', async () => {
    await reset(BigInt(100), BigInt(0), 0);
    let threw = '';
    await dbTransferPixels(A, B, BigInt(500), 'test overdraft').catch((e) => (threw = e.message));
    expect(threw).to.equal('insufficient pixels');
    expect((await settledOf(A)).toString()).to.equal('100');
  });
});
