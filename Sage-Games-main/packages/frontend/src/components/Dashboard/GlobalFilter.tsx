import React from 'react';
import { Row, useAsyncDebounce } from 'react-table';

interface GlobalFilterProps {
  preGlobalFilteredRows: Row<object>[];
  globalFilter: any;
  setGlobalFilter: any;
}

export function GlobalFilter({
  preGlobalFilteredRows,
  globalFilter,
  setGlobalFilter,
}: GlobalFilterProps) {
  const count = preGlobalFilteredRows.length;
  const [value, setValue] = React.useState(globalFilter);
  const onChange = useAsyncDebounce((value) => {
    setGlobalFilter(value || undefined);
  }, 200);

  return (
    <div className='dashboard-search-container'>
      <label htmlFor='dashboardSearch'>
        <img src='/search.svg' className='dashboard-search-icon' />
      </label>
      <input
        id='dashboardSearch'
        name='dashboardSearch'
        className='form-control'
        value={value || ''}
        onChange={(e) => {
          setValue(e.target.value);
          onChange(e.target.value);
        }}
        placeholder={`${count} records...`}
        size={20}
      />
    </div>
  );
}
