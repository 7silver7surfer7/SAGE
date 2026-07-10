import { createSlice } from '@reduxjs/toolkit';
import { RootState } from './store';

export interface State {
  dark: boolean;
}

const initialState: State = {
  dark: false,
};

export const themeSlice = createSlice({
  name: 'theme',
  initialState,
  reducers: {
    toggleTheme: (state) => {
      state.dark = !state.dark;
    },
    setTheme: (state, action) => {
      state.dark = action.payload;
    },
  },
});

export const { toggleTheme, setTheme } = themeSlice.actions;

export const selectTheme = (state: RootState) => {
  return state.themeReducer;
};

export default themeSlice.reducer;
