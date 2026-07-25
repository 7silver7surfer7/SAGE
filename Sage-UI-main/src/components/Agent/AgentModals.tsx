/**
 * SAGE Agent — the four full-screen overlays: ledger, portfolio, social agent
 * and credit top-up. Ported from the "SAGE Agent.dc.html" design.
 *
 * One file, four named exports: they share the scrim, the header row and the
 * hairline-stack row treatment, and nothing else in the app opens them.
 */
import React, { useState } from 'react';
import { C, F, label, mono, btnPrimary, btnGhost, scrim } from './tokens';
import type { BotLink, Holding, Tier, TxRecord } from './types';

/* `text-wrap: pretty` is not in this @types/react's csstype yet, so it has to
 * come in through a cast. It only balances the last line of the blurbs. */
const prettyWrap = { textWrap: 'pretty' } as unknown as React.CSSProperties;

/* ------------------------------------------------------------------ shims */

interface HoverProps {
  style: React.CSSProperties;
  /** merged over `style` while hovered/focused */
  hover: React.CSSProperties;
  children?: React.ReactNode;
}

/**
 * The design expresses hover with a `style-hover` attribute, which React has no
 * equivalent for. Rather than add a CSS-in-JS dependency for a handful of
 * colour swaps, these two shims merge the hover style on pointer/focus enter.
 */
function HoverDiv({ style, hover, children }: HoverProps) {
  const [on, setOn] = useState(false);
  return (
    <div
      style={on ? { ...style, ...hover } : style}
      onMouseEnter={() => setOn(true)}
      onMouseLeave={() => setOn(false)}
    >
      {children}
    </div>
  );
}

function HoverButton({
  style,
  hover,
  onClick,
  children,
}: HoverProps & { onClick?: () => void }) {
  const [on, setOn] = useState(false);
  return (
    <button
      type="button"
      onClick={onClick}
      style={on ? { ...style, ...hover } : style}
      onMouseEnter={() => setOn(true)}
      onMouseLeave={() => setOn(false)}
      onFocus={() => setOn(true)}
      onBlur={() => setOn(false)}
    >
      {children}
    </button>
  );
}

/* ----------------------------------------------------------------- shared */

interface ShellProps {
  onClose: () => void;
  maxWidth: number;
  /**
   * The design stacks the overlays so a panel opened from another panel lands
   * on top: history 43 → portfolio 42 → bot 41 → buy 40.
   */
  zIndex: number;
  children: React.ReactNode;
}

function Shell({ onClose, maxWidth, zIndex, children }: ShellProps) {
  return (
    <div
      style={{ ...scrim, zIndex }}
      // only a click on the scrim itself dismisses; clicks inside the panel bubble here too
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        style={{
          width: '100%',
          maxWidth: `${maxWidth}px`,
          margin: 'auto',
          background: C.panel,
          border: `1px solid ${C.lineStrong}`,
          fontFamily: F.sans,
          color: C.ink,
        }}
      >
        {children}
      </div>
    </div>
  );
}

const headerRow: React.CSSProperties = {
  display: 'flex',
  alignItems: 'flex-start',
  justifyContent: 'space-between',
  gap: '20px',
  padding: '26px 28px',
  borderBottom: `1px solid ${C.line}`,
};

const eyebrow: React.CSSProperties = { ...label(9.5, C.ink3, '0.24em'), marginBottom: '12px' };

const h2: React.CSSProperties = {
  margin: 0,
  fontSize: '30px',
  fontWeight: 500,
  letterSpacing: '-0.02em',
};

const blurb: React.CSSProperties = {
  margin: '10px 0 0',
  fontSize: '14.5px',
  lineHeight: 1.6,
  color: C.ink2,
  ...prettyWrap,
};

const escStyle: React.CSSProperties = {
  ...btnGhost,
  fontSize: '11px',
  letterSpacing: '0.18em',
  border: `1px solid ${C.lineStrong}`,
  padding: '8px 12px',
  flex: 'none',
};

function EscButton({ onClose }: { onClose: () => void }) {
  return (
    <HoverButton
      onClick={onClose}
      style={escStyle}
      hover={{ color: C.ink, border: `1px solid ${C.ink}` }}
    >
      ESC
    </HoverButton>
  );
}

/** Section heading inside a panel body ("TOKENS", "LINKED ACCOUNTS · …"). */
const sectionLabel: React.CSSProperties = { ...label(9, C.ink3, '0.22em'), marginBottom: '16px' };

