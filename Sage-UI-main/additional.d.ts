import NextAuth, { DefaultSession } from 'next-auth';

export declare module 'next-auth' {
  /**
   * Returned by `useSession`, `getSession` and received as a prop on the `SessionProvider` React Context
   */
  interface Session {
    address: string;
  }
}
