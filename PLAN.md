# The Institute — site plan (draft)

Working plan agreed with Shai. Items marked **Open** still need a decision.

## Pages

### Home: metrics and feed
- **Metrics** about everything members added: totals (members, lists, albums/bands/songs ranked and
  how many different), most-ranked and top-scored (min. 3 members) per kind, most-used tags, albums by
  decade. Totals count private lists too, as numbers only; everything that names an item comes from
  shared lists (visitors: public lists; members: public + members-only).
- Computed **hourly** by a GitHub Action (`scripts/compute-stats.mjs`, admin key in the
  `FIREBASE_SERVICE_ACCOUNT` secret) into `stats/public` and `stats/members`; one read per visit.
- **Feed** ("Latest", on branch `next`): the 20 newest additions to shared lists, who added them and
  to which list. Comes from the same hourly job, so it can be up to an hour behind.
- **Feed**: what members did, newest first: added or re-ranked an album, gave a verdict, logged a
  concert, started a debate.
- **Group top lists**: The Institute's top albums, bands, songs and concerts, combined from everyone's
  rankings (see "Group lists" below).

### Member page (showcase)
- **Unlimited named lists** (decided 2026-10-16), each of one kind: albums, bands, songs (concerts in
  phase 3). Each list is unlimited in length and ordered by the member (drag to rank).
- Each entry has a **score** and **tags**, plus an optional note, **per list**: the same album can
  score 8.5 in one list and 10 in another.
- **Each list chooses who sees it**: only me (the default for a new list), members, or everyone. The
  member's name and photo show to visitors only while they have a public list.

### Item pages (one per album, band, song or concert)
- Cover or photo, basic facts (MusicBrainz, Wikipedia summary), and a 30-second preview for songs (iTunes).
- **Who ranked it**: every shared list the item is in, with that list's rank, score, tags and note.
  Only lists shared with the viewer count; private lists never show. A member with the item in
  several lists counts once in the average (their own average).
- Debates and comments about the item live here.

### Concerts (built 2026-10-16, on the `next` branch for review)
- A concert is **band + date**, one per band per day, shared by every member who was there (its id
  is the band's Deezer id plus the date, so the same show is never added twice). Venue, city and
  country are entered by the first member to add it.
- "I was there" = the concert is in one of your concert lists, with your own rank, score, tags
  (including "Legendary night") and note. The concert page shows everyone who shared it.
- **Shared facts, wiki-style**: any member can correct the venue and edit the **setlist** (one song
  per line) and add a link to the show on setlist.fm. Band and date never change.
- **Open:** automatic setlists from setlist.fm need an API key (free, non-commercial) and a small
  proxy (Cloudflare Worker); until then setlists are typed or pasted by members.
- **Photos**: later (no user uploads for now; see Infrastructure).

### People
- Members (public ones for visitors, all of them for members), with taste match between members.

### Chat (built 2026-10-16, on the `next` branch for review)
- An imitation of mIRC on the Realtime Database: switchbar of windows (status, channels, private
  messages), topic bar, nick list (@ ops, + voice, away greyed), mIRC colours and formatting
  (Ctrl+K/B/U/I/O and a colour picker), logs (last 200 lines per window), links clickable.
- Commands: /join /part /me /nick /topic /away /whois /msg /query /op /deop /voice /devoice /kick
  /ban /unban /mode (+m moderated, +t only ops set the topic) /list /clear /close /help.
- Whoever creates a channel is its op. #institute is joined by default; joined channels are
  remembered per browser. Nicks are unique, chosen on first visit, changeable with /nick.
- Enforced by database rules (tests: `npm run test:rules`): own nick only, one post per 0.7 s,
  bans block joining/reading/posting, +m and +t, private messages readable only by the two people.
- Decisions taken without Shai (review): **anyone signed in with a profile can chat** (the database
  can't check the profile, so the rules only require sign-in; ops can kick/ban); nicks can't contain
  [ ] (the database can't store them in keys); event lines are in English like the original.
- **Open:** the tab's name ("mIRC" is a trademark); modes +i (invite only) and +k (key); App Check
  (needs the site registered with reCAPTCHA in the console); quit messages when someone closes the
  page; file sharing (no user uploads for now).

### Group extras (built 2026-10-16, on the `next` branch for review)
- **Most divisive** (home): items where members disagree most (spread of their scores), at least 3
  members, showing the lowest and highest score.
- **Taste match** (a member's page, for members): agreement on the items both rated, 100% = same
  scores, 0% = 9 points apart on average; needs 3 in common; click for the item-by-item table.
- **Debates** (every item page): a members-only comment thread; authors can delete their own.
- **Open:** Last.fm import needs a Last.fm API key (free, from Shai's Last.fm account).

## Group lists
Group top lists are combined from members' rankings. **Open:** the formula. A starting idea: score
each entry by its rank position in each member's list, weighted by their score, and require a minimum
number of members before an item appears.

## Verdict and score (decided 2026-10-16)
Both, per entry, alongside the member's rank order.
- **Score**: 1–10 in half points (e.g. 8.5). Comparable across members, so it feeds the group lists.
- **Verdict**: personal **tags**, not a scale; several allowed per entry, **optional**. One **shared
  list** maintained for the group (members can't invent their own), so tags can be compared and counted.

  | English | עברית | Applies to |
  |---|---|---|
  | Life-changing | שינה לי את החיים | all |
  | Classic | קלאסיקה | all |
  | Desert-island | לאי בודד | all |
  | Guilty pleasure | תענוג אשם | all |
  | Grew on me | התחבב עליי עם הזמן | all |
  | Underrated | לא מוערך מספיק | all |
  | Overrated | מוערך מדי | all |
  | Hasn't aged well | לא התיישן טוב | all |
  | Legendary night | ערב אגדי | concerts |

- **Score is required** on every entry; tags are optional.

## Data sources (tested 2026-10-16)
| Source | From the browser | Use |
|---|---|---|
| MusicBrainz | Yes, no key, ~1 request per second, often "busy" | Album identity (one lookup when an album is added) |
| Cover Art Archive | Yes, no key | Album covers by MusicBrainz ID |
| iTunes Search | Yes, no key | Fast search, large covers, 30-second song previews |
| Deezer | Yes via JSONP, no key | All search (fast), band and song identity, pictures, song previews |
| Wikipedia | Yes, no key | Band and album summaries |
| Last.fm | Yes, free public key | Optional import of a member's top albums, bands, songs |
| setlist.fm | No: needs a key and blocks browsers | Concert setlists, through a small proxy (Cloudflare Worker) or entered by hand |
| Spotify API | Not worth it: needs tokens | Plain links and embeds only, no API |

## Infrastructure needed for these features
- **No user uploads for now** (concert photos, chat file sharing), decided 2026-10-16. When they come
  back: new Firebase projects need the **Blaze plan** for Cloud Storage, or use another free host.
- **setlist.fm proxy**: **Open:** Cloudflare Worker, or setlists entered by hand.

## Naming
- **Open:** a name for the chat tab instead of "mIRC" (for example "IRC" or "#institute"). The look and
  the slash commands are fine to imitate, but "mIRC" is a trademark.

## Build order (agreed 2026-10-16)
1. ~~Foundation~~ (done): Google sign-in, profiles, public or members-only, Hebrew and English.
2. Showcase: search (MusicBrainz, iTunes, Deezer), four lists, drag to rank, verdict and score, item pages.
3. Concerts in full: shared concerts, "I was there", setlists.
4. Home: feed and group top lists.
5. Chat.
6. Extras: taste match, debates, bot announcements, Last.fm import.
