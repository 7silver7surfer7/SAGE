/**
 * SAGE Agent — design tokens.
 *
 * Ported from the "SAGE Agent.dc.html" design. That design styles everything
 * inline rather than through classes, so the port keeps inline styles too and
 * funnels every literal through this module: one place to change a colour, and
 * a reviewer can diff these values against the design instead of grepping
 * hex codes across a dozen components.
 *
 * Only genuinely global bits (font imports, keyframes, scrollbar, selection,
 * and hiding the marketing chrome) live in styles/pages/_agent.scss.
 */

export const C = {
  /** page canvas */
  bg: '#0C0C0C',
  /** rail + card surface */
  panel: '#101010',
  /** raised surface: buttons, inputs, hovered rows */
  raised: '#161616',
  /** hovered raised surface (model menu rows) */
  raisedHover: '#1D1D1D',
  /** hairline rules — the design uses this exact alpha everywhere */
  line: 'rgba(255,255,255,0.08)',
  /** stronger hairline: composer, model menu, avatar frames */
  lineStrong: 'rgba(255,255,255,0.14)',
  /** primary text */
  ink: '#ECEAE5',
  /** body copy inside assistant messages (slightly dimmer than ink) */
  inkBody: '#D6D4CE',
  /** secondary text */
  ink2: '#7C7C78',
  /** tertiary text — micro-labels */
  ink3: '#55554F',
  /** sage green accent */
  accent: '#B8D8A8',
  /** scrollbar thumb / meter track */
  track: '#262626',
  /** error card */
  errorBorder: '#6B4A2A',
  errorBg: '#16110C',
  errorInk: '#C9A57A',
} as const;

export const F = {
  sans: "'Space Grotesk', system-ui, sans-serif",
  mono: "'JetBrains Mono', ui-monospace, monospace",
} as const;

/**
 * The design's signature label: tiny uppercase mono with wide tracking. Size
 * and colour vary per placement, so they stay arguments.
 */
export function label(size = 9.5, color: string = C.ink3, tracking = '0.2em'): React.CSSProperties {
  return {
    fontFamily: F.mono,
    fontSize: `${size}px`,
    letterSpacing: tracking,
    color,
  };
}

/** Mono value text (prices, balances, table cells). */
export function mono(size = 12, color: string = C.ink): React.CSSProperties {
  return { fontFamily: F.mono, fontSize: `${size}px`, color };
}

/** Solid accent button — the primary action (send, confirm, top up). */
export const btnPrimary: React.CSSProperties = {
  fontFamily: F.mono,
  fontSize: '10.5px',
  letterSpacing: '0.2em',
  textTransform: 'uppercase',
  background: C.accent,
  color: '#101010',
  border: 'none',
  padding: '11px 20px',
  cursor: 'pointer',
  fontWeight: 700,
  flex: 'none',
};

/** Outlined button — secondary actions (discard, connect). */
export const btnGhost: React.CSSProperties = {
  fontFamily: F.mono,
  fontSize: '10.5px',
  letterSpacing: '0.2em',
  textTransform: 'uppercase',
  background: 'transparent',
  color: C.ink2,
  border: `1px solid ${C.line}`,
  padding: '12px 22px',
  cursor: 'pointer',
};

/** The bordered surface used by every result card and panel block. */
export const surface: React.CSSProperties = {
  border: `1px solid ${C.line}`,
  background: C.panel,
};

/**
 * Hairline-separated stack: children sit on `panel` with 1px of the border
 * colour showing through as the rule. The design builds every key/value table
 * this way (gap:1px over a rgba background) rather than with borders.
 */
export const hairlineStack: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 1,
  background: C.line,
};

/** Modal scrim shared by the history / portfolio / bot / buy overlays. */
export const scrim: React.CSSProperties = {
  position: 'fixed',
  inset: 0,
  background: 'rgba(6,6,6,0.86)',
  zIndex: 43,
  display: 'flex',
  alignItems: 'flex-start',
  justifyContent: 'center',
  padding: '24px',
  overflowY: 'auto',
};
