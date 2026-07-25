import { useCallback, useEffect, useState } from 'react';
import { useSession } from 'next-auth/react';
import { toast } from 'react-toastify';

/**
 * Link an outside wallet so its SAGE earns Pixels here.
 *
 * The flow is a penny drop, and the exact amount IS the proof: the server
 * issues a random dust value and only a transfer of precisely that lands the
 * link. "Send anything from the wallet" would prove nothing, because anyone can
 * send dust to anyone — a bot's hot wallet paying out to a user would let that
 * user claim it and earn on its whole balance.
 *
 * Written for holders whose tokens sit in an embedded/custodial wallet (Privy,
 * via bankrbot) that they control but never sign in with. They can SEND from
 * it, which is all this asks; it deliberately does not ask them to sign a
 * message, because chat-driven custodians usually do not expose signing.
 */

interface Link {
  address: string;
  proof: string;
  verifiedAt: string;
}
interface Challenge {
  token: string;
  to: string;
  amount: string;
  amountWei: string;
  expiresAt: string;
}

const short = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`;

export default function PixelsWalletLink() {
  const { status } = useSession();
  const signedIn = status === 'authenticated';

  const [links, setLinks] = useState<Link[]>([]);
  const [challenge, setChallenge] = useState<Challenge | null>(null);
  const [busy, setBusy] = useState(false);
  const [loaded, setLoaded] = useState(false);

  const load = useCallback(async () => {
    if (!signedIn) return;
    try {
      const r = await fetch('/api/pixels-link/');
      if (!r.ok) return;
      const d = await r.json();
      setLinks(d.links || []);
      setChallenge(d.challenge || null);
    } catch {
      /* the panel is additive — a failed read just shows nothing */
    } finally {
      setLoaded(true);
    }
  }, [signedIn]);

  useEffect(() => {
    load();
  }, [load]);

  async function post(action: 'challenge' | 'verify') {
    setBusy(true);
    try {
      const r = await fetch('/api/pixels-link/', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ action }),
      });
      // A 500 returns an HTML error page, so r.json() throws — and reporting
      // that as "could not reach the server" sent me looking at the network
      // when the route had actually thrown (a stale Prisma client). Separate
      // the two: unreachable is the fetch rejecting, everything else is a
      // server response we should name by status.
      let d: any = null;
      try {
        d = await r.json();
      } catch {
        toast.error(`Server error (${r.status}). Check the server log.`);
        return;
      }
      if (!r.ok) {
        // the server's hint is the actionable half — show it, not the status
        toast.error(d.hint || d.error || `That did not work (${r.status}).`);
        return;
      }
      if (action === 'challenge') setChallenge(d);
      else {
        toast.success(`Linked ${short(d.address)} — it now earns Pixels here.`);
        setChallenge(null);
      }
      load();
    } catch {
      toast.error('Could not reach the server.');
    } finally {
      setBusy(false);
    }
  }

  async function unlink(address: string) {
    setBusy(true);
    try {
      await fetch(`/api/pixels-link/?address=${address}`, { method: 'DELETE' });
      toast.success(`Unlinked ${short(address)}.`);
      load();
    } finally {
      setBusy(false);
    }
  }

  if (!signedIn) {
    return (
      <p className='howtobuyash__earning-pixels-info'>
        Holding SAGE in another wallet — a Bankr or Privy wallet, say? Connect and sign in above
        and you can link it here, so its balance earns Pixels on this account too.
      </p>
    );
  }

  return (
    <div className='pixels-link'>
      <p className='howtobuyash__earning-pixels-info'>
        Holding SAGE somewhere you do not sign in from — a Bankr or Privy wallet? Link it and its
        balance earns Pixels here too. You prove the wallet is yours by sending a tiny amount{' '}
        <strong>out of it, to your main wallet</strong> — the tokens never leave your control.
        Balances are then added together, and the 25,000,000 cap applies to the total, so splitting
        a holding across wallets earns exactly what holding it in one does.
      </p>

      {links.length > 0 && (
        <ul className='pixels-link__list'>
          {links.map((l) => (
            <li key={l.address} className='pixels-link__row'>
              <span className='pixels-link__addr'>{l.address}</span>
              <button
                className='pixels-link__unlink'
                onClick={() => unlink(l.address)}
                disabled={busy}
              >
                Unlink
              </button>
            </li>
          ))}
        </ul>
      )}

      {!challenge && (
        <button
          className='howtobuyash__import-button'
          onClick={() => post('challenge')}
          disabled={busy || !loaded}
        >
          {links.length ? 'Link another wallet' : 'Link a wallet'}
        </button>
      )}

      {challenge && (
        <div className='pixels-link__challenge'>
          {/* The direction is the part people get wrong: the transfer has to
              come OUT of the wallet being linked. Sending from the main wallet
              instead proves nothing (it only shows you control the wallet you
              are already signed in as) and the check will not match. So the
              steps name both ends explicitly rather than saying "your wallet". */}
          <p className='howtobuyash__earning-pixels-info'>
            <strong>Step 1.</strong> Open your Bankr or Privy wallet — the one holding your SAGE.
          </p>
          <p className='howtobuyash__earning-pixels-info'>
            <strong>Step 2.</strong> From <em>that</em> wallet, send{' '}
            <strong>exactly {challenge.amount} SAGE</strong> to your main SAGE wallet, the address
            shown below. The transfer must come <em>out of</em> the wallet you are linking — that
            is what proves you control it. A transfer from any other wallet will not match.
          </p>
          <p className='howtobuyash__earning-pixels-info'>
            <strong>Step 3.</strong> Come back and press the button. Nothing is sent to us, the
            tokens stay yours, and it is a normal transfer between two of your own wallets.
          </p>
          <div className='pixels-link__field'>
            <span className='pixels-link__label'>SEND EXACTLY</span>
            <code className='pixels-link__value'>{challenge.amount}</code>
            <button
              className='pixels-link__copy'
              onClick={() => {
                navigator.clipboard.writeText(challenge.amount);
                toast.success('Amount copied');
              }}
            >
              Copy
            </button>
          </div>
          <div className='pixels-link__field'>
            <span className='pixels-link__label'>SEND TO (YOUR MAIN WALLET)</span>
            <code className='pixels-link__value'>{challenge.to}</code>
            <button
              className='pixels-link__copy'
              onClick={() => {
                navigator.clipboard.writeText(challenge.to);
                toast.success('Address copied');
              }}
            >
              Copy
            </button>
          </div>
          <button
            className='howtobuyash__import-button'
            onClick={() => post('verify')}
            disabled={busy}
          >
            {busy ? 'Checking the chain…' : "I've sent it — check now"}
          </button>
        </div>
      )}
    </div>
  );
}
