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
      'd2k3k1d7773avn.cloudfront.net',
      // DiceBear: free, CC0 generative art avatars (SAGE Social bot pfps)
      'api.dicebear.com',
      // SAGE Social uploads (avatars/banners/post media) land here — without
      // this entry next/image REFUSES the host and avatars render blank
      // (in dev it even crashes the tree)
      'sageart-media-mirror.s3.us-east-2.amazonaws.com',
      // Social NFT drops pin artwork/metadata to Filebase (IPFS) — the Nft
      // rows store gateway URLs, and the drops page SSR-renders them through
      // next/image. An unlisted host makes next/image THROW during the server
      // render, 500ing the whole /drops/[id] page (the "Place bid" crash).
      'ipfs.filebase.io'
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
  // Keep the old /howtobuyash URL alive after the rename to /howtobuysage so
  // existing links and bookmarks don't 404 (server mode — `next start` — so
  // redirects() applies).
  async redirects() {
    return [
      { source: '/howtobuyash', destination: '/howtobuysage', permanent: true },
    ];
  },
  staticPageGenerationTimeout: 180,
  // Caps how many static-generation worker processes run in parallel during
  // `next build`. Each worker opens its own Prisma connection pool — on an
  // 8-core build host, uncapped workers × even a low per-worker
  // connection_limit can exceed Supabase's session-mode pooler cap
  // (pool_size: 15), failing the build with EMAXCONNSESSION as the number of
  // drop pages grows.
  experimental: {
    cpus: 2,
  },
  // SWC minifier: multi-threaded and far lighter on RAM than Terser during
  // `next build` — matters when cross-building the arm64 (Raspberry Pi) image.
  swcMinify: true,
  // Standalone output: .next/standalone carries only the node_modules the
  // server actually imports, shrinking the runtime image (Pi and Cloud Run
  // both) — the Dockerfile can copy it instead of the full node_modules tree.
  output: 'standalone',
};

module.exports = nextConfig;
