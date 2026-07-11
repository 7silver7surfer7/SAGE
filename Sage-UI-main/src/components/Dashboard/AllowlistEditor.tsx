import { useMemo, useRef } from 'react';
import { parseAddressList, ALLOWLIST_MAX_ADDRESSES } from '@/utilities/allowlist';

export interface AllowlistEditorProps {
  enabled: boolean;
  /** raw textarea content — parent owns the state so create + edit both work */
  text: string;
  onEnabledChange: (enabled: boolean) => void;
  onTextChange: (text: string) => void;
  /** addresses already saved but not yet pushed on-chain (deployed drops) */
  pendingSyncCount?: number;
  /** deployed drops get the on-chain warnings; drafts stay DB-only */
  deployed?: boolean;
  disabled?: boolean;
}

/**
 * Reusable allowlist editor: enable toggle, one-address-per-line textarea,
 * CSV/TXT import (parsed client-side, appended), and live valid/invalid/dup
 * counts. Used inline in CreateDropPanel (drafts) and inside AllowlistModal
 * (drafts + deployed drops).
 */
export default function AllowlistEditor({
  enabled,
  text,
  onEnabledChange,
  onTextChange,
  pendingSyncCount = 0,
  deployed = false,
  disabled = false,
}: AllowlistEditorProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const parsed = useMemo(() => parseAddressList(text), [text]);

  function handleImportFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      const imported = String(reader.result || '');
      // append to whatever is already typed; the parser dedupes on save
      onTextChange(text ? `${text.trim()}\n${imported}` : imported);
    };
    reader.readAsText(file);
    e.target.value = '';
  }

  return (
    <div className='create-drop-panel__label' style={{ display: 'block' }}>
      <label className='create-drop-panel__checkbox-label'>
        <input
          type='checkbox'
          checked={enabled}
          disabled={disabled}
          onChange={(e) => onEnabledChange(e.target.checked)}
        />
        allowlist only — gate this drop to specific wallets
      </label>
      {enabled && (
        <>
          <em className='create-drop-panel__section-hint'>
            One wallet address per line (commas work too). Enforced on-chain for open editions
            and drawings; auction bids are gated in the site UI.
            {deployed && ' New addresses are pushed on-chain when you save (wallet prompts).'}
          </em>
          <textarea
            className='create-drop-panel__input create-drop-panel__textarea'
            style={{ minHeight: '120px', fontFamily: 'monospace', fontSize: '12px' }}
            placeholder={'0xabc…\n0xdef…'}
            value={text}
            disabled={disabled}
            onChange={(e) => onTextChange(e.target.value)}
          />
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginTop: '6px' }}>
            <button
              type='button'
              className='create-drop-panel__add-button'
              disabled={disabled}
              onClick={() => fileInputRef.current?.click()}
            >
              + IMPORT CSV/TXT
            </button>
            <input
              ref={fileInputRef}
              type='file'
              accept='.csv,.txt,text/csv,text/plain'
              style={{ display: 'none' }}
              onChange={handleImportFile}
            />
            <em className='create-drop-panel__section-hint' style={{ margin: 0 }}>
              {parsed.valid.length} valid
              {parsed.invalid.length > 0 && ` · ${parsed.invalid.length} invalid`}
              {parsed.duplicates > 0 && ` · ${parsed.duplicates} duplicate${parsed.duplicates === 1 ? '' : 's'}`}
              {deployed && pendingSyncCount > 0 && ` · ${pendingSyncCount} pending on-chain sync`}
            </em>
          </div>
          {parsed.valid.length > ALLOWLIST_MAX_ADDRESSES && (
            <em className='create-drop-panel__section-hint' style={{ color: '#e5484d' }}>
              Too many addresses — the allowlist is capped at {ALLOWLIST_MAX_ADDRESSES}.
            </em>
          )}
          {parsed.invalid.length > 0 && (
            <em className='create-drop-panel__section-hint' style={{ color: '#e5484d' }}>
              Not valid addresses (fix or remove before saving):{' '}
              {parsed.invalid.slice(0, 5).join(', ')}
              {parsed.invalid.length > 5 && ` … and ${parsed.invalid.length - 5} more`}
              {parsed.invalid.some((t) => t.endsWith('.eth')) &&
                ' (ENS names are not supported yet — use the 0x address)'}
            </em>
          )}
        </>
      )}
    </div>
  );
}
