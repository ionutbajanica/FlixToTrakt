# FlixToTrakt

[![ko-fi](https://ko-fi.com/img/githubbutton_sm.svg)](https://ko-fi.com/lordeye)

> **🤖 Note:** This application was created entirely using AI for personal use. It is highly unlikely to be maintained or updated in the future.

A powerful, privacy-first local web application that imports your Netflix viewing history into your [Trakt.tv](https://trakt.tv) account. Built with **Next.js 16**, **React 19**, and **TypeScript**.

---

## ✨ Features

### 🔒 Privacy First
All processing happens locally on your machine. Your Trakt sign-in is stored in HTTP-only cookies — no data is ever sent to a third-party server.

### 🧠 Smart Multi-Layer Matching
The app uses a sophisticated matching pipeline to convert Netflix's messy CSV titles into accurate Trakt entries:

1. **TMDB-first lookup** — Both modes share one TMDB matcher (`lib/tmdbMatch.ts`); sync mode then cross-references the result to Trakt via the TMDB→Trakt ID bridge. This is faster and more accurate than text search alone.
2. **Structured episode parsing** — Netflix titles like `"Show: Season 1: Episode Title"` are parsed into structured show + season + episode queries, with exact title matching against the full season episode list.
3. **Episode title decides the show** — Up to three same-name shows (remakes, UK/US versions) are tried, and the one that actually has the episode wins. Shows that premiered after your first watch are ruled out.
4. **Season-agnostic fallback** — If the episode is not in the season Netflix named (Netflix's "Part 3" is not always TMDB's season 3, and titles without a season default to 1), the rest of the show and then its specials are searched before anything goes to review.
5. **Fuzzy scoring** — Spelling drift is accepted when one episode is a near-identical spelling, or scores clearly ahead of every other episode (edit distance, word overlap and whole-word containment). Anything closer than that goes to review, ranked by the same score.
6. **Localised histories** — The history's language is detected from its season labels ("Staffel 2", "Temporada 1") and can be changed on the export screen. Episodes are compared against both the localised and the English TMDB names; titles in any script (Cyrillic, Korean, Japanese…) are compared as written.
7. **Full-show shortcut** — Before processing individual episodes, the app checks if the number of episodes in your CSV matches the total episode count on TMDB. If it does, the entire show is auto-matched with a single API call, skipping potentially hundreds of lookups.
8. **Date filtering** — Anything released after your first watch is ruled out during matching, which also settles same-title movie remakes. Suggestions are filtered the same way.
9. **Already-watched detection** — Items already in your Trakt watch history are detected and marked as `[ALREADY WATCHED]`, preventing duplicate syncs.

### 🔍 Manual Search
When automatic matching fails, every unmatched item (and even ignored items) includes a **manual Trakt search bar**. Type any query, hit Enter, and select the correct result from up to 8 suggestions — each with a `[View on Trakt]` link for verification.

### 📺 Grouped Episode Management
- Episodes from the same TV show are automatically **grouped together** with collapsible headers.
- **Quick Actions** at the group level let you match an entire show or specific season with one click.
- **Suggested shows** extracted from individual episode results are surfaced as group-level buttons.
- When you select a show for one episode, the selection **cascades** to all unmatched siblings in the group.

### 🎯 Organized Review
- **Unmatched items** are displayed at the top for immediate attention.
- **Matched items** (awaiting sync) are collected in a collapsible section.
- **Ignored items** are grouped into their own collapsible section, with sub-groups for each TV show and a separate sub-group for movies.
- **Synced items** are marked and collected after successful sync.

### ⚡ Rate Limit Transparency
Instead of silently hanging when Trakt's API rate limit (1,000 requests per 5 minutes) is hit, the app displays a **live countdown timer** in a Dynamic Island-style notification bar showing exactly when processing will resume.

### 🎨 Polished UI
- **Framer Motion** animations for smooth list transitions and entry/exit effects.
- **Dynamic Island** sticky status bar with glassmorphism styling.
- Dark theme with modern design tokens.

---

## 🚀 Getting Started

### Two modes

| Mode | Needs a Trakt API app? | What it does |
|------|------------------------|--------------|
| **Sync mode** | No: FlixToTrakt ships its own Trakt app. You can optionally use yours | Matches your history and writes it straight into your Trakt account over the API. |
| **Export mode** | **No** | Matches your history against TMDB and writes an import file you upload on Trakt's own import page. |

Sync mode signs in with Trakt's device flow, which needs only a Client ID and no Client Secret. That lets
everyone share the project's own Trakt app. Two Trakt rules apply:

- **Free Trakt accounts can keep one third-party app connected at a time.** Connecting FlixToTrakt may mean
  disconnecting another app first. You can disconnect FlixToTrakt again under Trakt → Settings → Connected Apps once
  the import is done.
- **Export mode** never touches the Trakt API, so neither that limit nor any API rule applies to it.

### Prerequisites
- [Node.js](https://nodejs.org/) v18+ (v22+ to run the unit tests)
- A [Trakt.tv](https://trakt.tv) account
- **Sync mode:** nothing beyond the Trakt account. A [TMDB](https://www.themoviedb.org/) API read access token is optional but strongly recommended
- **Export mode:** only a TMDB API read access token (free, granted instantly)

### Installation

```bash
git clone https://github.com/ionutbajanica/FlixToTrakt.git
cd FlixToTrakt
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) in your browser.

### Usage — sync mode

1. **Pick "Sync directly to Trakt"** and optionally paste your TMDB read access token. To use your own Trakt app instead of the shared one, open *Advanced* and paste its Client ID (see [Using your own Trakt app](#using-your-own-trakt-app)).
2. **Authenticate with Trakt** — The app uses Trakt's **Device Authentication** flow: you'll be given a code to enter on Trakt's activation page. No redirect URIs or Client Secret needed.
3. **Upload your Netflix CSV** — Go to your [Netflix Account Settings](https://www.netflix.com/account) → Profile → Viewing Activity → Download All, then upload the CSV file.
4. **Review matches** — The app processes your titles in batches, showing real-time progress. Review any items that need manual attention.
5. **Sync to Trakt** — Hit the "Sync to Trakt" button. Items are synced in small batches with automatic rate-limit retry.

> **Note:** On page reload, your Trakt sign-in is cleared for security, so you'll need to re-authenticate. Trakt access tokens also expire after 7 days.

### Using your own Trakt app

Optional in sync mode, and required only if the deployment has no shared Client ID configured:

1. Go to [developer.trakt.tv → My Apps](https://developer.trakt.tv/apps). Trakt asks for a one-time GitHub account verification before your first app. VIP is not required.
2. Create an app. The Redirect URI isn't used, because FlixToTrakt signs in with a device code.
3. Paste its **Client ID** under *Advanced* on the setup screen. The Client Secret isn't needed.

Trakt deletes apps that see no use for 30 days.

To change the shared app for a whole deployment, set the `TRAKT_CLIENT_ID` environment variable. It overrides
the Client ID committed in `src/lib/trakt-server.ts`.

### Usage — export mode (no Trakt API app)

1. **Pick "Export a file (no Trakt app)"** on the setup screen and paste your TMDB read access token. Nothing else is stored.
2. **Upload your Netflix CSV** — same file as above. The app auto-detects whether Netflix wrote your dates as `MM/DD/YY` or `DD/MM/YY`; you can override it with one click.
3. **Match with TMDB** — titles are resolved to TMDB shows, seasons, episodes and movies in batches, in the history language detected from your file (changeable next to the date format). Anything ambiguous lands in a review list with suggestions, a manual TMDB search box, an episode browser, and two group-level actions: "re-match episodes in" a show you pick — every episode in the group is looked up again in that show — or "mark the whole show as watched".
4. **Download an import file** — three formats are produced from the same matches:

   | File | Contents | Use it for |
   |------|----------|-----------|
   | `trakt-history.json` | Movies plus shows with nested seasons/episodes, each with a `watched_at` timestamp — Trakt's own history payload shape | First choice; the only format that carries episodes *and* exact dates |
   | `trakt-history.csv` | One row per watch: `watched_at, type, title, year, imdb_id, tmdb_id, tvdb_id, season_number, episode_number, episode_title, episode_tmdb_id` | Fallback if the JSON is rejected |
   | `letterboxd-diary.csv` | Letterboxd diary format, movies only | Movies-only fallback; also imports into Letterboxd |

   A fourth button downloads everything that *didn't* match, so nothing disappears silently.
5. **Import on Trakt** — go to [Trakt → Settings](https://trakt.tv/settings) → import your data, and upload the file. Importing works on free accounts (exporting is the VIP-only direction). Trakt skips duplicates and any import can be undone from the same page.

Watch dates become midday UTC timestamps, which keeps the calendar day correct in every timezone from UTC-11 to UTC+11. Netflix only records the day, not the time.

### Other ways in (no code required)

If you'd rather not run anything:

- **[Universal Trakt Scrobbler](https://github.com/trakt-tools/universal-trakt-scrobbler)** — browser extension that ships its own Trakt API app, so you don't register one. It reads your Netflix viewing activity directly and syncs it to Trakt.
- **Trakt's own Streaming Scrobbler** — connect Netflix inside Trakt's mobile app and let it pull your history. Requires Trakt VIP.
- **[Simkl](https://simkl.com/apps/import/)** — imports a Netflix CSV, and Trakt/Simkl can be kept in sync from there.

### Tests

```bash
npm test     # parsing, title normalisation, the matcher (fake TMDB), export file formats (node:test)
npm run build
```

`npm test` also parses any `NetflixViewingHistory*.csv` in the project root (gitignored — viewing histories are personal data) and checks every row is accounted for. To see how the matcher does on a real history against live TMDB:

```bash
TMDB_TOKEN=<read access token> npm run match-report -- NetflixViewingHistory.csv --out report.json
```

Add `--lib <other checkout>/src/lib` to run another version of the matcher over the same file for a before/after comparison.

---

## 🏗️ Architecture

### Tech Stack
| Layer | Technology |
|-------|-----------|
| Framework | Next.js 16 (App Router, Turbopack) |
| Frontend | React 19, TypeScript |
| Animations | Framer Motion |
| CSV Parsing | PapaParse |
| Styling | Vanilla CSS with CSS custom properties |
| APIs | Trakt v2, TMDB v3 |

### API Routes

| Route | Purpose |
|-------|---------|
| `POST /api/settings` | Save the mode, an optional own Trakt Client ID, and the TMDB token as HTTP-only cookies |
| `POST /api/settings/clear` | Clear all stored credentials |
| `POST /api/auth/device/code` | Request a Trakt device authentication code |
| `POST /api/auth/device/token` | Poll for OAuth token after user authorizes the device |
| `POST /api/trakt/search` | Batch search titles — TMDB lookup → Trakt ID bridge → episode matching |
| `POST /api/trakt/sync` | Sync matched items to Trakt watch history (with 15s timeout + 429 retry) |
| `POST /api/trakt/watched` | Fetch existing Trakt watch history for duplicate detection |
| `POST /api/trakt/show-episode-count` | Look up total episode count from TMDB for full-show shortcut |
| `POST /api/tmdb/match` | Export mode: batch-match Netflix titles against TMDB only (no Trakt credentials) |
| `POST /api/tmdb/search` | Export mode: manual TMDB search, or the episode list of a known show |

### Rate Limiting
A shared server-side **token bucket** (3 requests/second) with a global `pauseUntil` field ensures:
- Concurrent requests are metered safely.
- When any request hits a 429, **all** queued requests pause together instead of independently hammering the API.
- The frontend is notified immediately with the exact retry delay.

### Components

| Component | Role |
|-----------|------|
| `SetupForm` | Picks the mode and collects the credentials that mode needs |
| `LoginForm` | Handles Trakt Device Auth flow with real-time polling |
| `Dashboard` | Sync mode — CSV upload, batch processing, manual review, sync |
| `ExportDashboard` | Export mode — CSV upload, TMDB matching, review, import-file download |
| `ReloadHandler` | Clears Trakt auth token on page reload (skipped in export mode) |
| `ClientPage` | State router between Setup → Login → Dashboard / Export |

### Shared modules

| Module | Role |
|--------|------|
| `lib/netflix.ts` | Netflix CSV parsing: title → show/season/episode, date-order detection, UTC timestamps |
| `lib/titles.ts` | Title normalisation and fuzzy scoring used by both matchers |
| `lib/tmdb.ts` | TMDB client with per-process caching, concurrency cap and 429 back-off |
| `lib/tmdbMatch.ts` | TMDB-only matching pipeline behind export mode |
| `lib/traktExport.ts` | Builders for the Trakt JSON, Trakt CSV and Letterboxd CSV import files |
| `lib/trakt-server.ts` | Shared Trakt Client ID, Client ID resolution, authenticated fetcher and auth-error handling |

---

## 📄 License

This project is for personal use. Feel free to fork and adapt it to your needs.

---

## 🤖 AI Generated Disclaimer

This entire project (including all source code, architecture, and documentation) was generated by Artificial Intelligence. It was built as a personal utility to solve a specific problem (migrating Netflix history to Trakt). Because it was built for a one-off personal use case, **it is very likely that this project will not be actively maintained, supported, or updated** in the future. If APIs change or break, you are welcome to fork the repository and use AI to fix it yourself!
