# Self-Hosting Setup

Welcome to the self-hosting page for **SyncLinear.com**. If something doesn't seem right, please feel free to [open a PR](https://github.com/calcom/synclinear.com/pulls) or [raise an issue](https://github.com/calcom/linear-to-github/issues/new)!

## Getting Started

### Environment Variables

1. Copy the environment file with `cp .env.example .env`
2. If you'll be sharing your instance with teammates, you'll need to create OAuth apps for both GitHub (under your org > developer settings) and [Linear](https://linear.app/settings/api/applications/new). Replace `NEXT_PUBLIC_LINEAR_OAUTH_ID` and `NEXT_PUBLIC_GITHUB_OAUTH_ID` with your OAuth app IDs (safe to share publicly). Populate the `GITHUB_OAUTH_SECRET` and `LINEAR_OAUTH_SECRET` environment variables ([.env](/.env.example)) with your OAuth secrets. Keep these secret!
3. Generate an `ENCRYPTION_KEY` by running `node` in a terminal then `crypto.randomBytes(16).toString("hex")`.

### Database

To persist IDs, you'll need to provision a simple SQL database. One easy option is [Railway](https://docs.railway.app/databases/postgresql):

1. Click "Start a New Project" → "Provision PostgreSQL" (no sign-up required yet)
2. Once the DB is ready, focus it → go to "Connect" → "Postgres Connection URL" → hover to copy this URL. It should look like `postgresql://postgres:pass@region.railway.app:1234/railway`.

To point the app to your database,

1. Paste the connection URL (from step 3 above if you're using Railway) to the `DATABASE_URL` variable in `.env`
2. Run `npx prisma migrate dev` to generate tables with the necessary columns
3. Run `npx prisma generate` to generate the [ORM](https://www.prisma.io/) for your database

### Running the app

1. Install dependencies with `npm i`
2. To start the app locally, run `npm dev`
3. To receive webhooks locally, expose your local server with `ngrok http 3000` (or the port it's running on). This will give you a temporary public URL.
4. To start syncing repos to Linear teams, follow the auth flow at that URL

---

That's it! Try creating a Linear issue with the `Public` tag to trigger the webhook and generate a GitHub issue.

> **Warning** 
> Manually modifying a webhook may break the sync.