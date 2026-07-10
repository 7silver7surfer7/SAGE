import useSAGEAccount from '@/hooks/useSAGEAccount';
import React from 'react';
import UserHandle from './UserHandle';

export default function PersonalizedMessage() {
  const { isSignedIn } = useSAGEAccount();
  if (isSignedIn) {
    return (
      <React.Fragment>
        <span>Welcome back! </span>
        <pre></pre>
        <UserHandle />
      </React.Fragment>
    );
  }





  return <React.Fragment>Welcome!</React.Fragment>;
}
