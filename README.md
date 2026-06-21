# FlixToTrakt

A powerful, privacy-first local web application that imports your Netflix viewing history into your [Trakt.tv](https://trakt.tv) account. Built with **Next.js 16**, **React 19**, and **TypeScript**.

---

## ✨ Features

### 🔒 Privacy First
All processing happens locally on your machine. Your Trakt API credentials are stored in HTTP-only cookies — no data is ever sent to a third-party server.

### 🧠 Smart Multi-Layer Matching
The app uses a sophisticated matching pipeline to convert Netflix's messy CSV titles into accurate Trakt entries:

1. **TMDB-first lookup** — TV show names are searched on TMDB first (free, no rate limit), then cross-referenced to Trakt via the TMDB→Trakt ID bridge. This is faster and more accurate than text search alone.
2. **Structured episode parsing** — Netflix titles like `"Show: Season 1: Episode Title"` are parsed into structured show + season + episode queries, with exact title matching against the full season episode list.
3. **Fuzzy scoring** — When no exact match is found, episodes are scored using partial string matching (substring inclusion, word overlap) and ranked by relevance.
4. **Full-show shortcut** — Before processing individual episodes, the app checks if the number of episodes in your CSV matches the total episode count on TMDB. If it does, the entire show is auto-matched with a single API call, skipping potentially hundreds of lookups.
5. **Date filtering** — Suggestions whose release date is later than your watched date are automatically hidden, preventing impossible matches.
6. **Already-watched detection** — Items already in your Trakt watch history are detected and marked as `[ALREADY WATCHED]`, preventing duplicate syncs.

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

### Prerequisites
- [Node.js](https://nodejs.org/) v18+
- A [Trakt.tv](https://trakt.tv) account
- A Trakt API application (create one at [trakt.tv/oauth/applications](https://trakt.tv/oauth/applications))
- *(Optional but recommended)* A [TMDB](https://www.themoviedb.org/) API read access token for better matching accuracy

### Installation

```bash
git clone https://github.com/ionutbajanica/FlixToTrakt.git
cd FlixToTrakt
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) in your browser.

### Usage

1. **Enter API credentials** — Paste your Trakt Client ID, Client Secret, and optionally your TMDB read access token.
2. **Authenticate with Trakt** — The app uses Trakt's **Device Authentication** flow: you'll be given a code to enter at [trakt.tv/activate](https://trakt.tv/activate). No redirect URIs needed.
3. **Upload your Netflix CSV** — Go to your [Netflix Account Settings](https://www.netflix.com/account) → Profile → Viewing Activity → Download All, then upload the CSV file.
4. **Review matches** — The app processes your titles in batches, showing real-time progress. Review any items that need manual attention.
5. **Sync to Trakt** — Hit the "Sync to Trakt" button. Items are synced in small batches with automatic rate-limit retry.

> **Note:** On page reload, Trakt credentials are cleared for security. You'll need to re-authenticate, but your Trakt API keys are persisted.

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
| `POST /api/settings` | Save Trakt Client ID, Secret, and TMDB token as HTTP-only cookies |
| `POST /api/settings/clear` | Clear all stored credentials |
| `POST /api/auth/device/code` | Request a Trakt device authentication code |
| `POST /api/auth/device/token` | Poll for OAuth token after user authorizes the device |
| `POST /api/trakt/search` | Batch search titles — TMDB lookup → Trakt ID bridge → episode matching |
| `POST /api/trakt/sync` | Sync matched items to Trakt watch history (with 15s timeout + 429 retry) |
| `POST /api/trakt/watched` | Fetch existing Trakt watch history for duplicate detection |
| `POST /api/trakt/show-episode-count` | Look up total episode count from TMDB for full-show shortcut |

### Rate Limiting
A shared server-side **token bucket** (3 requests/second) with a global `pauseUntil` field ensures:
- Concurrent requests are metered safely.
- When any request hits a 429, **all** queued requests pause together instead of independently hammering the API.
- The frontend is notified immediately with the exact retry delay.

### Components

| Component | Role |
|-----------|------|
| `SetupForm` | Collects and saves Trakt + TMDB API credentials |
| `LoginForm` | Handles Trakt Device Auth flow with real-time polling |
| `Dashboard` | Main UI — CSV upload, batch processing, manual review, sync |
| `ReloadHandler` | Clears Trakt auth token on page reload (credentials persist) |
| `ClientPage` | State router between Setup → Login → Dashboard |

---

## 📄 License

This project is for personal use. Feel free to fork and adapt it to your needs.
