# HOLO Tools — Claude Code Context

## Project
Internal tool platform for HOLO Digital Ltd, a UK marketing agency.
Built with Node.js + Express. Served from Docker on Unraid via Cloudflare Tunnel.

## Current Phase
**Phases 1-3 complete.** Content generator has batch mode, blog posts, formatted docs, auto-tracking sheets, usage dashboard.
Next: **Phase 4** — Email Digest (Gmail API + node-cron)

## Phase Roadmap
- Phase 1: Project setup + Dashboard UI + GitHub workflow ✅
- Phase 2: Tool 1 — Google Ads Copy Generator ✅
- Phase 3: Tool 2 — Content Generator (location pages, blog posts, Drive integration, tracking sheets) ✅
- Phase 4: Tool 3 — Email Digest (Gmail API + node-cron scheduler)
- Phase 5: Trello integration across all tools

## Rules
- British English throughout — no American spellings
- Build one phase at a time — fully working and tested before moving on
- Never commit `.env` — credentials via environment variables only
- Character hard limits: ad headlines max 30 chars, descriptions max 90 chars
- `clients.json` is the source of truth for all client config (Docker volume mount on Unraid)
- Each phase must be committed to GitHub before the next begins

## Design Tokens
- Accent: `#FF497C`
- Text: `#1a1a1a`
- Muted text: `#6b7280`
- Border: `#e5e7eb`
- Background subtle: `#f9fafb`
- Font: Inter (Google Fonts), fallback system-ui

## Tech Stack
- Node.js + Express (`server.js`)
- Vanilla HTML/CSS/JS (`public/`)
- Claude API (`src/claude.js`) — Phase 2+
- Google Drive/Sheets/Docs (`src/drive.js`) — Phase 3+
- Gmail (`src/gmail.js`) — Phase 4+
- Trello (`src/trello.js`) — Phase 5+
- Docker base image: `node:20-alpine`
- GitHub Actions → ghcr.io → Unraid Watchtower auto-deploy

## Deployment Flow
Push to `main` → GitHub Action builds Docker image → pushes to `ghcr.io/[username]/holo-tools:latest` → Watchtower on Unraid detects new image → container redeploys automatically

## Key Files
- `clients.json` — client config, mounted as Docker volume (Unraid path: `/mnt/user/appdata/holo-tools/clients.json`)
- `.env` — credentials, never committed (see `.env.example`)
- `server.js` — Express server + all API routes
- `public/` — static frontend (HTML, CSS, JS)
- `src/` — backend integrations added per phase

## Client Config Fields (clients.json)
Each client has: `id`, `name`, `industry`, `toneOfVoice`, `services[]`, `targetLocations[]`, `avoidPhrases[]`, `keyMessages[]`, `googleDriveFolderId`, `googleTrackingSheetId`, `trelloBoardId`, `trelloListId`, `trelloVaAssigneeId`

## Email Digest Voice (Phase 4)
Draft replies in Laurence's voice:
- Starts with "Hi [First Name],"
- "I hope you are well." opener on first contact of the day
- Warm, efficient, professional — British English
- Signs off "Many thanks / Laurence"
- No em dashes, no corporate filler phrases
