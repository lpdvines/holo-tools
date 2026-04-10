# HOLO Digital — Internal Agency Tool Platform
## Claude Code Project Brief v2

---

## Overview

Build a web-based internal tool platform for HOLO Digital Ltd, a UK marketing agency. The platform starts with a dashboard home page and builds out tools one at a time. Tools are developed locally on Mac using Claude Code, pushed to GitHub, and deployed as a Docker container on an Unraid home server exposed via Cloudflare Tunnel.

---

## Development Philosophy

Build in phases. Do not try to build everything at once.

- **Phase 1:** Project setup + Dashboard UI + GitHub workflow
- **Phase 2:** Tool 1 — Google Ads Copy Generator (Claude API only, no other integrations)
- **Phase 3:** Tool 2 — Content Generator (Claude API + Google Drive + Excel sheet tracking)
- **Phase 4:** Tool 3 — Email Digest (Gmail API + node-cron scheduler)
- **Phase 5:** Add Drive saving + Trello task creation across tools

Each phase should be fully working and committed to GitHub before the next begins.

---

## Deployment Target

- **Environment:** Docker container on Unraid (Linux-based)
- **External access:** Cloudflare Tunnel (e.g. tools.holodigital.co.uk)
- **Authentication:** Cloudflare Access (handled at tunnel level)
- **Development:** Built and tested locally on Mac, pushed to GitHub, deployed to Unraid
- **Language:** Node.js

Write a production-ready Dockerfile from day one. Use Linux-compatible paths. All credentials as environment variables.

---

## GitHub → Unraid Deployment Workflow

### Setup (one time)
1. Create GitHub repository: `holo-tools` (private)
2. Push all code to GitHub from Mac
3. On Unraid, install **Watchtower** Docker container — this watches for image updates and redeploys automatically
4. Set up a GitHub Action that builds a Docker image on every push to `main` and pushes it to **GitHub Container Registry (ghcr.io)**
5. Watchtower on Unraid pulls the new image and restarts the container automatically

### Day-to-day workflow
```
Write code on Mac
→ git push origin main
→ GitHub Action builds Docker image
→ Watchtower on Unraid detects new image
→ Container redeploys automatically
```

### GitHub Actions file to include
Claude Code should generate a `.github/workflows/deploy.yml` that:
- Triggers on push to `main`
- Builds the Docker image
- Pushes to `ghcr.io/[your-username]/holo-tools:latest`

---

## File Structure

```
holo-tools/
├── .github/
│   └── workflows/
│       └── deploy.yml         # Auto-build and push Docker image
├── server.js                  # Express server + API routes
├── clients.json               # Client config (Docker volume mount)
├── .env                       # Local dev credentials (never committed)
├── .gitignore                 # Must include .env and node_modules
├── Dockerfile
├── docker-compose.yml         # For local Mac testing
├── package.json
├── public/
│   ├── index.html             # Dashboard home page
│   ├── tools/
│   │   ├── ads.html           # Google Ads copy generator
│   │   ├── content.html       # Content generator
│   │   └── email.html         # Email digest
│   ├── style.css
│   └── app.js
└── src/
    ├── claude.js              # Claude API calls
    ├── drive.js               # Google Drive/Sheets/Docs
    ├── trello.js              # Trello integration
    └── gmail.js               # Gmail integration
```

---

## Dashboard (Phase 1)

The home page of the platform. Accessed at the root URL.

### Layout
- HOLO Digital logo/wordmark top left
- Clean card grid — one card per tool
- Each card shows: tool name, short description, a relevant icon, and a "Open" button
- A status indicator on each card (green = working, grey = coming soon)
- Responsive layout — works on mobile and desktop

### Cards to include from launch
| Tool | Description | Status |
|---|---|---|
| Google Ads Copy | Generate headlines and descriptions | Active |
| Content Generator | Generate location and service pages | Coming Soon |
| Email Digest | Morning email briefing and draft replies | Coming Soon |

### Design
- White background
- Accent colour: #FF497C
- Dark grey text
- Clean sans-serif font (Inter or system font)
- British English throughout

---

## Client Configuration

Stored in `clients.json` — mounted as a Docker volume so it can be edited without rebuilding.

```json
[
  {
    "id": "kremer-signs",
    "name": "Kremer Signs",
    "industry": "Sign manufacturing and estate agent boards",
    "toneOfVoice": "Professional, established, reliable. Never overly casual.",
    "services": ["estate agent boards", "commercial signage", "vehicle graphics"],
    "targetLocations": ["London", "Surrey", "Kent"],
    "avoidPhrases": [],
    "keyMessages": ["Fast turnaround", "UK manufactured", "Trusted by estate agents"],
    "googleDriveFolderId": "",
    "googleTrackingSheetId": "",
    "trelloBoardId": "",
    "trelloListId": "",
    "trelloVaAssigneeId": ""
  }
]
```

