import { createServer, type Server } from 'node:http';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { renderPdfFromUrl } from '../../src/services/browser-pdf.js';

// A tiny local static server, not aaradhya-web's own real app — this test
// verifies the Playwright integration itself (a browser actually launches,
// navigates, produces real PDF bytes, and localStorage injection actually
// lands on the target origin before the real page loads), not
// QuotationDocument's own visual fidelity, which the two repos being
// separate makes impractical to run here (see browser-pdf.ts's own
// top-of-file comment). That fidelity is instead verified live, manually,
// the same way every other STORY-069 through STORY-073 visual check in
// this project has been.
describe('renderPdfFromUrl', () => {
  let server: Server;
  let origin: string;
  // The test page's own inline script reports back whatever it read from
  // localStorage by calling this endpoint — the only way to observe what
  // actually landed in the browser's own storage from outside the
  // Playwright process itself, since renderPdfFromUrl only ever returns
  // opaque PDF bytes.
  let lastReportedSessionValue: string | null = null;

  beforeAll(async () => {
    server = createServer((req, res) => {
      if (req.url?.startsWith('/report-session')) {
        lastReportedSessionValue = new URL(req.url, origin).searchParams.get('value');
        res.end('ok');
        return;
      }
      // Simulates a page whose own client-side auth guard rejects whatever
      // session was injected and redirects to /login — the exact case
      // renderPdfFromUrl's own landedPath check exists to catch.
      if (req.url === '/protected') {
        res.statusCode = 302;
        res.setHeader('location', '/login');
        res.end();
        return;
      }
      res.setHeader('content-type', 'text/html');
      res.end(
        '<!doctype html><html><body><h1>Hello</h1><script>' +
          'fetch("/report-session?value=" + encodeURIComponent(localStorage.getItem("aaradhya.session") ?? ""));' +
          '</script></body></html>',
      );
    });
    await new Promise<void>((resolve) => server.listen(0, resolve));
    const address = server.address();
    if (!address || typeof address === 'string') {
      throw new Error('Expected the test server to bind to a TCP port.');
    }
    origin = `http://127.0.0.1:${address.port}`;
  });

  afterAll(async () => {
    await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
  });

  it('returns real, non-empty PDF bytes for a plain page', async () => {
    const pdf = await renderPdfFromUrl(origin, '/', undefined);

    expect(Buffer.isBuffer(pdf)).toBe(true);
    expect(pdf.length).toBeGreaterThan(0);
    // The PDF file-format magic bytes — proof this is real output from
    // Playwright's own `page.pdf()`, not the target page's raw HTML text.
    expect(pdf.subarray(0, 5).toString('latin1')).toBe('%PDF-');
  });

  it('injects the given session into localStorage on the target origin before the page loads', async () => {
    const session = { token: 'fake-token-for-this-test-only', user: { id: 'user-1', name: 'Test User', role: 'EventManager' as never } };

    await renderPdfFromUrl(origin, '/', session);

    expect(lastReportedSessionValue).toBe(JSON.stringify(session));
  });

  it('throws instead of silently returning a PDF of the page when redirected to /login', async () => {
    const session = { token: 'rejected-token', user: { id: 'user-1', name: 'Test User', role: 'EventManager' as never } };

    await expect(renderPdfFromUrl(origin, '/protected', session)).rejects.toThrow(/redirected to \/login/);
  });

  it('serves several concurrent renders without deadlocking (the concurrency cap queues, not drops, requests)', async () => {
    const results = await Promise.all(
      Array.from({ length: 5 }, () => renderPdfFromUrl(origin, '/', undefined)),
    );

    expect(results).toHaveLength(5);
    for (const pdf of results) {
      expect(pdf.subarray(0, 5).toString('latin1')).toBe('%PDF-');
    }
  });
});
