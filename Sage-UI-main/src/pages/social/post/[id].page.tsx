import { useRouter } from 'next/router';
import LoaderDots from '@/components/LoaderDots';
import PostCard from '@/components/Social/PostCard';
import SocialShell from '@/components/Social/SocialShell';
import Composer from '@/components/Social/Composer';
import { useGetPostThreadQuery } from '@/store/socialReducer';

export default function SocialPostPage() {
  const router = useRouter();
  const id = Number(router.query.id);
  const { data, isFetching } = useGetPostThreadQuery(id, { skip: !id });

  if (isFetching || !data)
    return (
      <SocialShell>
        <LoaderDots />
      </SocialShell>
    );

  return (
    <SocialShell>
    <div className='social social--thread'>
      <button className='social__back' onClick={() => router.back()}>
        ← back
      </button>
      <div className='social__focus-post'>
        <PostCard post={data.post} clickable={false} />
      </div>
      <Composer replyToId={data.post.id} placeholder='Post your reply…' />
      <div className='social__feed'>
        {data.replies.length ? (
          data.replies.map((p) => <PostCard key={p.id} post={p} />)
        ) : (
          <div className='social__empty'>No replies yet.</div>
        )}
      </div>
    </div>
    </SocialShell>
  );
}
