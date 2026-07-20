/**
 * Moderation archive: exports a wallet's complete social record to a
 * self-contained local folder BEFORE a ban (bans are non-destructive — posts
 * only drop out of feeds — but an archive survives anything that happens to
 * the DB or the S3 media later, and is shareable as evidence).
 *
 * Captures: profile row, every post/reply they authored (including
 * soft-deleted, with counters), likes/reposts they gave, tips sent AND
 * received, follows both directions, collects of their posts, and a copy of
 * every media file (post images, pfp, banner) downloaded into media/.
 * Writes data.json (machine-readable) + posts.md (human-readable transcript).
 *
 * Run from Sage-UI-main with prod creds:
 *   node scripts/archive-user.mjs 0xWALLET
 * Output: ../backups/social-archives/<wallet>-<timestamp>/
 */
import { PrismaClient } from '@prisma/client';
import fs from 'fs';
import path from 'path';

const wallet = process.argv[2];
if (!wallet || !/^0x[0-9a-fA-F]{40}$/.test(wallet)) {
  console.error('usage: node scripts/archive-user.mjs 0xWALLET');
  process.exit(1);
}

const prisma = new PrismaClient();

async function main() {
  // canon casing: DB stores checksummed addresses; accept any casing
  const user = await prisma.user.findFirst({
    where: { walletAddress: { equals: wallet, mode: 'insensitive' } },
  });
  if (!user) throw new Error(`no User row for ${wallet}`);
  const addr = user.walletAddress;

  const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const outDir = path.resolve(`../backups/social-archives/${addr}-${stamp}`);
  fs.mkdirSync(path.join(outDir, 'media'), { recursive: true });

  const [posts, likes, reposts, tipsSent, tipsReceived, follows, followers, collects] =
    await Promise.all([
      prisma.socialPost.findMany({ where: { authorAddress: addr }, orderBy: { id: 'asc' } }),
      prisma.socialLike.findMany({ where: { userAddress: addr } }),
      prisma.socialRepost.findMany({ where: { userAddress: addr } }),
      prisma.socialTip.findMany({ where: { fromAddress: addr } }),
      prisma.socialTip.findMany({ where: { Post: { authorAddress: addr } } }),
      prisma.socialFollow.findMany({ where: { followerAddress: addr } }),
      prisma.socialFollow.findMany({ where: { followingAddress: addr } }),
      prisma.socialCollect.findMany({ where: { Post: { authorAddress: addr } } }),
    ]);

  // media: post images + profile assets, mirrored locally
  const urls = new Set();
  for (const p of posts) if (p.imageUrl) urls.add(p.imageUrl);
  if (user.profilePicture && user.profilePicture.startsWith('http')) urls.add(user.profilePicture);
  if (user.bannerImageS3Path && String(user.bannerImageS3Path).startsWith('http'))
    urls.add(user.bannerImageS3Path);
  let saved = 0;
  for (const url of urls) {
    try {
      const res = await fetch(url);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const name = decodeURIComponent(new URL(url).pathname.split('/').pop() || `file-${saved}`);
      fs.writeFileSync(path.join(outDir, 'media', name), Buffer.from(await res.arrayBuffer()));
      saved++;
    } catch (e) {
      console.warn(`media fetch failed (${e.message}): ${url}`);
    }
  }

  const data = {
    archivedAt: new Date().toISOString(),
    user,
    posts,
    likesGiven: likes,
    repostsGiven: reposts,
    tipsSent,
    tipsReceived,
    following: follows,
    followers,
    collectsOfTheirPosts: collects,
  };
  fs.writeFileSync(
    path.join(outDir, 'data.json'),
    JSON.stringify(data, (_k, v) => (typeof v === 'bigint' ? v.toString() : v), 2)
  );

  // human-readable transcript
  const lines = [
    `# Social archive — ${user.username || addr}`,
    `Wallet: ${addr}`,
    `Archived: ${data.archivedAt}`,
    `Posts: ${posts.length} | media saved: ${saved}/${urls.size}`,
    '',
  ];
  for (const p of posts) {
    lines.push(
      `---`,
      `**#${p.id}** ${p.createdAt.toISOString()}${p.replyToId ? ` (reply to #${p.replyToId})` : ''}${p.deletedAt ? ' [DELETED]' : ''}`,
      '',
      p.text || '(no text)',
      p.imageUrl ? `media: ${p.imageUrl}` : '',
      `likes ${p.likeCount} · reposts ${p.repostCount} · replies ${p.replyCount} · tips ${p.tipTotal}`,
      ''
    );
  }
  fs.writeFileSync(path.join(outDir, 'posts.md'), lines.filter((l) => l !== null).join('\n'));

  console.log(`archived ${posts.length} post(s), ${saved} media file(s) →`);
  console.log(outDir);
  await prisma.$disconnect();
}

main().catch((e) => {
  console.error('archive failed:', e.message);
  process.exit(1);
});
