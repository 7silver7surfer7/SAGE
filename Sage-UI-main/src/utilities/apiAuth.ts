import { NextApiRequest, NextApiResponse } from 'next';
import { getToken } from 'next-auth/jwt';
import { Role } from '@prisma/client';
import prisma from '@/prisma/client';

export interface Requester {
  walletAddress: string;
  role: Role;
}

/**
 * Resolves the signed-in caller and their role, or null when unauthenticated.
 *
 * Decodes the NextAuth JWT cookie directly (getToken) rather than getSession(),
 * which does an internal HTTP round-trip to /api/auth/session — that self-fetch
 * fails intermittently under trailingSlash:true (CLIENT_FETCH_ERROR) and is
 * slower. token.sub holds the SIWE wallet address.
 */
export async function getRequester(req: NextApiRequest): Promise<Requester | null> {
  // Must match the secret NextAuth encodes the session JWT with. This app's
  // [...nextauth] config sets jwt.secret = JWT_SECRET, so decode with that.
  const token = await getToken({ req, secret: process.env.JWT_SECRET });
  const walletAddress = token?.sub;
  if (!walletAddress) return null;
  const user = await prisma.user.findUnique({ where: { walletAddress } });
  if (!user) return null;
  return { walletAddress, role: user.role };
}

/**
 * Requires the caller to hold one of the given roles; writes a 401/403 and
 * returns null otherwise. Usage:
 *   const requester = await requireRole(req, res, [Role.ADMIN]);
 *   if (!requester) return;
 */
export async function requireRole(
  req: NextApiRequest,
  res: NextApiResponse,
  roles: Role[]
): Promise<Requester | null> {
  const requester = await getRequester(req);
  if (!requester) {
    res.status(401).json({ error: 'Please sign in' });
    return null;
  }
  if (!roles.includes(requester.role)) {
    res.status(403).json({ error: 'Insufficient permissions' });
    return null;
  }
  return requester;
}