/** The panel body's hairline-separated list: 1px of `line` shows between rows. */
const listStack: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: '1px',
  background: C.line,
};

const inputStyle: React.CSSProperties = {
  flex: 1,
  background: C.bg,
  border: `1px solid ${C.lineStrong}`,
  color: C.ink,
  padding: '12px 14px',
  outline: 'none',
};

/* ---------------------------------------------------------------- history */

export interface HistoryModalProps {
  onClose: () => void;
  /** the wallet the ledger belongs to */
  address: string;
  txRows: TxRecord[];
}

export function HistoryModal({ onClose, address, txRows }: HistoryModalProps) {
  const countLabel = `${txRows.length} ${txRows.length === 1 ? 'entry' : 'entries'} logged`;

  return (
    <Shell onClose={onClose} maxWidth={900} zIndex={43}>
      <div style={headerRow}>
        <div>
          <div style={eyebrow}>LEDGER · {address}</div>
          <h2 style={h2}>Transaction history</h2>
          <p style={{ ...blurb, maxWidth: '460px' }}>
            Every order the agent built, whether you signed it here or it executed from a tweet.{' '}
            {countLabel}.
          </p>
        </div>
        <EscButton onClose={onClose} />
      </div>

      <div style={listStack}>
        {txRows.map((t, i) => (
          <HoverDiv
            key={`${t.hash}-${i}`}
            style={{
              background: C.panel,
              padding: '16px 28px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: '20px',
              flexWrap: 'wrap',
            }}
            hover={{ background: C.raised }}
          >
            <div style={{ minWidth: '240px', flex: 1 }}>
              <div
                style={{ display: 'flex', alignItems: 'baseline', gap: '12px', flexWrap: 'wrap' }}
              >
                <span style={{ fontSize: '15.5px', color: C.ink }}>{t.title}</span>
                <span
                  style={label(8.5, t.status === 'DISCARDED' ? C.errorInk : C.accent, '0.2em')}
                >
                  {t.status}
                </span>
              </div>
              <div style={{ ...label(9, C.ink3, '0.16em'), marginTop: '7px' }}>
                {t.venue} · {t.via}
              </div>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '24px', flexWrap: 'wrap' }}>
              <span style={mono(12.5, C.ink)}>{t.amount}</span>
              <span style={{ ...mono(10.5, C.ink2), width: '92px', textAlign: 'right' }}>
                {t.hash}
              </span>
              <span style={{ ...label(9, C.ink3, '0.16em'), width: '78px', textAlign: 'right' }}>
                {t.when}
              </span>
            </div>
          </HoverDiv>
        ))}
      </div>
    </Shell>
  );
}

/* -------------------------------------------------------------- portfolio */

/** A token row in the portfolio: pre-formatted for display, `bar` is a width %. */
export interface TokenHolding {
  sym: string;
  amount: string;
  usd: string;
  pct: string;
  bar: string;
}

export interface PortfolioModalProps {
  onClose: () => void;
  address: string;
  /** total token value, already formatted, e.g. "$221,987" */
  total: string;
  holdings: TokenHolding[];
  /** editions held — `Holding` in types.ts */
  nfts: Holding[];
}

