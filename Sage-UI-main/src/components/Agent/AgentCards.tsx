import { useState, CSSProperties, ReactNode } from 'react';
import { C, label, mono, btnPrimary, btnGhost, hairlineStack } from './tokens';
import type { Card, KV, ListRow } from './types';

/**
 * SAGE Agent — result cards, ported from the "SAGE Agent.dc.html" design.
 *
 * One component switching on `card.kind`. The bordered surface around a card is
 * the caller's job (the design wraps every card in the same `surface` div), so
 * everything here is the INNER content only.
 */
export interface Props {
  card: Card;
  onConnect: () => void;
}

/** Accent chip used as the eyebrow on the drop, tx and credits cards. */
const pill: CSSProperties = {
  ...label(9.5, C.panel),
  background: C.accent,
  padding: '4px 8px',
  fontWeight: 700,
};

/** Body copy inside artist / credits / wallet cards. */
const cardBody: CSSProperties = {
  fontSize: '14.5px',
  lineHeight: 1.6,
  color: C.ink2,
  textWrap: 'pretty',
};

/** A KV row on the design's hairline stack — the 1px gap is the rule. */
function kvRow(row: KV, padding: string, gap: number) {
  return (
    <div
      key={row.k}
      style={{
        background: C.panel,
        display: 'flex',
        justifyContent: 'space-between',
        gap,
        padding,
      }}
    >
      <span style={label(10, C.ink3, '0.16em')}>{row.k}</span>
      <span style={mono(12)}>{row.v}</span>
    </div>
  );
}

/**
 * `style-hover` in the design is not a React feature; these two wrappers are the
 * whole of the port's hover handling rather than a CSS-in-JS dependency.
 */
function HoverButton({
  style,
  hoverStyle,
  onClick,
  children,
}: {
  style: CSSProperties;
  hoverStyle: CSSProperties;
  onClick?: () => void;
  children: ReactNode;
}) {
  const [hover, setHover] = useState(false);
  return (
    <button
      type="button"
      onClick={onClick}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={hover ? { ...style, ...hoverStyle } : style}
    >
      {children}
    </button>
  );
}

function HoverRow({ style, hoverStyle, children }: { style: CSSProperties; hoverStyle: CSSProperties; children: ReactNode }) {
  const [hover, setHover] = useState(false);
  return (
    <div
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={hover ? { ...style, ...hoverStyle } : style}
    >
      {children}
    </div>
  );
}

/**
 * Stands in for the design's <image-slot>. With real drops wired in we usually
 * have actual artwork, so render it and keep the hint as the fallback for rows
 * that have no banner yet. A plain <img> rather than next/image: the source is
 * a stored S3/IPFS gateway URL whose host may not be in images.domains, and a
 * card that fails to render is worse than one that skips optimisation.
 */
function ImageSlot({ hint, url }: { hint?: string; url?: string | null }) {
  // Real catalogues contain rows whose banner has moved, 404s, or sits behind a
  // slow IPFS gateway. Falling back to the placeholder beats a broken-image
  // glyph in the middle of an answer.
  const [failed, setFailed] = useState(false);
  if (url && !failed) {
    return (
      <img
        src={url}
        alt={hint || ''}
        onError={() => setFailed(true)}
        style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}
      />
    );
  }
  return (
    <div
      style={{
        width: '100%',
        height: '100%',
        background: C.raised,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '10px',
        textAlign: 'center',
        overflow: 'hidden',
        ...label(9, C.ink3, '0.18em'),
      }}
    >
      {hint}
    </div>
  );
}

