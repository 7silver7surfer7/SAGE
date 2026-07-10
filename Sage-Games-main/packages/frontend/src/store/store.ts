import { configureStore, combineReducers } from '@reduxjs/toolkit';
import walletReducer from './walletSlice';
import themeReducer from './themeSlice';
import { userApi } from './services/user';
import { prizesApi } from './services/prizesReducer';
import { lotteriesApi } from './services/lotteriesReducer';
import { auctionsApi } from './services/auctionsReducer';
import { pointsApi } from './services/pointsReducer';
import { dashboardApi } from './services/dashboardReducer';
import { dropsApi } from './services/dropsReducer';

const rootReducer = combineReducers({
  [userApi.reducerPath]: userApi.reducer,
  [prizesApi.reducerPath]: prizesApi.reducer,
  [auctionsApi.reducerPath]: auctionsApi.reducer,
  [lotteriesApi.reducerPath]: lotteriesApi.reducer,
  [pointsApi.reducerPath]: pointsApi.reducer,
  [dashboardApi.reducerPath]: dashboardApi.reducer,
  [dropsApi.reducerPath]: dropsApi.reducer,
  themeReducer,
  walletReducer,
});

const store = configureStore({
  reducer: rootReducer,
  devTools: true,
  middleware: (getDefaultMiddleware) =>
    getDefaultMiddleware()
      .concat(userApi.middleware)
      .concat(prizesApi.middleware)
      .concat(auctionsApi.middleware)
      .concat(lotteriesApi.middleware)
      .concat(pointsApi.middleware)
      .concat(dashboardApi.middleware)
      .concat(dropsApi.middleware)
});

// Infer the `RootState` and `AppDispatch` types from the store itself
export type RootState = ReturnType<typeof store.getState>;
// Inferred type: {posts: PostsState, comments: CommentsState, users: UsersState}
export type AppDispatch = typeof store.dispatch;

export default store;
