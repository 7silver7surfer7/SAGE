export interface Parameters {
  ENDPOINT_URL: string;
}

export interface Configuration {
  [environment: string]: Parameters;
}

export const targetConfig: Configuration = {
  // IMPORTANT: URLs must end with a forward slash ("/") - or NextJS will redirect, causing CORS errors
  'localhost': {
    ENDPOINT_URL: 'http://localhost:3001/api/endpoints/',
  },
  'SAGE Dev': {
    ENDPOINT_URL: 'https://sage-dev.vercel.app/api/endpoints/',
  },
  'SAGE Staging': {
    ENDPOINT_URL: 'https://sage-staging.vercel.app/api/endpoints/',
  },
  'SAGE Production': {
    ENDPOINT_URL: 'https://www.sage.art/api/endpoints/',
  },
};
