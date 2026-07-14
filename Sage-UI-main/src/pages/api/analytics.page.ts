import { NextApiRequest, NextApiResponse } from 'next';
import { Role } from '@prisma/client';
import { requireRole } from '@/utilities/apiAuth';
import prisma from '@/prisma/client';

/**
 * Admin portal: visitor + user analytics in one payload. Everything is
 * computed straight off SiteVisit (raw beacons, ~90d retention) plus the
 * social tables for engagement — no external analytics service.
 */
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const requester = await requireRole(req, res, [Role.ADMIN]);
  if (!requester) return;
  try {
    const now = Date.now();
    const d1 = new Date(now - 864e5);
    const d7 = new Date(now - 7 * 864e5);
    const d30 = new Date(now - 30 * 864e5);
    const live = new Date(now - 5 * 60 * 1000);

    const [
      liveVisitors,
      uv1, uv7, uv30,
      pv1, pv7, pv30,
      sessions7,
      dau, wau,
      newUsers7,
      topPages,
      topReferrers,
      devices,
      countries,
      convTotal, convWallet,
      dailyRaw,
      posts7, tips7, collects7,
    ] = await Promise.all([
      prisma.siteVisit.groupBy({ by: ['visitorId'], where: { createdAt: { gte: live } } }).then((r) => r.length),
      prisma.siteVisit.groupBy({ by: ['visitorId'], where: { createdAt: { gte: d1 } } }).then((r) => r.length),
      prisma.siteVisit.groupBy({ by: ['visitorId'], where: { createdAt: { gte: d7 } } }).then((r) => r.length),
      prisma.siteVisit.groupBy({ by: ['visitorId'], where: { createdAt: { gte: d30 } } }).then((r) => r.length),
      prisma.siteVisit.count({ where: { createdAt: { gte: d1 } } }),
      prisma.siteVisit.count({ where: { createdAt: { gte: d7 } } }),
      prisma.siteVisit.count({ where: { createdAt: { gte: d30 } } }),
      prisma.siteVisit.groupBy({ by: ['sessionId'], where: { createdAt: { gte: d7 } } }).then((r) => r.length),
      prisma.siteVisit.groupBy({ by: ['walletAddress'], where: { createdAt: { gte: d1 }, walletAddress: { not: null } } }).then((r) => r.length),
      prisma.siteVisit.groupBy({ by: ['walletAddress'], where: { createdAt: { gte: d7 }, walletAddress: { not: null } } }).then((r) => r.length),
      prisma.user.count({ where: { createdAt: { gte: d7 } } }),
      prisma.siteVisit.groupBy({ by: ['path'], where: { createdAt: { gte: d7 } }, _count: { _all: true }, orderBy: { _count: { path: 'desc' } }, take: 10 }),
      prisma.siteVisit.groupBy({ by: ['referrer'], where: { createdAt: { gte: d7 }, referrer: { not: null } }, _count: { _all: true }, orderBy: { _count: { referrer: 'desc' } }, take: 8 }),
      prisma.siteVisit.groupBy({ by: ['device'], where: { createdAt: { gte: d7 } }, _count: { _all: true } }),
      prisma.siteVisit.groupBy({ by: ['country'], where: { createdAt: { gte: d7 }, country: { not: null } }, _count: { _all: true }, orderBy: { _count: { country: 'desc' } }, take: 8 }),
      prisma.siteVisit.groupBy({ by: ['visitorId'], where: { createdAt: { gte: d30 } } }).then((r) => r.length),
      prisma.siteVisit
        .groupBy({ by: ['visitorId'], where: { createdAt: { gte: d30 }, walletAddress: { not: null } } })
        .then((r) => r.length),
      // daily series (visitors + pageviews, last 30 days) in one SQL pass
      prisma.$queryRaw<{ day: Date; visitors: bigint; pageviews: bigint }[]>`
        SELECT date_trunc('day', "createdAt") AS day,
               COUNT(DISTINCT "visitorId") AS visitors,
               COUNT(*) AS pageviews
        FROM "SiteVisit"
        WHERE "createdAt" >= ${d30}
        GROUP BY 1 ORDER BY 1`,
      prisma.socialPost.count({ where: { createdAt: { gte: d7 }, deletedAt: null } }),
      prisma.socialTip.count({ where: { createdAt: { gte: d7 } } }),
      prisma.socialCollect.count({ where: { createdAt: { gte: d7 } } }),
    ]);

    res.json({
      live: { visitors: liveVisitors },
      visitors: { d1: uv1, d7: uv7, d30: uv30 },
      pageviews: { d1: pv1, d7: pv7, d30: pv30 },
      sessions7,
      activeWallets: { dau, wau },
      newUsers7,
      conversion: {
        visitors30: convTotal,
        signedIn30: convWallet,
        pct: convTotal ? Math.round((convWallet / convTotal) * 1000) / 10 : 0,
      },
      topPages: topPages.map((p) => ({ path: p.path, views: p._count._all })),
      topReferrers: topReferrers.map((r2) => ({ host: r2.referrer, views: r2._count._all })),
      devices: devices.map((d) => ({ device: d.device, views: d._count._all })),
      countries: countries.map((c) => ({ country: c.country, views: c._count._all })),
      daily: dailyRaw.map((r2) => ({
        day: r2.day,
        visitors: Number(r2.visitors),
        pageviews: Number(r2.pageviews),
      })),
      social7: { posts: posts7, tips: tips7, collects: collects7 },
    });
  } catch (e: any) {
    console.error('analytics failed', e);
    res.status(500).json({ error: e?.message || 'analytics failed' });
  }
}
