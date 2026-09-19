import 'dotenv/config';

const requireEnv = (name: string): string => {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
};

export const config = {
  port: Number(process.env.PORT ?? 4000),
  mongodbUri: requireEnv('MONGODB_URI'),
  mongodbName: process.env.MONGODB_DB_NAME ?? 'aaradhya',
  jwtSecret: requireEnv('JWT_SECRET'),
  // Any `jose` duration string (e.g. 30m, 8h, 7d). Session length is a
  // technical decision, not a product requirement (SRS FR-AUTH-4).
  jwtExpiresIn: process.env.JWT_EXPIRES_IN ?? '8h',
  // Used to pin Node's DNS resolver (src/db.ts) — see the comment there.
  // Comma-separated, override with DNS_SERVERS if 8.8.8.8/1.1.1.1 are
  // blocked on your network.
  dnsServers: (process.env.DNS_SERVERS ?? '8.8.8.8,1.1.1.1').split(',').map((server) => server.trim()),
  // Origins allowed to call this API cross-origin (aaradhya-web's dev server
  // by default — Vite on 5173). Comma-separated; add a deployed frontend
  // origin here once one exists.
  corsOrigins: (process.env.CORS_ORIGINS ?? 'http://localhost:5173')
    .split(',')
    .map((origin) => origin.trim()),
  // aaradhya-web's own origin — services/browser-pdf.ts navigates a
  // headless browser here to render the Quotation PDF from the real,
  // already-running frontend app (Aaradhya_Quotation_PDF_Strategy.md §4),
  // not a second server-side copy of its render tree. Same default as
  // corsOrigins' own first entry (Vite's dev-server port).
  webAppUrl: process.env.WEB_APP_URL ?? 'http://localhost:5173',
  // The single organization-wide GST rate (SRS Assumption A9) applied to
  // Accommodation room-line totals (STORY-018) and, later, the Quotation
  // summary. A percentage, e.g. 18 means 18%, not tax-per-room-type slabs.
  gstRatePercent: Number(process.env.GST_RATE_PERCENT ?? 18),
} as const;
