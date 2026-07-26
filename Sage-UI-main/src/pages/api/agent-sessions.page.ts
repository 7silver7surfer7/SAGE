import type { NextApiRequest, NextApiResponse } from 'next';
import { ethers } from 'ethers';
import prisma from '@/prisma/client';
import { getRequester, isCrossSiteRequest } from '@/utilities/apiAuth';

/**
 * SAGE Agent conversation sessions.
 *
 * The rail's session list shipped as three hardcoded strings. This makes it
 * real: threads are owned by the wallet that created them, persist their
 * messages so a thread reopens rather than merely being listed, and can be
 * archived out of the rail without being destroyed.
 *
 * OWNERSHIP IS CHECKED ON EVERY PATH. A session id is a uuid, not a secret,
 * and every read and write below is scoped to the SIWE address — otherwise
 * anyone holding an id could read someone else's conversation, which carries
 * their wallet balances and trade history.
 */

const MAX_TITLE = 80;
const MAX_TEXT = 20_000;
const MAX_SESSIONS = 200;

/** First user message, trimmed to something that reads as a title. */
function titleFrom(text: string): string {
  const clean = String(text || '')
    .replace(/\s+/g, ' ')
    .trim();
  if (!clean) return 'New session';
  return clean.length > MAX_TITLE ? `${clean.slice(0, MAX_TITLE - 1)}…` : clean;
}

/** "2H AGO" / "YESTERDAY" / "3 JUL" — the rail's own vocabulary. */
export function relativeWhen(then: Date, now = new Date()): string {
  const mins = Math.floor((now.getTime() - then.getTime()) / 60000);
  if (mins < 1) return 'JUST NOW';
  if (mins < 60) return `${mins}M AGO`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}H AGO`;
  const days = Math.floor(hours / 24);
  if (days === 1) return 'YESTERDAY';
  return then
    .toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })
    .toUpperCase();
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (isCrossSiteRequest(req, res)) return;

  const requester = await getRequester(req);
  if (!requester?.walletAddress) {
    return res.status(401).json({ error: 'sign in to use sessions' });
  }
  const address = ethers.utils.getAddress(requester.walletAddress);

  // ── list, or read one ────────────────────────────────────────────────────
  if (req.method === 'GET') {
    const id = String(req.query.id || '');
    if (id) {
      const session = await prisma.agentSession.findFirst({
        // findFirst, not findUnique: the address is part of the predicate, so
        // a valid id belonging to someone else simply does not resolve.
        where: { id, address },
        include: { messages: { orderBy: { id: 'asc' }, take: 400 } },
      });
      if (!session) return res.status(404).json({ error: 'no such session' });
      return res.json({
        id: session.id,
        title: session.title,
        archived: session.archived,
        messages: session.messages.map((m) => ({
          role: m.role,
          text: m.text,
          payload: m.payload ?? null,
        })),
      });
    }

    const archived = String(req.query.archived || '') === '1';
    const sessions = await prisma.agentSession.findMany({
      where: { address, archived },
      orderBy: { updatedAt: 'desc' },
      take: 50,
      select: { id: true, title: true, updatedAt: true, archived: true },
    });
    return res.json({
      sessions: sessions.map((s) => ({
        id: s.id,
        title: s.title,
        archived: s.archived,
        when: relativeWhen(s.updatedAt),
      })),
    });
  }

  // ── create, or append a message ──────────────────────────────────────────
  if (req.method === 'POST') {
    const id = String(req.body?.id || '');

    if (!id) {
      const count = await prisma.agentSession.count({ where: { address, archived: false } });
      if (count >= MAX_SESSIONS) {
        return res.status(429).json({ error: 'too many open sessions — archive some first' });
      }
      const created = await prisma.agentSession.create({
        data: { address, title: titleFrom(req.body?.title) },
        select: { id: true, title: true, updatedAt: true },
      });
      return res.json({
        id: created.id,
        title: created.title,
        when: relativeWhen(created.updatedAt),
      });
    }

    const owned = await prisma.agentSession.findFirst({
      where: { id, address },
      select: { id: true, title: true },
    });
    if (!owned) return res.status(404).json({ error: 'no such session' });

    const role = req.body?.role === 'assistant' ? 'assistant' : 'user';
    const text = String(req.body?.text || '').slice(0, MAX_TEXT);
    const payload = req.body?.payload ?? null;

    await prisma.agentMessage.create({ data: { sessionId: id, role, text, payload } });
    // touch the session so the rail orders by real activity
    await prisma.agentSession.update({
      where: { id },
      data: {
        updatedAt: new Date(),
        // "New session" is a placeholder until the first thing actually said
        ...(owned.title === 'New session' && role === 'user' ? { title: titleFrom(text) } : {}),
      },
    });
    return res.json({ ok: true });
  }

  // ── archive / restore / rename ───────────────────────────────────────────
  if (req.method === 'PATCH') {
    const id = String(req.body?.id || '');
    const owned = await prisma.agentSession.findFirst({ where: { id, address }, select: { id: true } });
    if (!owned) return res.status(404).json({ error: 'no such session' });

    // Settle a stored CARD in place.
    //
    // Message payloads are written when the turn is created, so a tx card is
    // persisted with pending:true. Signing updates React state but never the
    // row — so reopening a session replayed an ALREADY-MINTED order as an
    // unsigned one, inviting the user to mint the same artwork twice. Patch
    // the stored card so the history matches what actually happened.
    const cardId = String(req.body?.cardId || '');
    if (cardId && req.body?.cardPatch && typeof req.body.cardPatch === 'object') {
      const msgs = await prisma.agentMessage.findMany({
        where: { sessionId: id },
        select: { id: true, payload: true },
        orderBy: { id: 'desc' },
        take: 40, // the card being settled is always recent
      });
      for (const m of msgs) {
        const payload: any = m.payload;
        const cards = payload?.cards;
        if (!Array.isArray(cards)) continue;
        const idx = cards.findIndex((c: any) => c?.id === cardId);
        if (idx < 0) continue;
        cards[idx] = { ...cards[idx], ...req.body.cardPatch };
        await prisma.agentMessage.update({
          where: { id: m.id },
          data: { payload: { ...payload, cards } },
        });
        return res.json({ settled: true, cardId });
      }
      return res.json({ settled: false, cardId }); // nothing to patch is not an error
    }

    const data: { archived?: boolean; title?: string } = {};
    if (typeof req.body?.archived === 'boolean') data.archived = req.body.archived;
    if (typeof req.body?.title === 'string') data.title = titleFrom(req.body.title);
    if (!Object.keys(data).length) return res.status(400).json({ error: 'nothing to change' });

    const updated = await prisma.agentSession.update({
      where: { id },
      data,
      select: { id: true, title: true, archived: true, updatedAt: true },
    });
    return res.json({ ...updated, when: relativeWhen(updated.updatedAt) });
  }

  return res.status(405).json({ error: 'method not allowed' });
}
