# Aaradhya — Quotation PDF Generation & Storage Strategy

**Context this builds on:** the Quotation entity as currently specified (`Aaradhya_SRS_v1.1.md` §4.7, §5.4) is explicitly **not** a persisted record — "a rendering," generated fresh from the Event's live data on every request, with Assumption A2 stating outright that archived/versioned Quotation PDFs are *not* a v1 requirement and listing that same archival as out-of-scope (SRS §6.7). Framing this task around reproducibility — "a quotation may need to be reproduced later exactly as sent" — reopens that assumption. This document treats that reopening as accepted direction, not a hypothetical, and §5 below flags exactly what it changes elsewhere.

---

## 1. The two approaches

**Approach A — server-side generate, persist immediately, store the URL.** Every time "Generate Quotation PDF" is triggered, the backend renders the PDF (already decided: Playwright headless Chromium against the same themed components as the Quotation Preview screen, Tech Architecture doc §5), uploads the resulting file to object storage, and writes a small metadata record — event, timestamp, who generated it, a link to the file — into MongoDB. What gets shown to the user afterward (preview, download, "Share PDF") is that stored file, not a fresh render.

**Approach B — client-side generate/preview, persist only on confirm.** The browser renders a preview (some client-side PDF or print-to-PDF mechanism) instantly from data already on the page. Nothing is uploaded or recorded until the user explicitly marks that preview "final," at which point it's the confirmed version that gets uploaded and saved.

## 2. Comparison

| | Approach A — server-side, persist immediately | Approach B — client-side preview, persist on confirm |
|---|---|---|
| **User experience (preview speed)** | A round trip to the server for every look — Playwright's headless render takes roughly 1–3 seconds, not instant. Acceptable for a "Generate" action a user deliberately triggers, less pleasant for rapid iterate-and-recheck. | Instant — the preview is already-loaded page data rendered locally, no network round trip. This is Approach B's one genuine, real advantage. |
| **Consistency of output across devices** | Fully consistent — one Chromium instance, one render pipeline, byte-identical PDF regardless of who requests it or on what device. This is exactly what STORY-043's own acceptance criteria already test for. | Not guaranteed — a client-side PDF library or the browser's own print-to-PDF varies by browser engine, OS font substitution, and mobile vs. desktop print handling. The Event Managers here work across whatever machines and phones they have; a wedding-venue business's client-facing document looking subtly different depending on who generated it is a real risk, not a theoretical one. |
| **Storage cost** | Every generation becomes a stored object. At Aaradhya's realistic scale (see §4) this is trivial regardless — a non-factor either way. | Slightly less storage, since only confirmed-final versions persist — a real but immaterial saving given §4's numbers. |
| **Re-generation/editing needs** | Falls out naturally: FR-QUO-3 already says regenerating after a data change should reflect the latest state. Under Approach A, "regenerate" simply produces a new, separately stored snapshot — no special-casing needed. | Needs an explicit reconciliation step: what happens if a user previews, doesn't confirm, the Event's data changes, and they come back later to confirm an now-stale-looking preview? That gap has to be actively designed around. |
| **Audit/history requirements (reproducibility)** | Direct fit. Each generation is an immutable, timestamped, server-rendered artifact — genuinely "exactly what was sent," retrievable indefinitely. | Only the confirmed version is ever guaranteed to match anything real — and only if the confirm step re-uses the exact same preview bytes rather than re-rendering, which most client-side PDF approaches don't cleanly support. |

## 3. Recommendation: Approach A

The task constraint is explicit — justify against reproducibility, not against convenience — and on that axis Approach A isn't a close call. But it's also the approach that actually fits how this spec already thinks about data. SRS §6.5 states the reconciliation-free design outright: "because there is exactly one Event record per event, there is no reconciliation/sync requirement between a 'quotation' and an 'event' — eliminated by the data model, not handled defensively." FR-EVT-8 goes further: "there is exactly one data-entry flow for an Event — no separate 'quotation intake' flow exists anywhere in the product." Approach B's confirm-to-persist step is, structurally, a second flow with its own state (previewed-but-unconfirmed) sitting outside the one-record model those two requirements were written to rule out. Approach A has no such state — the render is triggered, it's persisted, it's done — so it doesn't just win the storage/consistency arguments, it's the one that doesn't fight the rest of the spec.

**The specific shape recommended, scoped for a 15-user internal tool, not an enterprise document-management system:** every "Generate Quotation PDF" action persists a snapshot — there is no separate "confirm this is final" step to design or build. An Event Manager iterating on numbers before anything is actually sent will simply end up with a few extra stored snapshots along the way; §4 shows that costs nothing worth engineering around. If, once this is in real use, the clutter of iteration-drafts in the history list turns out to matter, a lightweight "mark as sent" flag is a small additive change later — not a reason to build a two-step flow now against a problem that hasn't actually shown up yet.

## 4. Libraries and storage service — with numbers, not just names

