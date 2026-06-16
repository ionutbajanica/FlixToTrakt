# FlixToTrakt

FlixToTrakt is a simple, private, and powerful local web application that syncs your exported Netflix Viewing History to your Trakt.tv account!

## Features
- **Privacy First**: All data processing is done locally on your machine. Your Trakt API credentials are saved securely in your browser's HTTP-Only cookies.
- **Smart Matching**: Employs an intelligent matching algorithm to match Netflix's messy CSV export titles to Trakt's clean Movie, Show, and Episode metadata.
- **Manual Review**: If an exact match can't be found automatically, it provides a clean UI with top suggestions (including partial string matches for specific episodes) for you to quickly tick and accept.
- **Seamless Auth**: Uses Trakt's Device Authentication flow, meaning you don't need to struggle with Redirect URIs or complicated OAuth configurations.

## Setup

1. Clone this repository.
2. Install the dependencies:
   ```bash
   npm install
   ```
3. Start the development server:
   ```bash
   npm run dev
   ```
4. Open [http://localhost:3000](http://localhost:3000) in your browser.
5. Follow the on-screen instructions to connect your Trakt account!
6. Once connected, upload your `NetflixViewingHistory.csv` (which you can download from your Netflix Account Settings) and hit "Match Titles".

## How it works
This app is built using **Next.js (App Router)** and **React**. 
It utilizes:
- `papaparse` for fast local CSV reading.
- Trakt's `v2` API for search and syncing.
- Trakt's `Device Authentication (OOB)` flow for frictionless local login.
