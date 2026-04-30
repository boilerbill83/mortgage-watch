{
  "name": "mortgage-watch",
  "version": "1.0.0",
  "description": "Daily mortgage rate tracker with SMS alerts",
  "private": true,
  "scripts": {
    "fetch": "node scripts/fetch-and-notify.js"
  },
  "dependencies": {
    "@anthropic-ai/sdk": "^0.27.0",
    "twilio": "^5.3.0"
  },
  "type": "module"
}