**PDF rendering: Playwright `^1.62.1`** (already the Tech Architecture doc §5 recommendation for the *rendering* question — this document doesn't reopen that choice, only extends it to cover persistence). One React component tree renders both the on-screen Quotation Preview and the PDF, so there's no second template to keep in sync.

**Object storage: Cloudflare R2**, accessed via the standard AWS S3 SDK (R2 exposes an S3-compatible API, so no proprietary client library is needed):
- `@aws-sdk/client-s3` `^3.1120.0` — upload (`PutObjectCommand`) and fetch.
- `@aws-sdk/s3-request-presigner` `^3.1120.0` — generates short-lived signed download URLs. Quotation PDFs contain client names and commercial pricing; keep the R2 bucket private and hand out a time-limited signed URL per view/download rather than a permanently public link stored verbatim in Mongo.

Why R2 over the other candidates actually checked, given the standing constraint against paid libraries/services and the free-tier-first hosting stack already chosen (Vercel Hobby, Render free, Atlas M0):

| | Cloudflare R2 | Vercel Blob (Hobby) | AWS S3 |
|---|---|---|---|
| Free storage | 10 GB-month, ongoing | ~5 GB, ongoing, shared with the rest of the Hobby plan's resource pool | None — new accounts get **credits** (up to $200, expiring within 12 months), not a permanent free allowance, as of the current AWS Free Tier terms |
| Free egress (downloading the PDFs) | Unlimited, always free — even past the storage free tier | Included transfer has a cap; billed per-GB beyond it | Billed per-GB, no free allowance |
| Hard cutoff behavior | N/A — pay-as-you-go beyond free tier, no lockout | Hobby plan **blocks access entirely** once limits are hit, for 30 days | N/A once credits are exhausted — billed |
| Verdict | **Recommended** | Reasonable if avoiding a second account matters more than the larger, safer headroom | Ruled out — not actually free at this project's stage |

**Concrete scale check, so "10 GB free" isn't just an abstract number:** a themed multi-page Quotation PDF (client details, per-session breakdown, accommodation, cost summary, static footer) lands somewhere around 300–800 KB. Call it 600 KB. At a plausible scale for a business with "up to 3 concurrent Event Manager accounts" (SRS §3.1) — say 300 events a year, each regenerated on average 4 times before the event happens — that's roughly 1,200 PDFs/year × 600 KB ≈ **720 MB a year**. Five years of full, never-pruned history is under 4 GB — comfortably inside R2's 10 GB free tier with no pruning policy needed, and no reason to treat storage growth as a risk worth engineering around now.

## 5. What this decision actually changes elsewhere

This isn't just an implementation detail — persisting Quotations is new v1 scope, not covered by the story backlog or collections list as currently written. Flagging exactly what needs updating rather than letting it sit as an implicit assumption:

- **SRS Assumption A2** ("generated Quotation PDFs are not archived/versioned") is superseded — this document is that revision.
- **SRS §6.7 Out-of-Scope** currently lists "Archival/versioning of previously generated Quotation PDFs" as explicitly excluded from v1 — that line needs to come out.
- **A new `quotations` collection** is needed (it doesn't exist in `Aaradhya_Collections_and_API.md` today, since nothing was persisted before). Minimal, spec-traceable fields: `event_id`, `generated_at`, `generated_by`, `storage_key` (the R2 object key — never a bare public URL, per §4), and a snapshot of the `grand_total` at generation time (so a history list can render without re-fetching or re-computing). Whether to track *which* snapshot was the one actually emailed to the client is a real open question this document doesn't resolve — flag it rather than invent a field for it.
- **STORY-043** (`GET /events/:id/quotation.pdf`) changes from a pure live-render endpoint to one that renders *and* persists — its acceptance criteria's "no caching of a stale render" still holds (every call is a fresh render), it's just that the fresh render now also gets saved rather than only streamed back.
- **STORY-041/044/045** are largely unaffected in spirit (the live rollup, the button, the preview screen all still work the same way from a user's perspective) but STORY-044/045's "Share PDF" action now shares a persisted, re-fetchable file rather than a one-time stream.
- A **new story** is needed for the "reproduce a past Quotation" capability itself — a history list endpoint/UI (`GET /events/:id/quotations` + a simple list view) — since nothing in the current backlog builds a way to actually look at past snapshots; persisting them is pointless without it.

I'll update `Aaradhya_SRS_v1.1.md`, `Aaradhya_Collections_and_API.md`, `Aaradhya_Story_Backlog.md`, and `Aaradhya_Tech_Architecture.md` to reflect all of this now, per your go-ahead.

---

## Sources

- [Cloudflare R2 Pricing](https://developers.cloudflare.com/r2/pricing/)
- [Vercel Blob Usage & Pricing](https://vercel.com/docs/vercel-blob/usage-and-pricing)
- [AWS S3 Pricing](https://aws.amazon.com/s3/pricing/)
- [@aws-sdk/client-s3 — npm](https://registry.npmjs.org/@aws-sdk/client-s3/latest)
- [@aws-sdk/s3-request-presigner — npm](https://registry.npmjs.org/@aws-sdk/s3-request-presigner/latest)
- [playwright — npm](https://registry.npmjs.org/playwright/latest)
