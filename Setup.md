# Development Setup

Welcome to the development page for Linear-GitHub sync. If you need any help, please feel free to raise an [issue](https://github.com/calcom/linear-to-github/issues/new)!

### Getting Started

First, copy the environment file with `cp .env.example .env`. Install dependencies with `pnpm i`.

### Database

Before you start the server, you'll need to provision a simple DB to persist IDs. Don't sweat - [Railway](https://docs.railway.app/databases/postgresql) makes this easy:

1. Sign up for [Railway](https://railway.app/)
2. Click "Start a New Project" → "Provision PostgreSQL"
3. Once the DB is ready, focus it → go to "Connect" → "Postgres Connection URL" → hover to copy
4. Paste this URL (beginning with `postgresql://`) to the `DATABASE_URL` variable in `.env`
5. Run `npx prisma migrate dev` to generate tables with the necessary fields
6. Run `npx prisma generate` to access Prisma's typesafety and intellisense

### Running the app

To start the app locally, run `pnpm dev`.

To receive webhooks locally, expose your local server with `ngrok http 3000` (or whichever port it's running on). This will give you a temporary public URL.

To obtain API keys and labels, follow the auth flow at that URL.

---

That's it! Try creating a Linear issue with the `Public` tag to trigger the webhook and generate a GitHub issue.
