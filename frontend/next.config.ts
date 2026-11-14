import type { NextConfig } from 'next';
import path from 'node:path';
/**
 * NEXT_BUILD_MODE=desktop  →  static export for Electron (FloDesktop)
 * NEXT_BUILD_MODE unset    →  standard Next.js server mode (FloPOS cloud)
 */
const isDesktop = process.env.NEXT_BUILD_MODE === 'desktop';
const isDevelopment = process.env.NODE_ENV === 'development';

const nextConfig: NextConfig = {
  // Static export: required for Electron — served via embedded Express,
  // not file:// so no CORS/routing issues.
  output: isDesktop ? 'export' : undefined,

  // Trailing slashes make static paths predictable: /pos → /pos/index.html
  trailingSlash: isDesktop,

  // Release builds with PostHog credentials emit browser maps for scripts/posthog-sourcemaps.cjs,
  // which uploads and then deletes them; other builds ship no maps.
  productionBrowserSourceMaps:
    isDesktop &&
    Boolean(process.env.POSTHOG_CLI_API_KEY?.trim() && process.env.POSTHOG_CLI_PROJECT_ID?.trim()),

  // next/image optimisation requires a running server; disable for static export.
  images: {
    unoptimized: isDesktop,
  },

  // The standalone backend runs on :3001 while the browser frontend runs on
  // :3000 during development. Proxy API calls so the frontend does not show
  // an endless auth/setup loading state from frontend-side 404 responses.
  ...(isDevelopment && !isDesktop
    ? {
        rewrites: async () => [
          {
            source: '/api/:path*',
            destination: 'http://localhost:3001/api/:path*',
          },
        ],
      }
    : {}),

  // Silence the "multiple lockfiles / inferred workspace root" warning.
  // Allow imports from /main (countries derivation shared with backend) via alias;
  // root must encompass both frontend/ and main/, so it points at the repo root.
  turbopack: {
    root: path.resolve(process.cwd(), '..'),
    resolveAlias: {
      '@countries': '../main/countries.ts',
    },
  },
};

export default nextConfig;
