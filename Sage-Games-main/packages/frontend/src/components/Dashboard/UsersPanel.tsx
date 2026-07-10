import React from 'react';
import { useState } from 'react';
import { toast } from 'react-toastify';
import { useSortBy, useTable, usePagination, useGlobalFilter } from 'react-table';
import { UserDetailsModal } from './UserDetailsModal';
import { GlobalFilter } from './GlobalFilter';
import shortenAddress from '@/utilities/shortenAddress';
import { useGetAllUsersAndEarnedPointsQuery } from '@/store/services/dashboardReducer';
import Loader from 'react-loader-spinner';
import { User } from '@prisma/client';

export function UsersPanel() {
  const { data: users, isFetching: isFetchingUsers } = useGetAllUsersAndEarnedPointsQuery();
  if (isFetchingUsers) {
    return (
      <div style={{ margin: '25px' }}>
        <br />
        <Loader type='ThreeDots' color='white' height={10} width={50} timeout={0} />
      </div>
    );
  }
  return <UsersTable users={users!} />;
}

interface UsersTableProps {
  users: User[];
}

function UsersTable({ users }: UsersTableProps) {
  const [isUserDetailsModalOpen, setIsUserDetailsModalOpen] = useState<boolean>(false);
  const [userDetails, setUserDetails] = useState<any>(undefined);
  const data = React.useMemo(() => JSON.parse(JSON.stringify(users)), []);
  const displayUserDetailsModal = (rowData: any) => {
    setUserDetails(rowData);
    setIsUserDetailsModalOpen((prevState) => !prevState);
  };
  const columns = React.useMemo(
    () => [
      {
        Header: '',
        accessor: 'profilePicture',
        Cell: (cell: any) => (
          <div>
            <img
              src={cell.value || '/sample/pfp.svg'}
              onClick={() => {
                displayUserDetailsModal(cell.row.original);
              }}
              className='dashboard-user__profile-img'
            />
          </div>
        ),
      },
      {
        Header: 'wallet',
        id: 'walletAddress',
        accessor: 'walletAddress',
        sortType: compareWallets,
        Cell: (cell: any) => (
          <div title={cell.value} style={{ display: 'flex' }}>
            <div
              onClick={() => {
                navigator.clipboard.writeText(cell.value);
                toast.success('Address copied!');
              }}
            >
              <img
                className='dashboard-user__wallet-clipboard'
                src='/copy.svg'
                style={{ stroke: 'white' }}
                alt=''
                width='15'
              />
            </div>
            <div className='dashboard-user__wallet-short-address'>{shortenAddress(cell.value)}</div>
          </div>
        ),
      },
      {
        Header: 'points earned',
        accessor: 'EarnedPoints.totalPointsEarned',
      },
      {
        Header: 'username',
        accessor: 'username',
      },
      {
        Header: 'e-mail',
        accessor: 'email',
      },
      {
        Header: 'created',
        accessor: 'createdAt',
        Cell: (cell: any) => <span title={cell.value}>{cell.value.slice(0, 10)}</span>,
      },
      {
        Header: 'role',
        accessor: 'role',
      },
    ],
    []
  );

  const {
    getTableProps,
    getTableBodyProps,
    headerGroups,
    prepareRow,
    page,
    canPreviousPage,
    canNextPage,
    pageOptions,
    pageCount,
    gotoPage,
    nextPage,
    previousPage,
    setPageSize,
    state: { pageIndex, pageSize, globalFilter },
    preGlobalFilteredRows,
    setGlobalFilter,
  } = useTable(
    {
      columns,
      data,
      initialState: {
        pageIndex: 0,
        sortBy: [
          {
            id: 'walletAddress',
            desc: false,
          },
        ],
      },
    },
    useGlobalFilter,
    useSortBy,
    usePagination
  );

  var _ = require('underscore');
  const pageRange = () => {
    let start = pageIndex - 2;
    let end = pageIndex + 2;
    if (end > pageCount) {
      start -= end - pageCount;
      end = pageCount;
    }
    if (start <= 0) {
      end += (start - 1) * -1;
      start = 1;
    }
    end = end > pageCount ? pageCount : end;
    return _.range(start, end + 1);
  };

  return (
    <>
      <UserDetailsModal
        isOpen={isUserDetailsModalOpen}
        toggle={() => setIsUserDetailsModalOpen((prevState) => !prevState)}
        userData={userDetails}
      />
      <GlobalFilter
        preGlobalFilteredRows={preGlobalFilteredRows}
        globalFilter={globalFilter}
        setGlobalFilter={setGlobalFilter}
      />
      <table {...getTableProps()} className='dashboard-user__table'>
        <thead>
          {headerGroups.map((headerGroup) => (
            <tr {...headerGroup.getHeaderGroupProps()}>
              {headerGroup.headers.map((column) => (
                <th
                  {...column.getHeaderProps(column.getSortByToggleProps())}
                  className='dashboard-user__table__header'
                >
                  {column.render('Header')}
                  <span>{column.isSorted ? (column.isSortedDesc ? ' 🔽' : ' 🔼') : ''}</span>
                </th>
              ))}
            </tr>
          ))}
        </thead>
        <tbody {...getTableBodyProps()}>
          {page.map((row, i) => {
            prepareRow(row);
            return (
              <tr {...row.getRowProps()} key={i}>
                {row.cells.map((cell, j) => {
                  return (
                    <td {...cell.getCellProps()} className='dashboard-user__table__cell' key={j}>
                      {cell.render('Cell')}
                    </td>
                  );
                })}
              </tr>
            );
          })}
        </tbody>
      </table>
      <div className='dashboard-user__nav'>
        <button onClick={() => gotoPage(0)} disabled={!canPreviousPage}>
          {'<<'}
        </button>
        <button onClick={() => previousPage()} disabled={!canPreviousPage}>
          {'<'}
        </button>
        {pageRange().map((pageItem: any, i: number) => {
          return (
            <button
              key={i}
              onClick={() => gotoPage(pageItem - 1)}
              className={`${pageItem == pageIndex + 1 && 'dashboard-user__nav--active'}`}
            >
              {pageItem}
            </button>
          );
        })}
        <button onClick={() => nextPage()} disabled={!canNextPage}>
          {'>'}
        </button>
        <button onClick={() => gotoPage(pageCount - 1)} disabled={!canNextPage}>
          {'>>'}
        </button>
      </div>
      <div style={{ textAlign: 'center'}}>
        <span style={{ marginRight: '1rem' }}>
          Page <strong>{pageIndex + 1}</strong> of <strong>{pageOptions.length}</strong>
        </span>
        <select
          value={pageSize}
          onChange={(e) => {
            setPageSize(Number(e.target.value));
          }}
        >
          {[5, 10, 25, 50, 100, 250].map((pageSize) => (
            <option key={pageSize} value={pageSize}>
              Show {pageSize}
            </option>
          ))}
        </select>
      </div>
    </>
  );
}

function compareWallets(rowA: any, rowB: any, id: any) {
  let a = '' + rowA.values[id];
  let b = '' + rowB.values[id];
  if (a > b) return 1;
  if (a < b) return -1;
  return 0;
}
