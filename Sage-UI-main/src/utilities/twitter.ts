import { parameters } from '@/constants/config';
import { Client, auth } from 'twitter-api-sdk';
const callbackURL = parameters.APP_URL + 'api/twitter/callback';

const authClient = new auth.OAuth2User({
  client_id: process.env.TWITTER_CLIENT_ID,
  client_secret: process.env.TWITTER_CLIENT_SECRET,
  callback: callbackURL,
  scopes: ['tweet.read', 'users.read', 'offline.access'],
});

// const authUrl = authClient.generateAuthURL({
//   code_challenge_method: 's256',
//   state: 'curated',
// });

export default authClient;