export function PortfolioModal({ onClose, address, total, holdings, nfts }: PortfolioModalProps) {
  const basis = nfts.reduce((n, o) => n + o.cost, 0).toFixed(4);

  return (
    <Shell onClose={onClose} maxWidth={880} zIndex={42}>
      <div style={headerRow}>
        <div>
          {/* the prices behind these numbers are indicative, and the design says so twice */}
          <div style={eyebrow}>PORTFOLIO · {address} · SAMPLE FEED</div>
          <h2 style={{ ...h2, fontSize: '34px' }}>{total}</h2>
          <p style={{ ...label(9.5, C.ink2, '0.18em'), margin: '9px 0 0' }}>
            TOKEN VALUE · INDICATIVE PRICES
          </p>
        </div>
        <EscButton onClose={onClose} />
      </div>

      <div style={{ padding: '22px 28px', borderBottom: `1px solid ${C.line}` }}>
        <div style={sectionLabel}>TOKENS</div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
          {holdings.map((h) => (
            <div key={h.sym}>
              <div
                style={{
                  display: 'flex',
                  alignItems: 'baseline',
                  justifyContent: 'space-between',
                  gap: '16px',
                  marginBottom: '8px',
                }}
              >
                <span style={{ ...mono(12, C.ink), letterSpacing: '0.14em' }}>{h.sym}</span>
                <span style={{ display: 'flex', alignItems: 'baseline', gap: '16px' }}>
                  <span style={mono(12, C.ink2)}>{h.amount}</span>
                  <span style={mono(12.5, C.ink)}>{h.usd}</span>
                  <span
                    style={{
                      ...label(9.5, C.accent, '0.14em'),
                      width: '38px',
                      textAlign: 'right',
                    }}
                  >
                    {h.pct}
                  </span>
                </span>
              </div>
              <div style={{ height: '2px', background: C.track }}>
                <div style={{ height: '2px', background: C.accent, width: h.bar }} />
              </div>
            </div>
          ))}
        </div>
      </div>

      <div style={{ padding: '22px 28px' }}>
        <div
          style={{
            display: 'flex',
            alignItems: 'baseline',
            justifyContent: 'space-between',
            gap: '14px',
            marginBottom: '16px',
            flexWrap: 'wrap',
          }}
        >
          <span style={label(9, C.ink3, '0.22em')}>EDITIONS HELD · {nfts.length}</span>
          <span style={label(9.5, C.ink2, '0.16em')}>COST BASIS {basis} ETH</span>
        </div>
        <div style={listStack}>
          {nfts.map((n, i) => (
            <div
              key={`${n.name}-${i}`}
              style={{
                background: C.panel,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                gap: '18px',
                padding: '14px 0',
                flexWrap: 'wrap',
              }}
            >
              <div>
                <div style={{ fontSize: '15px', color: C.ink }}>{n.name}</div>
                <div style={{ ...label(9, C.ink3, '0.16em'), marginTop: '6px' }}>
                  {n.venue} · {n.chain} · {n.when}
                </div>
              </div>
              <div style={mono(12, C.ink)}>{n.cost.toFixed(4)} ETH</div>
            </div>
          ))}
        </div>
      </div>
    </Shell>
  );
}

/* -------------------------------------------------------------------- bot */

export interface BotModalProps {
  onClose: () => void;
  /** whether @SAGEART acts on mentions at all — the master switch */
  enabled: boolean;
  onToggleEnabled: () => void;
  links: BotLink[];
  onCycleScopes: (handle: string) => void;
  onRevoke: (handle: string) => void;
  linkDraft: string;
  onLinkDraftChange: (value: string) => void;
  onLinkAccount: () => void;
  mentionDraft: string;
  onMentionDraftChange: (value: string) => void;
  onRunMention: () => void;
  sampleMentions: string[];
  onRunSample: (text: string) => void;
}

