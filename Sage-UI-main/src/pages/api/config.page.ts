import type { NextApiRequest, NextApiResponse } from 'next';
import { Role } from '@prisma/client';
import { getRequester, requireRole } from '@/utilities/apiAuth';
import prisma from '@/prisma/client';

export default async (req: NextApiRequest, res: NextApiResponse) => {
  const {
    body: { featuredDropId, welcomeMessage },
    method,
  } = req;

  switch (method) {
    case 'GET': {
      // reading the config (welcome message / featured drop) only needs a session
      const requester = await getRequester(req);
      if (!requester) {
        res.status(401).end('Not Authenticated');
        return;
      }
      await getConfig(res);
      break;
    }
    case 'PATCH': {
      // writing the site-wide homepage config is ADMIN-only — previously any
      // signed-in wallet could rewrite the welcome message / featured drop
      const requester = await requireRole(req, res, [Role.ADMIN]);
      if (!requester) return;
      await updateConfig(Number(featuredDropId), welcomeMessage, res);
      break;
    }
    default:
      res.status(501).end();
  }
  res.end();
};

async function getConfig(res: NextApiResponse) {
  try {
    const result = await prisma.config.findMany({});
    if (result.length == 0) {
      res.json({
        featuredDropId: 0,
        welcomeMessage: '',
      });
    } else {
      res.json({
        featuredDropId: result[0].featuredDropId,
        welcomeMessage: result[0].welcomeMessage,
      });
    }
  } catch (e) {
    res.status(500).end();
  }
}

async function updateConfig(featuredDropId: number, welcomeMessage: string, res: NextApiResponse) {
  try {
    const data = {
      featuredDropId: featuredDropId != 0 ? featuredDropId : null,
      welcomeMessage,
    };
    const record = await prisma.config.findMany({});
    if (record.length > 0) {
      await prisma.config.update({ where: { id: record[0].id }, data });
    } else {
      await prisma.config.create({ data: { ...data, gasLimitForTxs: 50 } });
    }
  } catch (e) {
    console.log(e);
  }
}