export default function AgentCard({ card, onConnect }: Props) {
  if (card.kind === 'drop') {
    return (
      <div style={{ display: 'flex', flexWrap: 'wrap' }}>
        <div
          style={{
            width: '208px',
            height: '208px',
            flex: 'none',
            borderRight: `1px solid ${C.line}`,
            position: 'relative',
          }}
        >
          <ImageSlot hint={card.imgHint} url={card.imgUrl} />
        </div>
        <div
          style={{
            flex: 1,
            minWidth: '232px',
            padding: '20px 22px',
            display: 'flex',
            flexDirection: 'column',
            justifyContent: 'space-between',
            gap: '18px',
          }}
        >
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '12px' }}>
              <span style={pill}>{card.status}</span>
              <span style={label(9.5, C.ink3, '0.18em')}>{card.chain}</span>
            </div>
            <div style={{ fontSize: '25px', letterSpacing: '-0.01em', lineHeight: 1.1 }}>{card.title}</div>
            <div style={{ fontSize: '14px', color: C.ink2, fontStyle: 'italic', marginTop: '6px' }}>
              {card.byline}
            </div>
          </div>
          <div style={{ display: 'flex', gap: '26px', flexWrap: 'wrap' }}>
            {[
              { k: 'PRICE', v: card.price },
              { k: 'EDITIONS', v: card.editions },
              { k: 'MINTED', v: card.minted },
            ].map((stat) => (
              <div key={stat.k}>
                <div style={{ ...label(9, C.ink3), marginBottom: '6px' }}>{stat.k}</div>
                <div style={mono(14)}>{stat.v}</div>
              </div>
            ))}
          </div>
        </div>
      </div>
    );
  }

  if (card.kind === 'artist') {
    return (
      <div style={{ padding: '22px', display: 'flex', gap: '20px', alignItems: 'flex-start', flexWrap: 'wrap' }}>
        <div style={{ width: '84px', height: '84px', flex: 'none' }}>
          <ImageSlot hint={card.imgHint} url={card.imgUrl} />
        </div>
        <div style={{ flex: 1, minWidth: '220px' }}>
          <div style={{ ...label(9, C.ink3), marginBottom: '9px' }}>ARTIST</div>
          <div style={{ fontSize: '21px', letterSpacing: '-0.01em' }}>{card.title}</div>
          <div style={{ ...label(10.5, C.accent, '0.12em'), marginTop: '5px' }}>{card.byline}</div>
          <div style={{ ...cardBody, marginTop: '12px' }}>{card.body}</div>
        </div>
      </div>
    );
  }

  if (card.kind === 'stats') {
    return (
      <div style={{ padding: '20px 22px' }}>
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: '12px',
            marginBottom: '18px',
          }}
        >
          <div style={label(9.5, C.ink3)}>{card.status}</div>
          <div style={label(10.5, C.accent, '0.12em')}>{card.byline}</div>
        </div>
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(122px, 1fr))',
            gap: 1,
            background: C.line,
          }}
        >
          {card.rows.map((row) => (
            <div key={row.k} style={{ background: C.panel, padding: '15px 14px' }}>
              <div style={{ ...label(9, C.ink3, '0.18em'), marginBottom: '8px' }}>{row.k}</div>
              <div style={mono(16)}>{row.v}</div>
            </div>
          ))}
        </div>
      </div>
    );
  }

  if (card.kind === 'tx') {
    return (
      <div style={{ padding: '20px 22px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '16px' }}>
          <span style={pill}>{card.status}</span>
          <span style={label(9.5, C.ink3, '0.18em')}>{card.byline}</span>
        </div>
        <div style={{ fontSize: '19px', marginBottom: '16px' }}>{card.title}</div>
        <div style={{ ...hairlineStack, marginBottom: '18px' }}>
          {card.rows.map((row) => kvRow(row, '11px 0', 16))}
        </div>
        {/*
          The confirm/discard pair only exists while the tx is pending: the agent
          composes the transaction, but a human presses the button before
          anything is signed or moves on-chain. Never auto-confirm here.
        */}
        {card.pending && (
          <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap' }}>
            <HoverButton
              onClick={card.confirm}
              style={{ ...btnPrimary, padding: '12px 22px' }}
              hoverStyle={{ background: C.ink }}
            >
              {card.cta}
            </HoverButton>
            <HoverButton
              onClick={card.cancel}
              style={btnGhost}
              hoverStyle={{ color: C.ink, border: `1px solid ${C.ink}` }}
            >
              discard
            </HoverButton>
          </div>
        )}
      </div>
    );
  }

  if (card.kind === 'tweet') {
    return (
      <div style={{ padding: '18px 22px', display: 'flex', gap: '16px', alignItems: 'flex-start' }}>
        <div
          style={{
            width: '34px',
            height: '34px',
            flex: 'none',
            border: `1px solid ${C.lineStrong}`,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            ...mono(13, C.accent),
          }}
        >
          𝕏
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div
            style={{
              display: 'flex',
              gap: '12px',
              alignItems: 'baseline',
              flexWrap: 'wrap',
              marginBottom: '9px',
            }}
          >
            <span style={mono(12)}>{card.handle}</span>
            <span style={label(9, C.accent)}>{card.status}</span>
          </div>
          <div
            style={{
              fontSize: '15px',
              lineHeight: 1.55,
              color: C.inkBody,
              whiteSpace: 'pre-wrap',
              textWrap: 'pretty',
            }}
          >
            {card.tweetBody}
          </div>
        </div>
      </div>
    );
  }

  if (card.kind === 'listings') {
    return (
      <div>
        <div
          style={{
            padding: '18px 22px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: '14px',
            borderBottom: `1px solid ${C.line}`,
            flexWrap: 'wrap',
          }}
        >
          <div>
            <div style={{ ...label(9, C.ink3), marginBottom: '8px' }}>{card.status}</div>
            <div style={{ fontSize: '18px' }}>{card.title}</div>
          </div>
          <div style={label(10.5, C.accent, '0.14em')}>{card.byline}</div>
        </div>
        {card.listRows.map((row: ListRow) => (
          <HoverRow
            key={row.k}
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: '16px',
              padding: '13px 22px',
              borderBottom: `1px solid ${C.line}`,
              flexWrap: 'wrap',
            }}
            hoverStyle={{ background: C.raised }}
          >
            <div style={{ display: 'flex', alignItems: 'baseline', gap: '14px' }}>
              <span style={mono(13)}>{row.k}</span>
              <span style={label(9.5, C.ink3, '0.14em')}>{row.sub}</span>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
              <span style={mono(13)}>{row.v}</span>
              <HoverButton
                onClick={row.buy}
                style={{
                  ...label(10, C.accent, '0.18em'),
                  textTransform: 'uppercase',
                  background: 'transparent',
                  border: `1px solid ${C.lineStrong}`,
                  padding: '8px 14px',
                  cursor: 'pointer',
                  fontWeight: 700,
                }}
                hoverStyle={{ background: C.accent, color: C.panel, border: `1px solid ${C.accent}` }}
              >
                buy
              </HoverButton>
            </div>
          </HoverRow>
        ))}
      </div>
    );
  }

  if (card.kind === 'credits') {
    return (
      <div style={{ padding: '22px', display: 'flex', gap: '22px', flexWrap: 'wrap', alignItems: 'center' }}>
        <div style={{ flex: 1, minWidth: '220px' }}>
          <div style={{ ...pill, display: 'inline-block', marginBottom: '14px' }}>{card.status}</div>
          <div style={{ fontSize: '21px', letterSpacing: '-0.01em' }}>{card.title}</div>
          <div style={{ ...cardBody, marginTop: '8px', maxWidth: '420px' }}>{card.body}</div>
        </div>
        <div style={{ ...hairlineStack, minWidth: '210px' }}>
          {card.rows.map((row) => kvRow(row, '10px 0', 20))}
        </div>
      </div>
    );
  }

  if (card.kind === 'wallet') {
    return (
      <div style={{ padding: '22px' }}>
        <div style={{ ...label(9.5, C.ink3), marginBottom: '12px' }}>{card.status}</div>
        <div style={{ fontSize: '18px', marginBottom: '8px' }}>{card.title}</div>
        <div style={{ ...cardBody, marginBottom: '18px', maxWidth: '440px' }}>{card.body}</div>
        <div style={hairlineStack}>{card.rows.map((row) => kvRow(row, '11px 0', 16))}</div>
        {/* The agent cannot connect a wallet on the user's behalf — this hands off to the app's connect flow. */}
        {card.needsConnect && (
          <HoverButton
            onClick={onConnect}
            // ink-on-panel rather than the usual accent: the design makes connect
            // the loudest thing on the card, then swaps to accent on hover.
            style={{ ...btnPrimary, background: C.ink, padding: '12px 22px', marginTop: '4px' }}
            hoverStyle={{ background: C.accent }}
          >
            connect wallet
          </HoverButton>
        )}
      </div>
    );
  }

  return null;
}
