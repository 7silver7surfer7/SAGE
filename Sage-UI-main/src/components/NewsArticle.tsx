import { parseHTMLStrings } from '@/utilities/strings';
import TwitterSVG from '@/public/socials/twitter.svg';
import LinkSVG from '@/public/socials/link.svg';
import Image from 'next/image';
import React from 'react';
import { toast } from 'react-toastify';
import { TwitterShareButton } from 'react-share';

interface Props {
  thumbnail: string;
  title: string;
  link: string;
  description: string;
  highlight?: boolean;
}

function NewsArticle({ thumbnail, title, link, description, highlight }: Props) {
  function goToArticle() {
    window.open(link);
  }
  //   const isFirst: boolean = i == 0;
  let className = 'news-page__featured-news-item';
  const wordsToShow = highlight ? 600 : 300;
  let descriptionDisplay = parseHTMLStrings(description).slice(0, wordsToShow);
  if (highlight) {
    className = className + '--first';
  }
  return (
    <div className={className}>
      {highlight && (
        <div className='news-page__featured-news-item-highlighted-tag'>highlighted article</div>
      )}
      <div onClick={goToArticle} className={'news-page__featured-news-item-media-container'}>
        <Image
          src={thumbnail}
          layout='fill'
          objectFit='cover'
          loader={({ src, width, quality }) => {
            return `${src}?w=${width}&q=${quality || 75}`;
          }}
        />
      </div>
      <div className='news-page__featured-news-item-info'>
        <p className='news-page__featured-news-item-title'>{title}</p>
        <p className='news-page__featured-news-item-description'>{descriptionDisplay}</p>
        <div className='news-page__featured-news-item-share'>
          <p className='news-page__featured-news-item-share-label'>share article:</p>
          <LinkSVG
            onClick={() => {
              window.navigator.clipboard.writeText(link).then(() => {
                toast.success('Copied link to clipboard!', { toastId: `clipboard#${link}` });
              });
            }}
            className='news-page__featured-news-item-share-icon'
          />
          <TwitterShareButton
            style={{ display: 'flex', alignItems: 'center' }}
            url={link}
            title={title}
          >
            <TwitterSVG className='news-page__featured-news-item-share-icon' />
          </TwitterShareButton>
        </div>
      </div>
    </div>
  );
}

export default NewsArticle;
