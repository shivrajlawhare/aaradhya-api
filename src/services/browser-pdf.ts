import { chromium } from 'playwright';
import type { Role } from '../models/user.js';

// Duplicates aaradhya-web's own SESSION_STORAGE_KEY constant (src/stores/
// auth-context.tsx) verbatim — not imported, since these are two separate
// repos with no shared package between them. A single string literal is a
// far smaller, easier-to-notice drift risk than the whole QuotationDocument
// render tree this module exists specifically to avoid duplicating (see
// this file's own top-of-file comment below).
const SESSION_STORAGE_KEY = 'aaradhya.session';

export interface BrowserPdfSession {
  token: string;
  user: { id: string; name: string; role: Role };
}

// Caps how many full Chromium processes can be alive at once — a single
// `chromium.launch()` per call, with no cap, means a burst of near-
// simultaneous "Share PDF" clicks launches that many full browser
// processes concurrently; on a memory-constrained host (Render's free
// tier, Aaradhya_Quotation_PDF_Strategy.md §4's own deployment target)
// that can OOM-kill the whole API process, not just the PDF requests. A
// simple counting semaphore, not a queue library — this is the only place
// in the codebase that needs one, and the whole thing is under 15 lines.
const MAX_CONCURRENT_RENDERS = 2;
let activeRenders = 0;
const queuedRenders: (() => void)[] = [];

const acquireRenderSlot = (): Promise<void> => {
  if (activeRenders < MAX_CONCURRENT_RENDERS) {
    activeRenders += 1;
    return Promise.resolve();
  }
  return new Promise((resolve) => queuedRenders.push(resolve));
};

// Hands the freed slot directly to the next queued caller (its own
// `activeRenders` was never decremented while it waited) rather than
// decrementing and letting a fresh acquireRenderSlot race for it.
const releaseRenderSlot = (): void => {
  const next = queuedRenders.shift();
  if (next) {
    next();
    return;
  }
  activeRenders -= 1;
};

/**
 * Renders a PDF of a live page in aaradhya-web by driving a real, headless
 * browser — the only way to get an exact-match PDF of QuotationDocument
 * (aaradhya-web's own React render tree, STORY-069 through STORY-073's
 * fixed reproduction of the reference quotations) without a second,
 * hand-duplicated copy of that component and every formatter/style it
 * depends on living in this repo. Matches Aaradhya_Quotation_PDF_Strategy.md
 * §4's own original recommendation (Playwright over pdfkit's own plain-text
 * placeholder, which this replaces) — the two repos aren't a shared
 * workspace, so "render the same tree" means literally navigating a browser
 * to aaradhya-web's own already-running page, not re-importing its source.
 *
 * `session`, when supplied, is injected into `localStorage` on the target
 * origin before navigating to `path` — the exact mechanism aaradhya-web's
 * own api/client.ts already reads the current session from (fresh per
 * request, not cached), so a page that requires a logged-in Event Manager
 * (e.g. the quotation-preview route) renders correctly for a caller that
 * has no real browser session of its own (this backend process). Omit it
 * only for an already-public page.
 */
export const renderPdfFromUrl = async (
  origin: string,
  path: string,
  session?: BrowserPdfSession,
): Promise<Buffer> => {
  await acquireRenderSlot();
  try {
    const browser = await chromium.launch();
    try {
      const page = await browser.newPage();

      if (session) {
        // localStorage is origin-scoped — a page must actually be on the
        // target origin before it can be set, so this lands on the app's
        // own root first rather than trying to set it from about:blank.
        await page.goto(origin);
        await page.evaluate(
          // This callback runs inside the browser page, not this Node
          // process — `localStorage` is a real global there, but this
          // project's own tsconfig has no "dom" lib (a Node backend has no
          // legitimate use for one anywhere else), so it's typed via this
          // one minimal, explicit shape rather than pulling DOM globals
          // into every other file in this codebase.
          ({ key, value }) =>
            (
              globalThis as unknown as { localStorage: { setItem: (key: string, value: string) => void } }
            ).localStorage.setItem(key, value),
          { key: SESSION_STORAGE_KEY, value: JSON.stringify(session) },
        );
      }

      await page.goto(`${origin}${path}`, { waitUntil: 'networkidle' });

      // A rejected/expired/malformed injected session doesn't throw
      // anywhere — the SPA's own route guard just redirects client-side to
      // /login, which `waitUntil: 'networkidle'` is satisfied by just the
      // same as the real target page, so without this check page.pdf()
      // would silently capture the login screen and this function would
      // return a "successful" 200 PDF of the wrong page entirely.
      const landedPath = new URL(page.url()).pathname;
      if (session && landedPath.startsWith('/login')) {
        throw new Error(
          `renderPdfFromUrl: navigating to ${path} with a session ended up redirected to ${landedPath} — the injected session was rejected (expired/invalid token, or the target page's own auth guard).`,
        );
      }

      return await page.pdf({ format: 'A4', printBackground: true });
    } finally {
      await browser.close();
    }
  } finally {
    releaseRenderSlot();
  }
};
