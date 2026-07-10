import { createSlice, PayloadAction } from '@reduxjs/toolkit';

import { RootState } from './store';

export interface Wallet {
  walletAddress: string;
}

export const initialState: Wallet = {
  walletAddress: '',
};

export const walletSlice = createSlice({
  name: 'wallet',
  initialState,
  reducers: {
    setWallet: (state, { payload: { walletAddress } }: PayloadAction<Wallet>) => {
      state.walletAddress = walletAddress;
    },
    //@ts-ignore
    resetWallet: (state) => (state = initialState),
  },
});

export const { setWallet, resetWallet } = walletSlice.actions;

export const selectWallet = (state: RootState) => {
  return state.walletReducer;
};

export default walletSlice.reducer;
