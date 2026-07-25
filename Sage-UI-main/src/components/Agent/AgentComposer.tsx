import React, { useEffect, useRef, useState } from 'react';
import { C, F, label, btnPrimary } from './tokens';

/** Ceiling on the auto-grown textarea, in px — past this it scrolls instead. */
const MAX_TEXTAREA_HEIGHT = 148;

export interface Props {
  input: string;
  onInput: (v: string) => void;
  onSend: () => void;
  busy: boolean;
  sendLabel: string;
  footerLeft: string;
  /** the shell varies composer padding by breakpoint, so it arrives as a prop */
  composerPad: string;
}

/**
 * The bottom composer. The agent can spend real funds, so the send button is
 * the only way to hand it a turn: it is disabled while a turn is in flight
 * rather than queueing input the user can no longer see the cost of.
 */
export default function AgentComposer({
  input,
  onInput,
  onSend,
  busy,
  sendLabel,
  footerLeft,
  composerPad,
}: Props) {
  const taRef = useRef<HTMLTextAreaElement>(null);
  const [sendHover, setSendHover] = useState(false);

  // Auto-grow. Keyed on `input` rather than done in onChange so the box also
  // collapses when the parent clears the value after a successful send.
  useEffect(() => {
    const ta = taRef.current;
    if (!ta) return;
    ta.style.height = 'auto';
    ta.style.height = `${Math.min(ta.scrollHeight, MAX_TEXTAREA_HEIGHT)}px`;
  }, [input]);

  function onKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      if (!busy) onSend();
    }
  }

  const footerLabel = label(9, C.ink3, '0.18em');

  return (
    <div
      style={{
        flex: 'none',
        borderTop: `1px solid ${C.line}`,
        background: C.bg,
        padding: composerPad,
      }}
    >
      <div style={{ maxWidth: '780px', margin: '0 auto' }}>
        <div
          style={{
            border: `1px solid ${C.lineStrong}`,
            background: C.panel,
            display: 'flex',
            alignItems: 'flex-end',
            gap: '12px',
            padding: '14px 14px 14px 18px',
          }}
        >
          <textarea
            ref={taRef}
            value={input}
            onChange={(e) => onInput(e.target.value)}
            onKeyDown={onKeyDown}
            rows={1}
            placeholder="Ask the agent — or tell it to mint"
            style={{
              flex: 1,
              background: 'transparent',
              border: 'none',
              outline: 'none',
              resize: 'none',
              color: C.ink,
              // textareas don't inherit the page font, so it is set explicitly
              fontFamily: F.sans,
              fontSize: '15.5px',
              lineHeight: 1.5,
              minHeight: '26px',
              maxHeight: `${MAX_TEXTAREA_HEIGHT}px`,
              padding: 0,
            }}
          />
          <button
            type="button"
            onClick={onSend}
            disabled={busy}
            onMouseEnter={() => setSendHover(true)}
            onMouseLeave={() => setSendHover(false)}
            style={{
              ...btnPrimary,
              background: sendHover && !busy ? C.ink : btnPrimary.background,
              cursor: busy ? 'default' : 'pointer',
            }}
          >
            {sendLabel}
          </button>
        </div>
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            gap: '16px',
            marginTop: '11px',
            flexWrap: 'wrap',
          }}
        >
          <div style={footerLabel}>{footerLeft}</div>
          <div style={footerLabel}>SAGE™ — ACCELERATING WEB3</div>
        </div>
      </div>
    </div>
  );
}
