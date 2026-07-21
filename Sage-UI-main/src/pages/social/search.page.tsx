import { useState } from 'react';
import { useRouter } from 'next/router';
import LoaderDots from '@/components/LoaderDots';
import SocialShell from '@/components/Social/SocialShell';
import SearchIcon from '@/components/Icons/SearchIcon';
import PostCard from '@/components/Social/PostCard';
import VerifiedBadge from '@/components/Social/VerifiedBadge';
import AgentBadge from '@/components/Social/AgentBadge';
import { PfpImage } from '@/components/Media/BaseMedia';
import shortenAddress from '@/utilities/shortenAddress';
import { transformTitle } from '@/utilities/strings';
import { useSearchSocialQuery } from '@/store/socialReducer';

export default function SocialSearchPage() {
  const router = useRouter();
  const [input, setInput] = useState('');
  const [query, setQuery] = useState('');
  const { data, isFetching } = useSearchSocialQuery(query, { skip: query.length < 2 });

  return (
    <SocialShell>
      <div className='social'>
        <header className='social__header'>
          <h1 className='social__title'>SEARCH</h1>
          <p className='social__subtitle'>find wallets, artists and posts</p>
        </header>
        <div className='social-search__bar'>
          <div className='social-search__input-wrap'>
            <span className='social-search__bar-icon'><SearchIcon size={16} /></span>
            <input
              className='social-search__input'
              placeholder='Search usernames, addresses, posts…'
              value={input}
              autoFocus
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') setQuery(input.trim());
              }}
            />
          </div>
          <button
            className='social-composer__submit'
            disabled={input.trim().length < 2}
            onClick={() => setQuery(input.trim())}
          >
            Search
          </button>
        </div>
        {isFetching ? (
          <LoaderDots />
        ) : data ? (
          <>
            {data.users.length > 0 && (
              <div className='social-search__section'>
                <h4>People</h4>
                {data.users.map((u) => (
                  <button
                    key={u.address}
                    className='social-search__user'
                    onClick={() => router.push(`/social/${u.address}`)}
                  >
                    <div className='social-search__user-avatar'>
                      <PfpImage src={u.profilePicture} />
                    </div>
                    <span className='social-search__user-name'>
                      {u.username ? transformTitle(u.username) : shortenAddress(u.address)}
                      {u.verified && <VerifiedBadge size={12} />}
                      {u.isAgent && <AgentBadge size={12} />}
                    </span>
                    <span className='social-search__user-handle'>{shortenAddress(u.address)}</span>
                  </button>
                ))}
              </div>
            )}
            {data.posts.length > 0 && (
              <div className='social-search__section'>
                <h4>Posts</h4>
                {data.posts.map((p) => (
                  <PostCard key={p.id} post={p} />
                ))}
              </div>
            )}
            {!data.users.length && !data.posts.length && query && (
              <div className='social__empty'>Nothing found for “{query}”.</div>
            )}
          </>
        ) : (
          <div className='social__empty'>Search the network — 2+ characters.</div>
        )}
      </div>
    </SocialShell>
  );
}
