import { useEffect, useState, useCallback } from 'react';
import { toast } from 'react-toastify';
import { useProvider } from 'wagmi';
import useSAGEAccount from '@/hooks/useSAGEAccount';
import { humanWalletError } from '@/utilities/walletError';
import { useRequestFaucetVoucherMutation } from '@/store/socialReducer';
import {
  FAUCET_ENABLED,
  FaucetStatus,
  getFaucetStatus,
  claimFaucet,
  isFaucetOwner,
  setFaucetActive,
  setFaucetDripAmount,
  setFaucetVoucherSigner,
  drainFaucet,
} from '@/utilities/faucet';

/** Admin-only controls — only rendered once the connected wallet is confirmed as the contract owner. */
function AdminControls({ onChanged }: { onChanged: () => void }) {
  const { signer, walletAddress } = useSAGEAccount();
  const [dripInput, setDripInput] = useState('');
  const [signerInput, setSignerInput] = useState('');
  const [drainTo, setDrainTo] = useState(walletAddress || '');
  const [drainAmount, setDrainAmount] = useState('0');
  const [busy, setBusy] = useState<'' | 'pause' | 'resume' | 'drip' | 'signer' | 'drain'>('');

  const run = async (kind: typeof busy, fn: () => Promise<string>, okMsg: string) => {
    if (!signer) return;
    setBusy(kind);
    try {
      await fn();
      toast.success(okMsg);
      onChanged();
    } catch (err: any) {
      toast.error(humanWalletError(err));
    } finally {
      setBusy('');
    }
  };

  return (
    <div className='social-faucet__admin'>
      <h4>Admin controls</h4>
      <div className='social-faucet__admin-row'>
        <button
          disabled={busy === 'pause'}
          onClick={() => run('pause', () => setFaucetActive(false, signer!), 'Faucet paused')}
        >
          {busy === 'pause' ? 'Pausing…' : 'Pause faucet'}
        </button>
        <button
          disabled={busy === 'resume'}
          onClick={() => run('resume', () => setFaucetActive(true, signer!), 'Faucet resumed')}
        >
          {busy === 'resume' ? 'Resuming…' : 'Resume faucet'}
        </button>
      </div>
      <div className='social-faucet__admin-row'>
        <input
          placeholder='New drip amount (SAGE)'
          value={dripInput}
          onChange={(e) => setDripInput(e.target.value)}
        />
        <button
          disabled={busy === 'drip' || !dripInput}
          onClick={() =>
            run(
              'drip',
              () => setFaucetDripAmount(Number(dripInput), signer!),
              `Drip amount set to ${dripInput} SAGE`
            )
          }
        >
          {busy === 'drip' ? 'Saving…' : 'Set drip'}
        </button>
      </div>
      <div className='social-faucet__admin-row'>
        <input
          placeholder='New voucher signer address'
          value={signerInput}
          onChange={(e) => setSignerInput(e.target.value)}
        />
        <button
          disabled={busy === 'signer' || !signerInput}
          onClick={() =>
            run('signer', () => setFaucetVoucherSigner(signerInput, signer!), 'Voucher signer rotated')
          }
        >
          {busy === 'signer' ? 'Saving…' : 'Rotate signer'}
        </button>
      </div>
      <div className='social-faucet__admin-row'>
        <input placeholder='Drain to address' value={drainTo} onChange={(e) => setDrainTo(e.target.value)} />
        <input
          placeholder='Amount (0 = all)'
          value={drainAmount}
          onChange={(e) => setDrainAmount(e.target.value)}
        />
        <button
          disabled={busy === 'drain' || !drainTo}
          onClick={() =>
            run(
              'drain',
              () => drainFaucet(drainTo, Number(drainAmount), signer!),
              'Faucet drained'
            )
          }
        >
          {busy === 'drain' ? 'Draining…' : 'Drain'}
        </button>
      </div>
    </div>
  );
}

export default function FaucetPanel() {
  const { walletAddress, userData, signer, isSignedIn } = useSAGEAccount();
  const address = walletAddress || (userData as any)?.walletAddress || '';
  const provider = useProvider();
  const [status, setStatus] = useState<FaucetStatus | null>(null);
  const [isOwner, setIsOwner] = useState(false);
  const [busy, setBusy] = useState(false);
  const [requestVoucher] = useRequestFaucetVoucherMutation();

  const refresh = useCallback(async () => {
    if (!FAUCET_ENABLED) return;
    try {
      const [s, owner] = await Promise.all([
        getFaucetStatus(provider, address || undefined),
        address ? isFaucetOwner(address, provider) : Promise.resolve(false),
      ]);
      setStatus(s);
      setIsOwner(owner);
    } catch {
      // faucet not reachable (wrong network, RPC hiccup) — leave last-known state
    }
  }, [address, provider]);

  useEffect(() => {
    refresh();
    const poll = setInterval(refresh, 30_000);
    return () => clearInterval(poll);
  }, [refresh]);

  const claim = async () => {
    if (!signer) {
      toast.info('Connect your wallet');
      return;
    }
    if (!isSignedIn) {
      toast.info('Sign in with your wallet first');
      return;
    }
    setBusy(true);
    const t = toast.loading('Requesting your claim…');
    try {
      const { signature } = await requestVoucher().unwrap();
      toast.update(t, { render: 'Claiming…', isLoading: true });
      await claimFaucet(signature, signer);
      toast.update(t, { render: 'SAGE sent to your wallet 💧', type: 'success', isLoading: false, autoClose: 5000 });
      refresh();
    } catch (err: any) {
      const msg = err?.data?.error || humanWalletError(err);
      toast.update(t, { render: msg, type: 'error', isLoading: false, autoClose: 6000 });
    } finally {
      setBusy(false);
    }
  };

  if (!FAUCET_ENABLED) {
    return <p className='social__empty'>The faucet isn't live on this network yet — check back soon.</p>;
  }

  const canClaim = !!status?.active && !status?.hasClaimed && (status?.balance || 0) > 0;

  return (
    <div className='social-faucet'>
      <div className='social-faucet__card'>
        <div className='social-faucet__drop'>💧</div>
        <div className='social-faucet__amount'>{status ? status.dripAmount.toLocaleString() : '—'} SAGE</div>
        <p className='social-faucet__blurb'>One claim per wallet, ever — and one per network.</p>

        {status && !status.active && (
          <p className='social-faucet__paused'>This faucet is paused right now — try again later.</p>
        )}

        <button
          className='social-faucet__cta'
          disabled={busy || (!!address && !!status && !canClaim)}
          onClick={claim}
        >
          {busy
            ? 'Claiming…'
            : !address || !status
            ? 'Claim SAGE'
            : status.hasClaimed
            ? 'Already claimed'
            : !status.active
            ? 'Paused'
            : status.balance <= 0
            ? 'Faucet is empty'
            : 'Claim SAGE'}
        </button>

        <p className='social-faucet__fine'>
          {status ? `${status.balance.toLocaleString()} SAGE left in the tank` : 'Loading tank balance…'}
        </p>
      </div>

      {isOwner && <AdminControls onChanged={refresh} />}
    </div>
  );
}