Initial clients:
- Kremer Signs
- Bison Plant Hire
- BKS Accounts
- SMS Locksmith / Earlsfield Locksmith
- T Brown & Sons
- Admiral Homespace
- Astrea London
- Buju

---

## Tool 1 — Google Ads Copy Generator (Phase 2)

### Purpose
Generate Google Ads headlines and descriptions for a given client, service and location.

### Build order
First build with Claude API only — no Drive or Trello. Get the generation working perfectly first. Add integrations in Phase 5.

### UI Fields
- Client (dropdown — populated from clients.json)
- Service (text input)
- Location (text input)
- Optional notes (textarea)

### Generation Requirements
Claude must generate:
- **15 headlines** — max 30 characters each (hard limit, never exceed)
- **4 descriptions** — max 90 characters each (hard limit, never exceed)
- All copy reflects the client's tone of voice, key messages and avoids flagged phrases
- Headlines: mix of service + location, USPs, CTAs
- Descriptions: expand on the service with a call to action

### Output Display
- Each headline shown with live character count (green = under 30, red = over)
- Each description with live character count (green = under 90, red = over)
- Inline editing of any item before saving
- Regenerate button
- Copy to clipboard button per item
- Save button (wired up in Phase 5)

---

## Tool 2 — Content Generator (Phase 3)

### Purpose
Generate SEO location pages and service pages for clients. Cross-references Google Drive to avoid duplicating existing content. Uses a client's Excel tracking sheet in Drive to determine what content needs to be created next.

### How the tracking sheet works
Some clients have an Excel file in their Google Drive folder. The sheet contains a list of locations or services with a column marking whether content has been done (e.g. "Yes" / blank). The tool reads this sheet, finds the next undone item, and queues it for generation.

Example sheet structure:
| Location | Done |
|---|---|
| Wandsworth | Yes |
| Vauxhall | Yes |
| Stockwell | |
| Brixton | |

The tool would identify Stockwell as next and pre-fill the generation form.

### UI Flow
1. Select client
2. Tool checks their Drive folder — lists existing content docs found
3. If a tracking sheet exists for that client, shows "Next up: [Location/Service]" with option to use it or override
4. If no tracking sheet, user inputs location/service manually
5. If content for that location already exists in Drive — warn the user with a link to the existing doc
6. Generate content
7. Review and approve
8. Save to Drive + mark as done in tracking sheet + create Trello task for VA

### Generation Requirements
- Full SEO location or service page
- Approx 600-800 words
- H1, H2 structure
- Written in the client's tone of voice
- Naturally includes the target location and service throughout
- Unique — Claude should be briefed to not repeat phrases or structure from existing docs (read a sample from Drive for reference)
- British English

### VA Workflow
The VA's only job from this tool is to add the generated content page to the client's website. The Trello card gives them:
- The content (link to Drive doc)
- The page title and URL slug suggestion
- Any notes on where it should sit in the site navigation

---

## Tool 3 — Email Digest (Phase 4)

### Purpose
Check Gmail at a set time each day, summarise unread client emails, and draft replies in Laurence's voice ready to review and send.

### Scheduled job
- Runs via node-cron inside the container
- Time configurable via environment variable
- Default: 1am UTC (8am Thailand time ICT UTC+7)

### Gmail behaviour
- Pulls unread emails from the last 24 hours
- Excludes newsletters, automated notifications and spam
- Groups by client where possible (cross-references clients.json)

