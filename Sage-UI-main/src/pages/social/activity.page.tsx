import { useRouter } from 'next/router';
import LoaderDots from '@/components/LoaderDots';
import SocialShell from '@/components/Social/SocialShell';
import VerifiedBadge from '@/components/Social/VerifiedBadge';
import { PfpImage } from '@/components/Media/BaseMedia';
import shortenAddress from '@/utilities/shortenAddress';
import { transformTitle } from '@/utilities/strings';
import { useGetActivityQuery, ActivityItem } from '@/store/socialReducer';
import useSAGEAccount from '@/hooks/useSAGEAccount';

const VERBS: Record<ActivityItem['type'], string> = {
  like: 'liked your post',
  repost: 'reposted your post',
  tip: 'tipped your post',
  collect: 'collected your post',
  follow: 'followed you',
  reply: 'replied to your post',
};
const ICONS: Record<ActivityItem['type'], string> = {
  like: '♥',
  repost: '⇄',
  tip: '◎',
  collect: '⬡',
  follow: '＋',
  reply: '💬',
};

function timeAgo(iso: string): string {
  const s = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 3600) return `${Math.max(1, Math.floor(s / 60))}m`;
  if (s < 86400) return `${Math.floor(s / 3600)}h`;
  return `${Math.floor(s / 86400)}d`;
}

export default function ActivityPage() {
  const router = useRouter();
  const { isSignedIn } = useSAGEAccount();
  const { data, isFetching } = useGetActivityQuery(undefined, { skip: !isSignedIn, pollingInterval: 10_000, refetchOnFocus: true });

  return (
    <SocialShell>
    <div className='social'>
      <header className='social__header'>
        <h1 className='social__title'>ACTIVITY</h1>
        <p className='social__subtitle'>what the network did with your posts</p>
      </header>
      {!isSignedIn ? (
        <div className='social__empty'>Connect your wallet to see your activity.</div>
      ) : isFetching && !data ? (
        <LoaderDots />
      ) : data?.activity.length ? (
        <div className='social-activity'>
          {data.activity.map((a, i) => (
            <div
              key={i}
              className='social-activity__row'
              data-type={a.type}
              onClick={() => {
                if (a.postId) router.push(`/social/post/${a.postId}`);
                else router.push(`/social/${a.actor.address}`);
              }}
            >
              <div
                className='social-activity__avatar'
                onClick={(e) => {
                  e.stopPropagation();
                  router.push(`/social/${a.actor.address}`);
                }}
              >
                <span className='social-activity__avatar-img'>
                  <PfpImage src={a.actor.profilePicture} />
                </span>
                <span className='social-activity__badge'>{ICONS[a.type]}</span>
              </div>
              <div className='social-activity__body'>
                <span>
                  <b
                    onClick={(e) => {
                      e.stopPropagation();
                      router.push(`/social/${a.actor.address}`);
                    }}
                  >
                    {a.actor.username
                      ? transformTitle(a.actor.username)
                      : shortenAddress(a.actor.address)}
                  </b>
                  {a.actor.verified && <VerifiedBadge size={12} />} {VERBS[a.type]}
                  {a.amount ? <b> · {a.amount} SAGE</b> : null}
                </span>
                {a.snippet && <span className='social-activity__snippet'>“{a.snippet}”</span>}
              </div>
              <span className='social-activity__time'>{timeAgo(a.createdAt)}</span>
            </div>
          ))}
        </div>
      ) : (
        <div className='social__empty'>Nothing yet — post something worth tipping.</div>
      )}
    </div>
    </SocialShell>
  );
}
