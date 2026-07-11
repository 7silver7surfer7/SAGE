//The next.config.js file must remain a JS file as it does not get parsed by Babel or TS

const nextConfig = {
  trailingSlash: true,
  reactStrictMode: false,
  pageExtensions: ['page.tsx', 'page.ts', 'api.ts'],
  images: {
    // Media is content-addressed (Arweave tx id / immutable S3 key), so an
    // optimized image for a given URL can never change. Cache each optimized
    // variant for a year instead of the 60s default, so repeat views (and any
    // CDN in front) serve it instantly instead of re-fetching from Arweave and
    // re-running sharp every minute.
    minimumCacheTTL: 31536000,
    domains: [
      // Arweave is the sole media host; the legacy S3/CloudFront hosts remain
      // allowed so any pre-migration images already in the DB still render.
      'arweave.net',
      'localhost',
      'dev-sage.s3.us-east-2.amazonaws.com',
      'staging-sage.s3.us-east-2.amazonaws.com',
      'sage-art.s3.us-east-2.amazonaws.com',
      'd2k3k1d7773avn.cloudfront.net'
    ],
  },
  webpack: (config) => {
    config.module.rules.push({
      test: /\.svg$/,
      use: [{ loader: '@svgr/webpack', options: { icon: true } }],
    });
    return config;
  },
  exportPathMap: async function () {
    return {
      '/': { page: '/' },
      '/marketplace': { page: '/marketplace' },
      '/profile': { page: '/profile' },
    };
  },
  staticPageGenerationTimeout: 180,
  swcMinify: false,
};

module.exports = nextConfig;