export function BotModal({
  onClose,
  enabled,
  onToggleEnabled,
  links,
  onCycleScopes,
  onRevoke,
  linkDraft,
  onLinkDraftChange,
  onLinkAccount,
  mentionDraft,
  onMentionDraftChange,
  onRunMention,
  sampleMentions,
  onRunSample,
}: BotModalProps) {
  return (
    <Shell onClose={onClose} maxWidth={880} zIndex={41}>
      <div style={headerRow}>
        <div>
          <div style={eyebrow}>SOCIAL AGENT · @SAGEART · {enabled ? 'LIVE ON X' : 'PAUSED'}</div>
          <h2 style={h2}>Act on a tweet</h2>
          <p style={{ ...blurb, maxWidth: '480px' }}>
            Linked handles can spend from their wallet by mentioning the bot. Every mention runs the
            same tools as this console, inside the limits set below.
          </p>
        </div>
        <div style={{ display: 'flex', gap: '8px', flex: 'none' }}>
          <HoverButton
            onClick={onToggleEnabled}
            style={{
              ...btnGhost,
              fontSize: '10px',
              letterSpacing: '0.18em',
              border: `1px solid ${C.lineStrong}`,
              color: C.ink,
              padding: '8px 12px',
            }}
            hover={{ background: C.accent, color: btnPrimary.color, border: `1px solid ${C.accent}` }}
          >
            {enabled ? 'pause bot' : 'resume bot'}
          </HoverButton>
          <EscButton onClose={onClose} />
        </div>
      </div>

      <div style={{ padding: '22px 28px', borderBottom: `1px solid ${C.line}` }}>
        <div style={{ ...sectionLabel, marginBottom: '14px' }}>LINKED ACCOUNTS · WALLET AUTHORITY</div>
        <div style={listStack}>
          {links.map((l) => (
            <div
              key={l.handle}
              style={{
                background: C.panel,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                gap: '18px',
                padding: '14px 0',
                flexWrap: 'wrap',
              }}
            >
              <div style={{ minWidth: '190px' }}>
                <div style={mono(13, C.ink)}>{l.handle}</div>
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '10px',
                    marginTop: '7px',
                  }}
                >
                  <span style={label(9.5, C.ink3, '0.14em')}>{l.wallet}</span>
                  <HoverButton
                    onClick={() => onCycleScopes(l.handle)}
                    style={{
                      ...label(8.5, C.accent, '0.18em'),
                      background: 'transparent',
                      border: `1px solid ${C.lineStrong}`,
                      padding: '4px 8px',
                      cursor: 'pointer',
                    }}
                    hover={{ border: `1px solid ${C.accent}`, background: C.raised }}
                  >
                    {l.scopes}
                  </HoverButton>
                </div>
              </div>
              {/* CAP and SPENT are the spend guard: an X mention can only move funds
                  up to the per-tweet ceiling, and only until the daily one is used up.
                  They stay on the row so revoking is never a guess. */}
              <div style={{ display: 'flex', alignItems: 'center', gap: '22px', flexWrap: 'wrap' }}>
                <div>
                  <div style={{ ...label(8.5, C.ink3, '0.2em'), marginBottom: '5px' }}>CAP</div>
                  <div style={mono(11.5, C.ink)}>{l.perTweet.toFixed(2)} ETH / TWEET</div>
                </div>
                <div>
                  <div style={{ ...label(8.5, C.ink3, '0.2em'), marginBottom: '5px' }}>SPENT</div>
                  <div style={mono(11.5, C.ink)}>
                    {l.spent.toFixed(2)} / {l.daily.toFixed(2)} ETH TODAY
                  </div>
                </div>
                <HoverButton
                  onClick={() => onRevoke(l.handle)}
                  style={{
                    ...btnGhost,
                    fontSize: '9.5px',
                    letterSpacing: '0.18em',
                    border: `1px solid ${C.lineStrong}`,
                    padding: '8px 12px',
                  }}
                  hover={{ color: C.errorInk, border: `1px solid ${C.errorBorder}` }}
                >
                  revoke
                </HoverButton>
              </div>
            </div>
          ))}
        </div>

        <div style={{ display: 'flex', gap: '10px', marginTop: '16px', flexWrap: 'wrap' }}>
          <input
            value={linkDraft}
            onChange={(e) => onLinkDraftChange(e.target.value)}
            placeholder="@handle to link to this wallet"
            style={{ ...inputStyle, minWidth: '220px', ...mono(12, C.ink) }}
          />
          <HoverButton
            onClick={onLinkAccount}
            style={{
              ...btnGhost,
              color: C.ink,
              border: `1px solid ${C.ink}`,
              padding: '12px 20px',
              fontWeight: 700,
            }}
            hover={{ background: C.ink, color: C.panel }}
          >
            link account
          </HoverButton>
        </div>
      </div>

      <div style={{ padding: '22px 28px' }}>
        <div style={{ ...sectionLabel, marginBottom: '14px' }}>SIMULATE AN INCOMING MENTION</div>
        <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap', marginBottom: '14px' }}>
          <input
            value={mentionDraft}
            onChange={(e) => onMentionDraftChange(e.target.value)}
            placeholder="@SAGEART $8 of $rhagent on Robinhood using usdg"
            style={{ ...inputStyle, minWidth: '240px', fontFamily: F.sans, fontSize: '14px' }}
          />
          <HoverButton
            onClick={onRunMention}
            style={{ ...btnPrimary, padding: '12px 24px' }}
            hover={{ background: C.ink }}
          >
            run mention
          </HoverButton>
        </div>
        <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
          {sampleMentions.map((s) => (
            <HoverButton
              key={s}
              onClick={() => onRunSample(s)}
              style={{
                ...mono(10.5, C.ink2),
                background: 'transparent',
                border: `1px solid ${C.line}`,
                padding: '9px 13px',
                cursor: 'pointer',
              }}
              hover={{ border: `1px solid ${C.accent}`, color: C.ink }}
            >
              {s}
            </HoverButton>
          ))}
        </div>
      </div>
    </Shell>
  );
}

