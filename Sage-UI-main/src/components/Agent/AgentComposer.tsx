import React, { useEffect, useRef, useState } from 'react';
import { C, F, label, btnPrimary, btnGhost } from './tokens';

/** Ceiling on the auto-grown textarea, in px — past this it scrolls instead. */
const MAX_TEXTAREA_HEIGHT = 148;

export interface Props {
  input: string;
  onInput: (v: string) => void;
  onSend: () => void;
  busy: boolean;
  sendLabel: string;
  /** kick off a render without the user having to phrase a prompt */
  onMakeArt: () => void;
  /** e.g. "8 CR" — the selected image model's price, shown on the button */
  artCost: string;
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
  onMakeArt,
  artCost,
  footerLeft,
  composerPad,
}: Props) {
  const taRef = useRef<HTMLTextAreaElement>(null);
  const [sendHover, setSendHover] = useState(false);
  const [artHover, setArtHover] = useState(false);

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
            // WRAPS, because there are two buttons here now. Without this the
            // textarea's flex:1 loses to their intrinsic widths on a narrow
            // screen and the input collapses to about the width of the word
            // "Ask" — which is what adding the second button did on mobile
            // before this line existed.
            flexWrap: 'wrap',
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
              // keeps a usable line rather than being squeezed to nothing;
              // below this the buttons wrap to their own row instead
              minWidth: '180px',
            }}
          />
          {/*
            A render is one click, because "make me something" is the single
            most common thing people want from this and phrasing a prompt is a
            barrier to it. The agent writes the actual prompt — its own
            instructions say to expand a request into a full visual
            description rather than echo it.

            The COST IS ON THE BUTTON. Generating is charged per render, and a
            one-click spend whose price you have to find in the header is the
            kind of thing that feels like a trick the second time it happens.
          */}
          <button
            type="button"
            onClick={onMakeArt}
            disabled={busy}
            onMouseEnter={() => setArtHover(true)}
            onMouseLeave={() => setArtHover(false)}
            title="Generate an original artwork — the agent picks the subject"
            style={{
              ...btnGhost,
              whiteSpace: 'nowrap',
              borderColor: artHover && !busy ? C.accent : btnGhost.borderColor,
              color: artHover && !busy ? C.accent : btnGhost.color,
              cursor: busy ? 'default' : 'pointer',
            }}
          >
            {`make art · ${artCost}`}
          </button>
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