### UI
- Email Digest tab in the main nav
- List of emails, each showing: sender, subject, one-line Claude summary
- Expand any email to see: full summary + drafted reply
- Edit the draft inline
- Send button (calls Gmail API to send reply in the same thread)
- Dismiss button (marks as handled, won't appear tomorrow)

### Draft reply style
Claude drafts replies in Laurence's voice:
- Starts with "Hi [First Name],"
- "I hope you are well." opener on first contact of the day
- Warm, efficient, professional
- British English
- Signs off "Many thanks / Laurence"
- No em dashes
- No corporate filler phrases

---

## Phase 5 — Drive + Trello Integration Across All Tools

Once tools are working with Claude API:

### Google Drive
- OAuth2 via Google Cloud Console (one-time setup)
- Scopes: `drive.file`, `documents`, `spreadsheets`
- Save generated content as Google Docs in client's configured folder
- Read and update Excel/Sheets tracking files

### Trello
- REST API with API key + token
- Create cards via `POST /1/cards`
- Card includes: title, content, label, VA assignee
- Labels: "Google Ads", "Content Page"
- VA only assigned on Content Generator cards (not Ads)

---

## Environment Variables

```
ANTHROPIC_API_KEY=
GOOGLE_CLIENT_ID=
GOOGLE_CLIENT_SECRET=
GOOGLE_REFRESH_TOKEN=
TRELLO_API_KEY=
TRELLO_TOKEN=
GMAIL_USER=
EMAIL_DIGEST_CRON=0 1 * * *
EMAIL_DIGEST_TIMEZONE=Asia/Bangkok
PORT=3000
```

---

## Docker Setup

### Dockerfile
- Base image: `node:20-alpine`
- No Chrome or Puppeteer — pure API app
- Expose port 3000

### docker-compose.yml (local Mac testing)
- Maps env vars from `.env`
- Mounts `clients.json` as a volume

### Unraid
- `clients.json` mounted from `/mnt/user/appdata/holo-tools/clients.json`
- Env vars set via Unraid container template UI
- Container set to always restart
- Watchtower handles auto-redeploy from GitHub

---

## Setup Task Checklist

Complete these steps before or alongside Claude Code development. Work through them in order.

### 1. GitHub
- [ ] Create a GitHub account at github.com if you don't have one
- [ ] Create a new private repository called `holo-tools`
- [ ] Install Git on your Mac if not already (`git --version` in terminal to check)
- [ ] Clone the empty repo to your Mac: `git clone https://github.com/[username]/holo-tools`
- [ ] Set up SSH key for GitHub so you don't need to enter password every push

### 2. GitHub Container Registry
- [ ] In GitHub → Settings → Developer Settings → Personal Access Tokens — create a token with `write:packages` permission
- [ ] Save this token — you'll need it for the GitHub Actions workflow
- [ ] Note your GitHub username — your Docker image will be at `ghcr.io/[username]/holo-tools`

### 3. Anthropic API
- [ ] Go to console.anthropic.com and create an API key
- [ ] Save it securely — goes in your `.env` as `ANTHROPIC_API_KEY`
- [ ] Add billing/credit card to your Anthropic account

### 4. Google Cloud Console (for Drive, Docs, Sheets, Gmail)
- [ ] Go to console.cloud.google.com
- [ ] Create a new project called "HOLO Tools"
- [ ] Enable these APIs: Gmail API, Google Drive API, Google Docs API, Google Sheets API
- [ ] Go to Credentials → Create OAuth 2.0 Client ID (Desktop app type)
- [ ] Download the credentials JSON file
- [ ] Run the OAuth flow once locally to generate a refresh token — Claude Code can generate a helper script for this
- [ ] Save Client ID, Client Secret and Refresh Token to your `.env`

### 5. Trello
- [ ] Go to trello.com/power-ups/admin and create a new Power-Up (this gives you an API key)
- [ ] Generate a Token at https://trello.com/1/authorize
- [ ] Save API key and Token to your `.env`
- [ ] For each client: note their Trello Board ID, List ID and VA Member ID — Claude Code can generate a helper script to fetch these via the Trello API

### 6. Cloudflare
- [ ] Create a free Cloudflare account at cloudflare.com
- [ ] Add your domain (holodigital.co.uk or similar) to Cloudflare — update nameservers at your domain registrar
- [ ] Go to Zero Trust → Tunnels → Create a tunnel called `holo-tools`
- [ ] Note the tunnel token — you'll use this when setting up the Cloudflare Tunnel Docker container on Unraid
- [ ] Set up a public hostname in the tunnel pointing to `localhost:3000`
- [ ] Optionally enable Cloudflare Access on that hostname for password protection

### 7. Unraid Setup
- [ ] Install the **Cloudflare Tunnel** Docker container via Community Applications — enter your tunnel token
- [ ] Install **Watchtower** Docker container — configure it to watch `ghcr.io/[username]/holo-tools`
- [ ] Create the app data folder: `/mnt/user/appdata/holo-tools/`
- [ ] Copy your `clients.json` to that folder
- [ ] Add the `holo-tools` container manually using the GitHub Container Registry image URL
- [ ] Enter all environment variables in the Unraid container template

### 8. DNS
- [ ] In Cloudflare DNS, confirm the tunnel hostname is resolving correctly
- [ ] Test by visiting your public URL from a different network or your phone

---

## Out of Scope (for now)

- Social media post publishing
- WhatsApp bot (separate project)
- Investment/trading tools
- Client login / multi-user access
- Analytics dashboard

---

## Success Criteria Per Phase

**Phase 1:** Dashboard loads at localhost:3000, shows tool cards, links work
**Phase 2:** Google Ads generator produces valid copy within character limits from any browser
**Phase 3:** Content generator reads Drive, checks for duplicates, reads tracking sheet, generates content
**Phase 4:** Email digest fires on schedule, UI shows summaries and drafts
**Phase 5:** Drive docs created, Trello cards assigned, tracking sheets updated
**Deploy:** Pushing to GitHub triggers auto-deploy to Unraid within 5 minutes
