import Head from 'next/head';
import { GetServerSideProps } from 'next';
import { useRouter } from 'next/router';
import { toast } from 'react-toastify';
import prisma from '@/prisma/client';
import SageFullLogoSVG from '@/public/branding/sage-full-logo.svg';
import { PfpImage } from '@/components/Media/BaseMedia';
import shortenAddress from '@/utilities/shortenAddress';
import { transformTitle } from '@/utilities/strings';
import { useRedeemInviteMutation } from '@/store/socialReducer';
import useSAGEAccount from '@/hooks/useSAGEAccount';

interface Props {
  code: string;
  valid: boolean;
  usesLeft: number;
  ownerName: string;
  ownerAddress: string;
  ownerPfp: string | null;
  siteUrl: string;
}

/**
 * Public invite landing page. The og:image is the SAGE-styled card PNG
 * (InviteImage) so sharing the link on X/Twitter renders a rich preview with
 * the inviter's name, the code and the SAGE mark.
 */
export default function InvitePage(props: Props) {
  const router = useRouter();
  const { isSignedIn } = useSAGEAccount();
  const [redeemInvite, { isLoading }] = useRedeemInviteMutation();
  const imageUrl = `${props.siteUrl}/api/social/?action=InviteImage&code=${props.code}`;
  const pageUrl = `${props.siteUrl}/invite/${props.code}/`;

  const join = async () => {
    if (!isSignedIn) {
      toast.info('Connect your wallet first, then hit Join again');
      return;
    }
    try {
      await redeemInvite({ code: props.code }).unwrap();
      toast.success('Welcome to SAGE Social 🎉');
      router.push('/social');
    } catch (e: any) {
      toast.error(e?.data?.error || 'Could not redeem the invite');
    }
  };

  return (
    <>
      <Head>
        <title>You&apos;re invited to SAGE Social</title>
        <meta property='og:title' content={`${props.ownerName} invited you to SAGE Social`} />
        <meta
          property='og:description'
          content='The wallet-native art network — tips, collects and boosts in SAGE.'
        />
        <meta property='og:site_name' content='SAGE Social' />
        <meta property='og:type' content='website' />
        <meta property='og:image' content={imageUrl} />
        <meta property='og:image:width' content='1600' />
        <meta property='og:image:height' content='840' />
        <meta property='og:url' content={pageUrl} />
        <meta name='twitter:card' content='summary_large_image' />
        <meta name='twitter:image' content={imageUrl} />
        <meta
          name='twitter:image:alt'
          content={`SAGE Social invite card — code ${props.code} from ${props.ownerName}`}
        />
        <meta name='twitter:title' content={`${props.ownerName} invited you to SAGE Social`} />
        <meta
          name='twitter:description'
          content='The wallet-native art network — tips, collects and boosts in SAGE.'
        />
      </Head>
      <div className='social social--invite'>
        <div className='social-invite'>
          <div className='social-invite__mark'>
            <SageFullLogoSVG />
          </div>
          <h1 className='social-invite__title'>SOCIAL</h1>
          <p className='social-invite__sub'>your wallet is your handle · tip in SAGE</p>
          <div className='social-invite__from'>
            <div className='social-invite__pfp'>
              <PfpImage src={props.ownerPfp} />
            </div>
            <span>
              <b>{props.ownerName}</b> invited you
            </span>
          </div>
          <div className='social-invite__code'>{props.code}</div>
          {props.valid ? (
            <>
              <button className='social-invite__join' disabled={isLoading} onClick={join}>
                {isSignedIn ? 'Join SAGE Social' : 'Connect wallet to join'}
              </button>
              <p className='social-invite__uses'>{props.usesLeft} uses left on this invite</p>
            </>
          ) : (
            <p className='social-invite__uses'>This invite is used up — ask for a fresh one.</p>
          )}
        </div>
      </div>
    </>
  );
}

export const getServerSideProps: GetServerSideProps<Props> = async (ctx) => {
  const code = String(ctx.params?.code || '').toUpperCase();
  const invite = await prisma.socialInviteCode.findUnique({
    where: { code },
    include: {
      Owner: { select: { username: true, walletAddress: true, profilePicture: true } },
    },
  });
  if (!invite) return { notFound: true };
  const ownerName = invite.Owner.username
    ? transformTitle(invite.Owner.username)
    : shortenAddress(invite.Owner.walletAddress);
  return {
    props: {
      code: invite.code,
      valid: invite.uses < invite.maxUses,
      usesLeft: invite.maxUses - invite.uses,
      ownerName,
      ownerAddress: invite.Owner.walletAddress,
      ownerPfp: invite.Owner.profilePicture,
      siteUrl: (process.env.NEXTAUTH_URL || '').replace(/\/+$/, ''),
    },
  };
};
