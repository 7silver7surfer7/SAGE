/**
 * SAGE Agent — the main column's header row.
 *
 * Ported from "SAGE Agent.dc.html" (lines 124–191). Left cluster identifies the
 * agent and advertises its tool surface; right cluster carries the controls that
 * cost the user something: which model runs the turn, how many compute credits
 * are left, and which wallet is on the hook for on-chain actions.
 */
import React, { useState } from 'react';

import { C, F, label, mono } from './tokens';
import type { ModelOption } from './types';

export interface Props {
  railCollapsed: boolean;
  onToggleRail: () => void;
  showBadge: boolean;
  toolCount: number;
  botStatus: string;
  onOpenBot: () => void;
  models: ModelOption[];
  modelId: string;
  modelOpen: boolean;
  onToggleModel: () => void;
  onSelectModel: (id: string) => void;
  creditsLabel: string;
  onOpenBuy: () => void;
  connected: boolean;
  address: string;
  onConnect: () => void;
  gutter: string;
}

/**
 * The design expresses hover with a `style-hover` attribute, which React has no
 * equivalent for. One key per hoverable control beats a boolean per control.
 */
type HoverKey = string | null;

export default function AgentHeader({
  railCollapsed,
  onToggleRail,
  showBadge,
  toolCount,
  botStatus,
  onOpenBot,
  models,
  modelId,
  modelOpen,
  onToggleModel,
  onSelectModel,
  creditsLabel,
  onOpenBuy,
  connected,
  address,
  onConnect,
  gutter,
}: Props) {
  const [hover, setHover] = useState<HoverKey>(null);

  const model = models.find((m) => m.id === modelId);

  // Shared chrome for the two pill buttons (𝕏 status, model picker).
  const pill: React.CSSProperties = {
    display: 'flex',
    alignItems: 'center',
    background: C.raised,
    color: C.ink,
    padding: '9px 12px',
    cursor: 'pointer',
    fontFamily: F.mono,
    fontSize: '10px',
    letterSpacing: '0.16em',
    whiteSpace: 'nowrap',
  };

  return (
    <header
      style={{
        flex: 'none',
        minHeight: '66px',
        padding: gutter,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: '10px',
        borderBottom: `1px solid ${C.line}`,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: '14px', minWidth: 0 }}>
        {/* Only offered when the rail is hidden — otherwise the rail owns its own collapse control. */}
        {railCollapsed && (
          <button
            type="button"
            onClick={onToggleRail}
            title="Expand panel"
            onMouseEnter={() => setHover('rail')}
            onMouseLeave={() => setHover(null)}
            style={{
              flex: 'none',
              background: 'transparent',
              border: 'none',
              padding: '4px',
              cursor: 'pointer',
              color: hover === 'rail' ? C.ink : C.ink2,
              display: 'flex',
            }}
          >
            <svg width="18" height="18" viewBox="0 0 18 18" fill="none" xmlns="http://www.w3.org/2000/svg">
              <rect x="1.75" y="2.75" width="14.5" height="12.5" rx="2.25" stroke="currentColor" strokeWidth="1.4" />
              <path d="M6.75 3.2V14.8" stroke="currentColor" strokeWidth="1.4" />
            </svg>
          </button>
        )}

        {/* Keyframes live in styles/pages/_agent.scss — the pulse reads as "agent is live". */}
        <div
          style={{
            width: '6px',
            height: '6px',
            flex: 'none',
            background: C.accent,
            borderRadius: '50%',
            animation: 'sagePulse 2.4s ease-in-out infinite',
          }}
        />

        <svg
          width="19"
          height="21"
          viewBox="0 0 52 58"
          fill="none"
          xmlns="http://www.w3.org/2000/svg"
          style={{ display: 'block', flex: 'none', color: C.ink }}
        >
          <path
            d="M25.8835 4.72705C40.0858 4.72705 51.5991 16.4722 51.5991 30.9606C51.5991 45.449 40.0858 57.1942 25.8835 57.1942C11.6812 57.1942 0.167969 45.449 0.167969 30.9606C0.167969 16.4722 11.6812 4.72705 25.8835 4.72705ZM25.8835 9.09931C14.0483 9.09931 4.4539 18.887 4.4539 30.9606C4.4539 43.0343 14.0483 52.8219 25.8835 52.8219C37.7188 52.8219 47.3132 43.0343 47.3132 30.9606C47.3132 18.887 37.7188 9.09931 25.8835 9.09931Z"
            fill="currentColor"
          />
          <path
            d="M51.6522 46.2636L25.8883 0.333496L0 46.2636H51.6522ZM25.8793 9.12069L44.2616 41.8913H7.40828L25.8793 9.12069Z"
            fill="currentColor"
          />
        </svg>

        <div
          style={{
            ...label(11, C.ink, '0.24em'),
            textTransform: 'uppercase',
            whiteSpace: 'nowrap',
            flex: '0 1 auto',
            minWidth: 0,
            overflow: 'hidden',
            textOverflow: 'ellipsis',
          }}
        >
          SAGE AGENT
        </div>

        {showBadge && (
          <div
            style={{
              ...label(9.5, C.ink3, '0.18em'),
              border: `1px solid ${C.line}`,
              padding: '4px 8px',
              whiteSpace: 'nowrap',
              flex: '0 1 auto',
              minWidth: 0,
              overflow: 'hidden',
              textOverflow: 'ellipsis',
            }}
          >
            MCP · {toolCount} TOOLS · SAGE + ALL OF OPENSEA
          </div>
        )}
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
        {/* The social agent lives in the rail; surface it here when the rail is collapsed. */}
        {railCollapsed && (
          <button
            type="button"
            onClick={onOpenBot}
            onMouseEnter={() => setHover('bot')}
            onMouseLeave={() => setHover(null)}
            style={{
              ...pill,
              gap: '8px',
              border: `1px solid ${hover === 'bot' ? C.accent : C.line}`,
            }}
          >
            <span style={{ color: C.accent }}>𝕏</span>
            <span>{botStatus}</span>
          </button>
        )}

        <div style={{ position: 'relative' }}>
          <button
            type="button"
            onClick={onToggleModel}
            onMouseEnter={() => setHover('model')}
            onMouseLeave={() => setHover(null)}
            style={{
              ...pill,
              gap: '10px',
              border: `1px solid ${hover === 'model' ? C.accent : C.line}`,
            }}
          >
            <span style={label(8.5, C.ink3)}>MODEL</span>
            <span style={{ fontWeight: 700 }}>{model ? model.label : '—'}</span>
            {/* The rate is the credit multiplier per turn — the price tag on the choice. */}
            <span style={{ fontSize: '8.5px', color: C.accent }}>{model ? `${model.rate}×` : ''}</span>
            <span style={{ fontSize: '8px', color: C.ink2 }}>▼</span>
          </button>

          {modelOpen && (
            <div
              style={{
                position: 'absolute',
                top: 'calc(100% + 6px)',
                right: 0,
                zIndex: 30,
                width: '246px',
                background: C.panel,
                border: `1px solid ${C.lineStrong}`,
                display: 'flex',
                flexDirection: 'column',
                gap: '1px',
              }}
            >
              {models.map((m) => {
                const selected = m.id === modelId;
                const hovered = hover === `m:${m.id}`;
                return (
                  <button
                    key={m.id}
                    type="button"
                    onClick={() => onSelectModel(m.id)}
                    onMouseEnter={() => setHover(`m:${m.id}`)}
                    onMouseLeave={() => setHover(null)}
                    style={{
                      textAlign: 'left',
                      background: hovered || selected ? C.raisedHover : 'transparent',
                      color: selected ? C.ink : C.ink2,
                      border: 'none',
                      borderBottom: `1px solid ${C.line}`,
                      padding: '13px 15px',
                      cursor: 'pointer',
                      display: 'flex',
                      flexDirection: 'column',
                      gap: '6px',
                    }}
                  >
                    <span
                      style={{
                        display: 'flex',
                        alignItems: 'baseline',
                        justifyContent: 'space-between',
                        gap: '12px',
                        width: '100%',
                      }}
                    >
                      <span style={{ ...mono(11.5, 'inherit'), letterSpacing: '0.14em', fontWeight: 700 }}>
                        {m.label}
                      </span>
                      <span style={label(9, C.accent, '0.12em')}>{m.rate}×</span>
                    </span>
                    <span style={label(8.5, C.ink3, '0.18em')}>{m.note}</span>
                  </button>
                );
              })}
            </div>
          )}
        </div>

        <div style={{ display: 'flex', alignItems: 'stretch', border: `1px solid ${C.line}`, background: C.raised }}>
          <div
            style={{
              padding: '7px 13px',
              display: 'flex',
              flexDirection: 'column',
              gap: '3px',
              borderRight: `1px solid ${C.line}`,
            }}
          >
            <span style={label(8.5, C.ink3)}>COMPUTE CREDITS</span>
            <span style={{ ...mono(12, C.accent), letterSpacing: '0.08em' }}>{creditsLabel}</span>
          </div>
          <button
            type="button"
            onClick={onOpenBuy}
            onMouseEnter={() => setHover('buy')}
            onMouseLeave={() => setHover(null)}
            style={{
              ...label(10, hover === 'buy' ? C.panel : C.ink, '0.18em'),
              textTransform: 'uppercase',
              background: hover === 'buy' ? C.accent : 'transparent',
              border: 'none',
              padding: '0 15px',
              cursor: 'pointer',
              fontWeight: 700,
            }}
          >
            buy
          </button>
        </div>

        {connected ? (
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '9px',
              border: `1px solid ${C.line}`,
              background: C.raised,
              padding: '8px 12px',
            }}
          >
            <div style={{ width: '5px', height: '5px', background: C.accent, borderRadius: '50%' }} />
            <span style={{ ...mono(10.5, C.ink), letterSpacing: '0.14em' }}>{address}</span>
          </div>
        ) : (
          <button
            type="button"
            onClick={onConnect}
            onMouseEnter={() => setHover('connect')}
            onMouseLeave={() => setHover(null)}
            style={{
              ...label(10.5, hover === 'connect' ? C.panel : C.ink),
              textTransform: 'uppercase',
              background: hover === 'connect' ? C.ink : 'transparent',
              border: `1px solid ${C.ink}`,
              padding: '9px 16px',
              cursor: 'pointer',
              whiteSpace: 'nowrap',
              flex: 'none',
            }}
          >
            connect
          </button>
        )}
      </div>
    </header>
  );
}
