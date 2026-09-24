# MortgageWatch

Weekly mortgage rate tracker. Fetches current US rates every Friday at 9 AM Chicago time, sends an SMS with current rates + 7/14/30-day changes, and — if you've locked in a rate — tells you whether refinancing is worth checking into.

## Repo structure

```
mortgage-watch/
├── .github/workflows/main.yml          ← GitHub Action (runs weekly)
├── scripts/fetch-and-notify.js         ← main script
├── data/history.json                   ← auto-updated rate log
├── data/mortgage-config.json           ← your loan details (edit by hand)
├── index.html                          ← browser dashboard
└── package.json
```

## Setup (one time)

### 1. Create the GitHub repo

1. Go to github.com → New repository → name it `mortgage-watch`
2. Upload all files from this folder, keeping the folder structure intact
3. Make sure `data/history.json` is included (it starts as `[]`)

### 2. Add GitHub Secrets

Go to your repo → **Settings → Secrets and variables → Actions → New repository secret**

Add these secrets:

| Secret name | Where to find it |
|---|---|
| `ANTHROPIC_API_KEY` | console.anthropic.com → API Keys |
| `FRED_API_KEY` | fred.stlouisfed.org → My Account → API Keys (free) |
| `TWILIO_ACCOUNT_SID` | Twilio Console dashboard |
| `TWILIO_AUTH_TOKEN` | Twilio Console dashboard |
| `TWILIO_FROM_NUMBER` | Your Twilio phone number (e.g. +12125551234) |
| `TWILIO_TO_NUMBER` | Your personal mobile number (e.g. +13125559876) |

#### Optional: refi tracking

Edit `data/mortgage-config.json` with your loan details (pulled from your servicer's dashboard) and every SMS will tell you whether refinancing is worth checking into, with your estimated monthly savings and breakeven period:

```json
{
  "yourRate": 6.99,
  "loanBalance": 530125.23,
  "monthlyPI": 3529.19,
  "paymentsRemaining": 359,
  "asOfDate": "2026-09-24",
  "closingCostPct": 0.02,
  "refiThresholdPct": 0.75
}
```

| Field | Meaning |
|---|---|
| `yourRate` | Your locked-in rate |
| `loanBalance` | Current principal balance |
| `monthlyPI` | Principal + interest only — **exclude escrow/taxes/insurance** |
| `paymentsRemaining` | Payments left on the loan |
| `asOfDate` | Date those numbers are from |
| `closingCostPct` | Assumed refi closing costs as a fraction of balance (default 2%) |
| `refiThresholdPct` | Flag a refi once market is this many points below your rate (default 0.75) |

**Update `loanBalance`, `monthlyPI`, `paymentsRemaining`, and `asOfDate` whenever you check a new statement** — the script doesn't call your servicer, so accuracy drifts over time between updates. `paymentsRemaining` is adjusted automatically for elapsed months between runs, but the balance is a static snapshot.

This file is committed to the repo (not a GitHub secret), so it's visible to anyone who can see the repository — including a published GitHub Pages site, if you turn that on. Delete the file (or omit it) to disable refi tracking entirely.

### 3. Enable GitHub Actions

Go to your repo → **Actions tab** → click "I understand my workflows, go ahead and enable them"

### 4. Test it manually

Go to **Actions → Daily Mortgage Rate SMS → Run workflow** to trigger it immediately and confirm you get an SMS before waiting until 9 AM.

### 5. Publish the dashboard (optional)

Go to **Settings → Pages → Source: Deploy from branch → main → / (root)** → Save.
Your dashboard will be live at `https://yourusername.github.io/mortgage-watch`

## Schedule

Runs Fridays at 9 AM Chicago time (CDT/UTC-5 in summer = 14:00 UTC), matching Freddie Mac's weekly survey release.
In winter (CST/UTC-6) it will arrive at 8 AM — edit the cron line in
`.github/workflows/main.yml` to `0 15 * * 5` from November to March.

## Rate history

`data/history.json` is automatically updated by the Action after each run and committed back to the repo. The 7/14/30-day change figures in the SMS are computed from this file, so they improve over time as more data accumulates. Each entry also stores that week's AI market analysis/outlook and (if refi tracking is set up) your rate spread and verdict — the dashboard reads this file directly rather than calling any API from the browser.
