/**
 * SAGE Agent — the scrolling conversation column.
 *
 * Ported from the "SAGE Agent.dc.html" design (the transcript region between
 * the header and the composer). Everything is inline-styled to match the
 * design; colours and fonts come from ./tokens.
 */

import React, { useState } from 'react';
import AgentCard from './AgentCards';
import { C, F, label, mono, surface } from './tokens';
import type { Message, Suggestion } from './types';

export interface Props {
  /** the page owns auto-scroll, so the scroll container is a forwarded ref */
  scrollRef: React.RefObject<HTMLDivElement>;
  gutter: string;
  h1Size: string;
  isEmpty: boolean;
  suggestions: Suggestion[];
  onPick: (text: string) => void;
  msgs: Message[];
  error: string;
  onConnect: () => void;
}

/** The design renders every tool-call step with the same accent arrow. */
const STEP_MARK = '→';

export default function AgentChat({
  scrollRef,
  gutter,
  h1Size,
  isEmpty,
  suggestions,
  onPick,
  msgs,
  error,
  onConnect,
}: Props) {
  // style-hover has no React equivalent; the suggestion tiles are the one place
  // in this column where the hover state is load-bearing (they read as inert
  // otherwise), so they get a single hovered-index instead of per-tile state.
  const [hovered, setHovered] = useState(-1);

  return (
    <div ref={scrollRef} style={{ flex: 1, overflowY: 'auto', padding: gutter }}>
      <div
        style={{
          maxWidth: '780px',
          margin: '0 auto',
          padding: '40px 0 28px',
          display: 'flex',
          flexDirection: 'column',
          gap: 34,
        }}
      >
        {isEmpty && (
          <section style={{ paddingTop: '30px' }}>
            <div style={{ ...label(10, C.ink3, '0.24em'), marginBottom: '26px' }}>
              PORTAL / CURATION LAYER
            </div>
            <h1
              style={{
                fontSize: h1Size,
                lineHeight: 1.04,
                letterSpacing: '-0.02em',
                fontWeight: 500,
                margin: '0 0 18px',
                textWrap: 'pretty',
              }}
            >
              Ask about the drops, the artists, or the chain beneath them.
            </h1>
            <p
              style={{
                fontSize: '15.5px',
                lineHeight: 1.6,
                color: C.ink2,
                margin: '0 0 40px',
                maxWidth: '560px',
                textWrap: 'pretty',
              }}
            >
              I hold the SAGE index — every edition, every artist, every price. I can also act
              on-chain once your wallet is connected.
            </p>
            <div style={{ ...label(9.5, C.ink3, '0.24em'), marginBottom: '14px' }}>START HERE</div>
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fit, minmax(272px, 1fr))',
                gap: '10px',
              }}
            >
              {suggestions.map((s, i) => (
                <button
                  key={s.num}
                  type="button"
                  onClick={() => onPick(s.send ?? s.text)}
                  onMouseEnter={() => setHovered(i)}
                  onMouseLeave={() => setHovered(-1)}
                  style={{
                    textAlign: 'left',
                    background: hovered === i ? C.raised : C.panel,
                    border: `1px solid ${hovered === i ? C.accent : C.line}`,
                    color: C.ink,
                    padding: '17px 18px',
                    cursor: 'pointer',
                    fontFamily: F.sans,
                    fontSize: '14.5px',
                    lineHeight: 1.4,
                    display: 'flex',
                    gap: '12px',
                    alignItems: 'flex-start',
                  }}
                >
                  <span style={{ ...mono(10, C.accent), paddingTop: '3px' }}>{s.num}</span>
                  <span>{s.text}</span>
                </button>
              ))}
            </div>
          </section>
        )}

        {msgs.map((m) => (
          <div key={m.id} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            <div style={label(9.5, C.ink3, '0.24em')}>{m.who}</div>

            {m.isUser && (
              <div
                style={{
                  fontSize: '19px',
                  lineHeight: 1.45,
                  letterSpacing: '-0.01em',
                  color: C.ink,
                  whiteSpace: 'pre-wrap',
                  borderLeft: `1px solid ${C.accent}`,
                  paddingLeft: '18px',
                }}
              >
                {m.text}
              </div>
            )}

            {!!m.steps && m.steps.length > 0 && (
              <div
                style={{
                  ...surface,
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 7,
                  padding: '13px 15px',
                }}
              >
                {m.steps.map((st, i) => (
                  <div
                    key={`${m.id}-step-${i}`}
                    style={{
                      ...label(10.5, C.ink2, '0.14em'),
                      display: 'flex',
                      gap: '10px',
                    }}
                  >
                    <span style={{ color: C.accent }}>{STEP_MARK}</span>
                    <span>{st}</span>
                  </div>
                ))}
              </div>
            )}

            {m.thinking && (
              <div
                style={{
                  ...label(10.5, C.ink2, '0.2em'),
                  // keyframes live in styles/pages/_agent.scss
                  animation: 'sagePulse 1.3s ease-in-out infinite',
                }}
              >
                CONSULTING THE INDEX…
              </div>
            )}

            {!m.isUser && !!m.text && (
              <div
                style={{
                  fontSize: '16px',
                  lineHeight: 1.66,
                  color: C.inkBody,
                  whiteSpace: 'pre-wrap',
                  textWrap: 'pretty',
                }}
              >
                {m.text}
              </div>
            )}

            {(m.cards || []).map((c) => (
              <div key={c.id} style={surface}>
                <AgentCard card={c} onConnect={onConnect} onAsk={onPick} />
              </div>
            ))}

            {!!m.costLabel && (
              <div
                style={{
                  ...label(9, C.ink3, '0.18em'),
                  display: 'flex',
                  gap: '14px',
                  alignItems: 'center',
                }}
              >
                <span>{m.costLabel}</span>
                <span style={{ flex: 1, height: '1px', background: C.line }} />
                <span>{m.balanceLabel}</span>
              </div>
            )}
          </div>
        ))}

        {!!error && (
          <div
            style={{
              border: `1px solid ${C.errorBorder}`,
              background: C.errorBg,
              padding: '14px 16px',
              ...label(11, C.errorInk, '0.1em'),
            }}
          >
            {error}
          </div>
        )}
      </div>
    </div>
  );
}
