import { useEffect, useState } from 'react';
import Modal, { Props as ModalProps } from '@/components/Modals';
import { useGetDropAllowlistQuery, useUpdateDropAllowlistMutation } from '@/store/dropsReducer';
import { parseAddressList, ALLOWLIST_MAX_ADDRESSES } from '@/utilities/allowlist';
import { useSigner } from 'wagmi';
import { Signer } from 'ethers';
import { toast } from 'react-toastify';
import LoaderSpinner from '../LoaderSpinner';
import AllowlistEditor from './AllowlistEditor';

interface AllowlistModalProps extends ModalProps {
  dropId: number;
  dropName: string;
  /** deployed drops sync on-chain at save time (wallet prompts) */
  deployed: boolean;
}

/**
 * Edit a drop's allowlist — drafts save DB-only; deployed drops also push new
 * addresses to the drop's on-chain SageWhitelist in the same save (deploying
 * the contract + wiring the games first if the drop wasn't gated before).
 */
export function AllowlistModal({ isOpen, closeModal, dropId, dropName, deployed }: AllowlistModalProps) {
  const { data: signer } = useSigner();
  const { data: allowlist, isFetching } = useGetDropAllowlistQuery(dropId, { skip: !isOpen });
  const [updateAllowlist, { isLoading: isSaving }] = useUpdateDropAllowlistMutation();
  const [enabled, setEnabled] = useState(false);
  const [text, setText] = useState('');
  const [hydrated, setHydrated] = useState(false);

  // hydrate editor state from the saved list each time the modal opens
  useEffect(() => {
    if (!isOpen) {
      setHydrated(false);
      return;
    }
    if (allowlist && !hydrated) {
      setEnabled(allowlist.enabled);
      setText(allowlist.entries.map((e) => e.address).join('\n'));
      setHydrated(true);
    }
  }, [isOpen, allowlist, hydrated]);

  const pendingSyncCount = allowlist?.entries.filter((e) => !e.syncedAt).length ?? 0;

  async function handleSave() {
    const parsed = parseAddressList(text);
    if (parsed.invalid.length > 0) {
      toast.warn('Fix or remove the invalid addresses before saving.');
      return;
    }
    if (parsed.valid.length > ALLOWLIST_MAX_ADDRESSES) {
      toast.warn(`The allowlist is capped at ${ALLOWLIST_MAX_ADDRESSES} addresses.`);
      return;
    }
    if (enabled && parsed.valid.length === 0) {
      toast.warn('Add at least one address, or turn gating off.');
      return;
    }
    if (deployed && !signer) {
      toast.info('Sign In With Ethereum before continuing — saving syncs on-chain.');
      return;
    }
    const result = await updateAllowlist({
      dropId,
      addresses: parsed.valid,
      enabled,
      signer: deployed ? (signer as Signer) : undefined,
    });
    if ('data' in result) closeModal();
  }

  return (
    <Modal title={`Allowlist — ${dropName}`} isOpen={isOpen} closeModal={closeModal}>
      <div style={{ padding: '25px', minWidth: 'min(560px, 90vw)' }}>
        {isFetching && !hydrated ? (
          <LoaderSpinner />
        ) : (
          <>
            <AllowlistEditor
              enabled={enabled}
              text={text}
              onEnabledChange={setEnabled}
              onTextChange={setText}
              pendingSyncCount={pendingSyncCount}
              deployed={deployed}
              disabled={isSaving}
            />
            {deployed && allowlist?.enabled && (
              <em className='create-drop-panel__section-hint'>
                Removing an address here stops it from bidding in auctions right away; open
                edition / drawing access is removed on-chain in a later update.
              </em>
            )}
            <button
              type='button'
              className='dashboard__submit-button'
              style={{ width: '100%', display: 'inline-block', height: '50px', marginTop: '14px' }}
              disabled={isSaving}
              onClick={handleSave}
            >
              {isSaving ? <LoaderSpinner /> : deployed ? 'save & sync on-chain' : 'save allowlist'}
            </button>
          </>
        )}
      </div>
    </Modal>
  );
}
