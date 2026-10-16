# The Institute — notes for Claude

A site for a group of ~25-year friends who met on mIRC in the 90s (nu-metal and music in general):
each member's ranked showcase of albums, bands, songs and concerts, debates, and an mIRC-style chat.
Owner: Shai (shai.daniel@gmail.com). Sibling project of MovieRank (`D:\Projects\MovieRank`), which
uses the same stack and is a good reference for patterns (sign-in, comments/votes, design).

## Decisions (agreed with Shai)

- **Unlimited ranked showcases**, not a fixed "9 albums": albums, bands, songs and concerts, ordered by
  the member, with verdicts, scores and notes. All four from the start.
- **Open to read, sign in to create.** Any Google account can sign in and build a page. Each member
  chooses whether their page is public or members-only.
- **Hebrew and English** (RTL for Hebrew; `src/i18n.tsx`).
- **Separate site** from MovieRank, with its **own Firebase project**.
- **mIRC imitation**: channels (`/join`, `/part`), nick list with live presence (Realtime Database
  `onDisconnect`), private messages, `/me`, `/nick`, `/topic`, `/away`, `/whois`, ops/voice, kick/ban,
  modes (+m, +i, +k), mIRC colors, logs. (File sharing deferred: no user uploads for now.) Enforced by security rules + rate limits +
  App Check. Not end-to-end encrypted (tell members). No bridge to real IRC or WhatsApp.
- **Music data**: MusicBrainz + Cover Art Archive (open), Spotify/Deezer for search/covers,
  setlist.fm for concert setlists, optional Last.fm import.

- **Unlimited named lists per member**, one kind each; each list is private / members / public (new
  lists start private). Scores, tags and notes are per list entry. Profile visibility is derived:
  public while any list is public.
- **Entries have both a verdict and a score.** Score: 1–10 in half points, required. Verdict:
  optional personal tags from one shared list (several per entry; list in `PLAN.md`), not a scale.
- **Concerts are shared**: band + date + venue; members who were there join the same concert, each
  with their own rank/verdict/score. Photos deferred (no user uploads for now).
- **Home page = feed + group top lists** (group lists combined from everyone's rankings).
- Full working plan, open questions and tested data sources: `PLAN.md`.

## Plan

1. Foundation: Google sign-in, member profiles, public/private, i18n. ← done (profile deliberately minimal)
2. Showcase: named lists of albums, bands, songs; search (Deezer), drag-to-rank, score + tags, item
   pages, People list. ← built locally, not yet live (needs the new rules + a collection-group index
   published). Concerts are phase 3.
3. Concerts: shared concerts (band + date), "I was there" via concert lists, wiki-style setlists. ← on
   branch `next` for review.
4. Home: metrics (hourly GitHub Action → stats/public, stats/members) ← live; feed ← branch `next`.
5. Chat: mIRC imitation on the Realtime Database (`src/chat/`, `database.rules.json`) ← branch `next`;
   RTDB rules must be published in the console before it works live.
6. Extras: taste match, debates, bot announcements, Last.fm import.
See `PLAN.md` for details and open questions. Phase 1 is infra only: don't invent features.

## Infrastructure

- Firebase project **`theinstitute-8575b`** (created 2026-10-16): Google sign-in enabled (public name
  "The Institute"), authorized domain `shaidaniel.github.io`; Firestore **eur3**, production mode;
  Realtime Database **europe-west1**, locked mode. Rules live in `firestore.rules` and
  `database.rules.json` (RTDB stays fully locked until chat); publish them in the Firebase console.
  `npm run test:rules` checks the Firestore rules in the emulator (firebase-tools pinned to 13 because
  this machine has Java 17; v14+ needs Java 21). Config in `src/firebase-config.ts` (public by design).
  Google Analytics, Gemini and the Developer Program were left off.
- Hosting: GitHub Pages from `ShaiDaniel/theinstitute` via `.github/workflows/deploy.yml`.
- Home metrics: `.github/workflows/stats.yml` hourly; needs repo secret `FIREBASE_SERVICE_ACCOUNT`
  (service account key JSON; Shai creates and pastes it, Claude must not handle the key).

## Testing locally

- `npm run emulators` (auth, Firestore, Realtime Database) + `npm run dev:emu` (http://localhost:5181): fake project `demo-institute`, fake
  Google users (sign-in button signs in as "Test Member"; `signInAs('Name')` in the console for others).
  Never touches real data. Both are in `.claude/launch.json`.
- `npm run test:rules` uses its own emulator (`firebase.test.json`, port 8095), so it runs beside
  `npm run emulators`. On Windows the emulator's Java process often survives; stop it before the next run.
- `npm run stats:emu` recomputes the home metrics against the local emulator.
- `npm run dev` (port 5180) talks to the real Firebase project.

## Working with Shai

- Explain plans briefly, then build; ask when a decision is genuinely theirs (privacy, naming).
- Never overwrite user data while testing; use scratch copies.
- Firebase console steps (rules, settings) have been done by Claude in Shai's Chrome with consent.
- Don't commit until Shai agrees the work is ready (unless a commit is needed to test Firebase on the
  live site). Commit with the attribution line.
