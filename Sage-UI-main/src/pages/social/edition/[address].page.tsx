import React from 'react';
import Head from 'next/head';
import { GetServerSideProps } from 'next';
import prisma from '@/prisma/client';
import SocialShell from '@/components/Social/SocialShell';
import EditionPanel from '@/components/Social/EditionPanel';
import { PUBLIC_SITE_URL } from '@/constants/config';

/**
 * A single edition, at its own URL.
 *
 * WHY THIS EXISTS. The launch share sheet linked to the ARTIST'S PROFILE, with
 * a comment explaining that "the edition contract address is not a routable
 * page" — stated as a fact of the world rather than a thing nobody had built.
 * Two consequences, both live on X right now:
 *
 *  1. The profile did not render a mint panel at all (EditionPanel was mounted
 *     only on the launcher), so followers landed on posts with no way to mint.
 *  2. The card previewed as the generic site blurb — "SAGE is a portal into
 *     Web3" — because a profile route has nothing per-edition to describe. A
 *     launch announcement looked like a link to the homepage.
 *
 * An announcement is about the ARTWORK, so the link should open the artwork:
 * its image in the card, its name in the title, and the mint immediately
 * present. Server-rendered because crawlers do not run the client fetch —
 * OpenGraph tags added after hydration are tags nobody reads.
 */

interface Props {
  edition: {
    address: string;
    artistAddress: string;
    name: string;
    symbol: string;
    imageUrl: string;
    priceEth: number;
    maxSupply: number;
    artistName: string | null;
  } | null;
}

export default function EditionPage({ edition }: Props) {
  if (!edition) {
    return (
      <SocialShell>
        <div className='social__empty'>That edition could not be found.</div>
      </SocialShell>
    );
  }
  const url = `${PUBLIC_SITE_URL.replace(/\/$/, '')}/social/edition/${edition.address}`;
  const by = edition.artistName || 'a SAGE artist';
  const title = `${edition.name} ($${edition.symbol}) by ${by}`;
  const price = edition.priceEth > 0 ? `${edition.priceEth} ETH` : 'free';
  const description = `Mint ${edition.name} on SAGE Social — ${price}, ${
    edition.maxSupply > 0 ? `${edition.maxSupply} edition${edition.maxSupply === 1 ? '' : 's'}` : 'open edition'
  }.`;

  return (
    <>
      <Head>
        <title>{title}</title>
        <meta name='description' content={description} />
        <meta property='og:title' content={title} />
        <meta property='og:description' content={description} />
        <meta property='og:site_name' content='SAGE Social' />
        <meta property='og:type' content='website' />
        <meta property='og:url' content={url} />
        <meta property='og:image' content={edition.imageUrl} />
        {/* summary_large_image, not summary: the artwork IS the pitch, and a
            64px thumbnail beside a generic blurb is what this replaces. */}
        <meta name='twitter:card' content='summary_large_image' />
        <meta name='twitter:title' content={title} />
        <meta name='twitter:description' content={description} />
        <meta name='twitter:image' content={edition.imageUrl} />
      </Head>
      <SocialShell>
        {/* `only` narrows the artist's shelf to the one that was shared. The
            mint UI, live supply and halt state all already live in
            EditionPanel; duplicating them here would be a second copy to keep
            correct. */}
        <EditionPanel address={edition.artistAddress} isSelf={false} only={edition.address} />
      </SocialShell>
    </>
  );
}

/**
 * Server-side and unauthenticated: this is a public landing page for a link
 * posted on X, so it must render for a logged-out stranger and for a crawler
 * that never executes JavaScript.
 */
export const getServerSideProps: GetServerSideProps<Props> = async (ctx) => {
  const raw = String(ctx.params?.address || '');
  if (!/^0x[a-fA-F0-9]{40}$/.test(raw)) return { props: { edition: null } };

  const row = await prisma.socialNftEdition.findFirst({
    where: { editionAddress: { equals: raw, mode: 'insensitive' } },
    include: { Artist: { select: { username: true } } },
  });
  if (!row) return { props: { edition: null } };

  return {
    props: {
      edition: {
        address: row.editionAddress,
        artistAddress: row.artistAddress,
        name: row.name,
        symbol: row.symbol,
        imageUrl: row.imageUrl,
        priceEth: row.priceEth,
        maxSupply: row.maxSupply,
        artistName: row.Artist?.username ?? null,
      },
    },
  };
};