/* -------------------------------------------------------------------- buy */

export interface PayOption {
  id: string;
  label: string;
}

export interface BuyModalProps {
  onClose: () => void;
  payOptions: PayOption[];
  selectedPayId: string;
  onSelectPay: (id: string) => void;
  tiers: Tier[];
  selectedTierId: string;
  onSelectTier: (id: string) => void;
  /** copy varies with wallet state: "confirm purchase" vs "connect wallet to buy" */
  buyCta: string;
  buyFootnote: string;
  onConfirm: () => void;
}

export function BuyModal({
  onClose,
  payOptions,
  selectedPayId,
  onSelectPay,
  tiers,
  selectedTierId,
  onSelectTier,
  buyCta,
  buyFootnote,
  onConfirm,
}: BuyModalProps) {
  return (
    <Shell onClose={onClose} maxWidth={860} zIndex={40}>
      <div style={headerRow}>
        <div>
          <div style={eyebrow}>METERED INFERENCE</div>
          <h2 style={h2}>Buy compute credits</h2>
          <p style={{ ...blurb, maxWidth: '470px' }}>
            Credits are spent by the token: 1 CR ≈ 1,000 tokens of context and reasoning, output
            weighted 5×. Long threads and tool-heavy trades cost more. Pay in SAGE for a 15%
            discount.
          </p>
        </div>
        <EscButton onClose={onClose} />
      </div>

      <div style={{ display: 'flex', gap: '1px', background: C.line, borderBottom: `1px solid ${C.line}` }}>
        {payOptions.map((p) => {
          const on = p.id === selectedPayId;
          return (
            <button
              key={p.id}
              type="button"
              onClick={() => onSelectPay(p.id)}
              style={{
                flex: 1,
                background: on ? C.accent : C.panel,
                color: on ? btnPrimary.color : C.ink2,
                border: 'none',
                padding: '14px',
                cursor: 'pointer',
                fontFamily: F.mono,
                fontSize: '10.5px',
                letterSpacing: '0.2em',
                textTransform: 'uppercase',
                fontWeight: 700,
              }}
            >
              {p.label}
            </button>
          );
        })}
      </div>

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(228px, 1fr))',
          gap: '1px',
          background: C.line,
        }}
      >
        {tiers.map((t) => {
          const on = t.id === selectedTierId;
          return (
            <HoverButton
              key={t.id}
              onClick={() => onSelectTier(t.id)}
              style={{
                background: on ? C.raised : C.panel,
                padding: '24px 22px',
                cursor: 'pointer',
                display: 'flex',
                flexDirection: 'column',
                gap: '18px',
                textAlign: 'left',
                border: 'none',
                borderTop: `2px solid ${on ? C.accent : 'transparent'}`,
                color: C.ink,
                fontFamily: F.sans,
              }}
              hover={{ background: C.raised }}
            >
              <div>
                <div
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    gap: '10px',
                    marginBottom: '16px',
                  }}
                >
                  <span style={label(9.5, C.ink2, '0.22em')}>{t.title}</span>
                  <span style={label(8.5, C.accent, '0.16em')}>{t.bonus}</span>
                </div>
                <div
                  style={{ ...mono(27, C.ink), fontWeight: 700, letterSpacing: '-0.01em' }}
                >
                  {t.credits.toLocaleString('en-US')}
                </div>
                <div style={{ ...label(10, C.ink3, '0.2em'), marginTop: '6px' }}>CREDITS</div>
              </div>
              <div>
                <div style={mono(15, C.ink)}>{t.cost}</div>
                <div
                  style={{
                    fontSize: '13px',
                    color: C.ink2,
                    marginTop: '8px',
                    lineHeight: 1.5,
                  }}
                >
                  {t.note}
                </div>
              </div>
            </HoverButton>
          );
        })}
      </div>

      <div
        style={{
          padding: '22px 28px',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: '20px',
          flexWrap: 'wrap',
        }}
      >
        <div
          style={{
            ...label(9.5, C.ink3, '0.16em'),
            maxWidth: '380px',
            lineHeight: 1.7,
          }}
        >
          {buyFootnote}
        </div>
        <HoverButton
          onClick={onConfirm}
          style={{ ...btnPrimary, fontSize: '11px', padding: '15px 30px' }}
          hover={{ background: C.ink }}
        >
          {buyCta}
        </HoverButton>
      </div>
    </Shell>
  );
}
