# The Institute 🤘

A home for a group of friends who met on mIRC in the 90s: everyone's ranked albums, bands, songs and
concerts, debates about them, and an mIRC-style chat. Hebrew and English.

## Principles

- **Open to read, sign in to create.** Anyone can browse public showcases; any Google account can sign in
  and build their own. Each member chooses whether the public or only members can see their page.
- **Unlimited, ranked showcases**: albums, bands, songs and concerts, in each member's own order, with
  verdicts, scores and notes.
- **Separate from MovieRank**, with its own Firebase project; same stack (React, Vite, TypeScript, Firebase,
  GitHub Pages).

## Plan

1. **Foundation**: Google sign-in, member profiles, public/private setting, Hebrew/English (RTL).
2. **Showcase**: search via MusicBrainz / Cover Art Archive (and Spotify/Deezer), drag to rank,
   verdicts and scores, concerts with setlists from setlist.fm.
3. **mIRC**: channels (`/join`, `/part`), nick list with presence, private messages, `/me`, `/nick`,
   `/topic`, `/away`, `/whois`, ops and voice, kick/ban, modes (+m, +i, +k), mIRC colors, logs,
   file sharing. Enforced by security rules, rate limits and App Check. Not end-to-end encrypted.
4. **Group fun**: taste match between members, controversial picks, debates, shared timeline, and a bot
   announcing showcase changes in the channels.

## Develop

```bash
npm install
npm run dev
```
