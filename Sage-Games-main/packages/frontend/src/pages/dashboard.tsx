import React from 'react';
import { Role } from '@prisma/client';
import Loader from 'react-loader-spinner';
import { useGetUserQuery } from '@/store/services/user';
import { DashBoardPage } from '@/components/Dashboard/DashboardPage';

export default function dashboard() {
  const isAdmin = (user: any) => {
    return user && Role.ADMIN == user.role;
  };
  const { data: user, isFetching: isFetchingUser } = useGetUserQuery();
  if (isFetchingUser) {
    return (
      <div style={{ margin: '25px' }}>
        <br />
        <Loader type='ThreeDots' color='white' height={10} width={50} timeout={0} />
      </div>
    );
  }
  if (!isAdmin(user)) {
    return <div style={{ margin: '25px' }}>Please connect with an admin wallet</div>;
  }
  return <DashBoardPage />;
}