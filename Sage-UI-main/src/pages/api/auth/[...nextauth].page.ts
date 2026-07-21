import NextAuth from 'next-auth';
import CredentialsProvider from 'next-auth/providers/credentials';
import { getCsrfToken } from 'next-auth/react';
import TwitterProvider from 'next-auth/providers/twitter';
import { SiweMessage } from 'siwe';
import { NextApiRequest, NextApiResponse } from 'next';
import prisma from '@/prisma/client';

// The exact SIWE statement sage-mcp/siwe-session.js signs with — the bundled
// browser UI never constructs or shows this string, so in normal use it's a
// real behavioral signal that a sign-in came from the MCP client, not a
// plain self-reported flag toggled in a request body.
//
// SECURITY NOTE (found in a 2026-07-16 audit, not fully fixable without a
// different architecture): SIWE messages are entirely client-constructed —
// nothing cryptographically binds a signature to the sage-mcp CODE
// specifically, only to the wallet that signed it. A technically sophisticated
// human could copy this exact string from the open-source repo and POST a
// hand-crafted sign-in directly to the credentials callback, bypassing the
// bundled UI to self-assign the "Agent" badge. Treat this as a best-effort
// "signed statement" the same way the badge's own tooltip is worded, not a
// cryptographic proof of what software is driving the wallet. A stronger
// guarantee would need a separate, server-issued challenge unique to the MCP
// bootstrap flow — out of scope for this pass.
// Must match sage-mcp/siwe-session.js's copy character-for-character, or the
// badge silently never lights up for genuine agent sign-ins.
export const AGENT_SIWE_STATEMENT =
  'I accept the SAGE Terms of Service and Privacy Policy. Signing in as an autonomous AI agent via the SAGE MCP server, not a human.';

// For more information on each option (and a full list of options) go to
// https://next-auth.js.org/configuration/options
export default async function auth(req: NextApiRequest, res: NextApiResponse) {
  const providers = [
    TwitterProvider({
      clientId: process.env.TWITTER_CLIENT_ID,
      clientSecret: process.env.TWITTER_CLIENT_SECRET,
      version: '2.0',
      authorization: {},
      profile(profile) {
        return null;
      },
    }),
    CredentialsProvider({
      name: 'Ethereum',
      credentials: {
        message: {
          label: 'Message',
          type: 'text',
          placeholder: '0x0',
        },
        signature: {
          label: 'Signature',
          type: 'text',
          placeholder: '0x0',
        },
      },
      async authorize(credentials) {
        try {
          const siwe = new SiweMessage(JSON.parse(credentials?.message || '{}'));
          const nextAuthUrl = new URL(process.env.NEXTAUTH_URL as string);

          // Verify SIWE request origin — was gated to production-only, which
          // meant this domain-binding check was a no-op on every OTHER real,
          // publicly-reachable deployment (staging/testnet.sageart.xyz built
          // with NEXT_PUBLIC_APP_MODE=staging). A phishing page hosted
          // anywhere could relay a signature to that live site with the
          // wallet prompt still showing the legitimate domain. NEXTAUTH_URL
          // is correctly set per-environment (including local dev), so this
          // is safe to enforce everywhere.
          if (siwe.domain !== nextAuthUrl.host) {
            return null;
          }

          // Pass only the headers: with the full req (which has a parsed body),
          // next-auth >=4.19 turns this internal csrf lookup into a POST to
          // /api/auth/csrf, which fails and returns undefined — rejecting every
          // sign-in at the nonce check.
          if (siwe.nonce !== (await getCsrfToken({ req: { headers: req.headers } }))) {
            return null;
          }

          await siwe.verify({ signature: credentials?.signature || '' }, {});
          const isAgent = siwe.statement === AGENT_SIWE_STATEMENT;
          if (isAgent) {
            // Flip it on every agent sign-in, not just the first — self-heals
            // for a wallet that already had a User row before this field
            // existed. A no-op (0 rows) if the row doesn't exist yet; the
            // isAgent returned below carries the signal into the JWT for
            // createUser() to persist at first-creation time instead.
            await prisma.user
              .updateMany({ where: { walletAddress: siwe.address }, data: { isAgent: true } })
              .catch(() => {});
          }
          return {
            id: siwe.address,
            isAgent,
          };
        } catch (e) {
          return null;
        }
      },
    }),
  ];

  const isDefaultSigninPage = req.method === 'GET' && req.query.nextauth?.includes('signin')!;

  // Hides Sign-In with Ethereum from default sign page
  if (isDefaultSigninPage) {
    providers.pop();
  }

  return await NextAuth(req, res, {
    // https://next-auth.js.org/configuration/providers/oauth
    providers,
    session: {
      strategy: 'jwt',
    },
    jwt: {
      secret: process.env.JWT_SECRET,
    },
    secret: process.env.NEXTAUTH_SECRET,
    callbacks: {
      async jwt({ token, user }) {
        // `user` is only populated on the sign-in call, not every refresh —
        // stamp isAgent onto the token then so it survives for the session's
        // lifetime without re-querying the DB on every request.
        if (user) token.isAgent = (user as any).isAgent === true;
        return token;
      },
      async session({ session, token }) {
        session.address = token.sub;
        (session as any).isAgent = token.isAgent === true;
        return session;
      },
    },
  });
}
