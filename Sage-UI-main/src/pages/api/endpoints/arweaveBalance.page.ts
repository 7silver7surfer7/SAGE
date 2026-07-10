import { getArweaveBalance } from '@/utilities/arweave-server';
import { NextApiRequest, NextApiResponse } from 'next';
import { Role } from '@prisma/client';
import { requireRole } from '@/utilities/apiAuth';

export default async function (request: NextApiRequest, response: NextApiResponse) {
  // exposes the platform's Arweave funding wallet address + balance — ADMIN only
  const requester = await requireRole(request, response, [Role.ADMIN]);
  if (!requester) return;
  response.json(await getArweaveBalance());
  response.end();
}
