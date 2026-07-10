const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  await prisma.rewardType.upsert({
    where: { type: 'ETH_ASH' },
    update: {},
    create: {
      type: 'ETH_ASH',
      chainId: 1,
      rewardRate: 1.1574074074074073e-28,
      contract: '0x64d91f12ece7362f91a6f8e7940cd55f05060b92',
      startingBlock: 12447728,
      lastBlockInspected: 12447727,
      positionSizeLimit: "100000000000000000000000"
    }
  });

  await prisma.user.upsert({
    where: { walletAddress: '0x58a26F4048CdFd3785aD2139AeD336595af22fF5' },
    update: {},
    create: {
      walletAddress: '0x58a26F4048CdFd3785aD2139AeD336595af22fF5',
      createdAt: new Date(),
      role: 'ADMIN',
      bio: 'MemeX Dev',

    }
  })

  await prisma.$queryRaw`CREATE UNIQUE INDEX wallet_unique_idx ON public."User" (LOWER("walletAddress"));`;
}

main()
  .catch((e) => {
    console.error(e)
    process.exit(1)
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
