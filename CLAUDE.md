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
  modes (+m, +i, +k), mIRC colors, logs, file sharing. Enforced by security rules + rate limits +
  App Check. Not end-to-end encrypted (tell members). No bridge to real IRC or WhatsApp.
- **Music data**: MusicBrainz + Cover Art Archive (open), Spotify/Deezer for search/covers,
  setlist.fm for concert setlists, optional Last.fm import.

## Plan

1. Foundation: Google sign-in, member profiles, public/private, i18n. ← built; rules need publishing
   Infrastructure only: the profile is deliberately minimal (name, photo, visibility). Nicks, bios,
   People/member pages etc. wait until Shai defines the site.
2. Showcase (albums, bands, songs, concerts; search, drag-to-rank, verdicts, scores).
3. mIRC chat.
4. Group features: taste match, controversial picks, debates, timeline, bot announcements.

## Infrastructure

- Firebase project **`theinstitute-8575b`** (created 2026-10-16): Google sign-in enabled (public name
  "The Institute"), authorized domain `shaidaniel.github.io`; Firestore **eur3**, production mode;
  Realtime Database **europe-west1**, locked mode. Rules live in `firestore.rules` and
  `database.rules.json` (RTDB stays fully locked until chat); publish them in the Firebase console.
  `npm run test:rules` checks the Firestore rules in the emulator (firebase-tools pinned to 13 because
  this machine has Java 17; v14+ needs Java 21). Config in `src/firebase-config.ts` (public by design).
  Google Analytics, Gemini and the Developer Program were left off.
- Hosting: GitHub Pages from `ShaiDaniel/theinstitute` via `.github/workflows/deploy.yml`.

## Working with Shai

- Explain plans briefly, then build; ask when a decision is genuinely theirs (privacy, naming).
- Never overwrite user data while testing; use scratch copies.
- Firebase console steps (rules, settings) have been done by Claude in Shai's Chrome with consent.
- Commit with the attribution line; push when work is done.
