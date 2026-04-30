# MortgageWatch

Daily mortgage rate tracker. Fetches live US rates every weekday at 9 AM Chicago time and sends an SMS with current rates + 7/14/30-day changes.

## Repo structure

```
mortgage-watch/
├── .github/workflows/daily-rates.yml   ← GitHub Action (runs daily)
├── scripts/fetch-and-notify.js         ← main script
├── data/history.json                   ← auto-updated rate log
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

Add these 5 secrets:

| Secret name | Where to find it |
|---|---|
| `ANTHROPIC_API_KEY` | console.anthropic.com → API Keys |
| `TWILIO_ACCOUNT_SID` | Twilio Console dashboard |
| `TWILIO_AUTH_TOKEN` | Twilio Console dashboard |
| `TWILIO_FROM_NUMBER` | Your Twilio phone number (e.g. +12125551234) |
| `TWILIO_TO_NUMBER` | Your personal mobile number (e.g. +13125559876) |

### 3. Enable GitHub Actions

Go to your repo → **Actions tab** → click "I understand my workflows, go ahead and enable them"

### 4. Test it manually

Go to **Actions → Daily Mortgage Rate SMS → Run workflow** to trigger it immediately and confirm you get an SMS before waiting until 9 AM.

### 5. Publish the dashboard (optional)

Go to **Settings → Pages → Source: Deploy from branch → main → / (root)** → Save.
Your dashboard will be live at `https://yourusername.github.io/mortgage-watch`

## Schedule

Runs weekdays at 9 AM Chicago time (CDT/UTC-5 in summer = 14:00 UTC).
In winter (CST/UTC-6) it will arrive at 8 AM — edit the cron line in
`.github/workflows/daily-rates.yml` to `0 15 * * 1-5` from November to March.

## Rate history

`data/history.json` is automatically updated by the Action after each run and committed back to the repo. The 7/14/30-day change figures in the SMS are computed from this file, so they improve over time as more data accumulates.
