import { getArweaveBalance } from '@/utilities/arweave-server';
import { NextApiRequest, NextApiResponse } from 'next';

export default async function (request: NextApiRequest, response: NextApiResponse) {
  response.json(await getArweaveBalance());
  response.end();
}
