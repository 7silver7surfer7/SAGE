//The next.config.js file must remain a JS file as it does not get parsed by Babel or TS

const nextConfig = {
  trailingSlash: true,
  reactStrictMode: false,
  pageExtensions: ['page.tsx', 'page.ts', 'api.ts'],
  images: {
    // Media is content-addressed (Arweave tx id / immutable S3 key), so an
    // optimized image for a given URL can never change.
    //
    // SECURITY (audit pass-3 HIGH): this was 31536000 (1 year). /_next/image
    // keys its on-disk cache by the FULL source URL, and an attacker picks
    // that URL — `?x=1`, `?x=2`, … all resolve to the same upstream bytes but
    // each writes a NEW cache entry. Content-addressing does not help when the
    // attacker controls the key. With a 1-year TTL on a RAM-backed Cloud Run
    // filesystem and no cache size cap, an anonymous loop fills the instance's
    // memory. A bounded TTL lets entries age out; real repeat views are still
    // served from cache (and Cloudflare fronts this anyway).
    minimumCacheTTL: 86400,
    domains: [
      // SECURITY NOTE (audit pass-3): every host here is a source /_next/image
      // will fetch and decode through sharp on demand for anyone who can craft
      // a URL. The two PERMISSIONLESS hosts below (arweave.net,
      // ipfs.filebase.io) let anyone upload arbitrary bytes and then have our
      // server fetch them — a DoS amplifier and the reachability path for the
      // sharp/libvips CVEs (mitigated for now by the sharp 0.35 upgrade).
      // They are deliberately still listed: Nft rows store Filebase gateway
      // URLs directly (see collectionPinner.ts / dropUpload.ts) and
      // /api/media only accepts 43-char Arweave tx ids, so it cannot serve an
      // IPFS CID. Dropping these makes next/image THROW during SSR and 500s
      // /drops/[id]. To close this properly, teach /api/media to proxy IPFS
      // CIDs (with the same size cap + content-type pinning it already applies
      // to Arweave), rewrite stored gateway URLs through it, THEN remove them.
      'arweave.net',
      'ipfs.filebase.io',
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
