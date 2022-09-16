# Development Setup

Welcome to the development page for Linear-GitHub sync.

If you need any help, please feel free to raise an [issue](https://github.com/calcom/linear-to-github/issues/new)!

## Getting Started

To clone the app,

```sh
git clone https://github.com/calcom/linear-to-github.git
cd linear-to-github/
cp .env.example .env
```

Before you start the server, you'll need to provision a simple DB to persist IDs. Don't sweat, [Railway](https://docs.railway.app/databases/postgresql) makes this easy:

1. Sign up for [Railway](https://railway.app/)
2. Click "Start a New Project" -> "Provision PostgreSQL"
3. Once the DB is ready, focus it -> go to "Connect" -> "Postgres Connection URL" -> hover to copy
4. Paste this URL (beginning with `postgresql://`) to the `DATABASE_URL` variable in `.env`.
5. Run `npx prisma migrate dev` to generate a table with the necessary fields.

To install dependencies and run the app locally,

```sh
pnpm i
pnpm dev
```

To receive webhooks locally, install [ngrok](https://ngrok.com) (`pnpm install -g ngrok`) then expose your local server with `ngrok http 3000` (or whichever port it's running on). This will give you a temporary public URL.

To obtain API keys and labels, follow the instructions at [localhost:3000](http://localhost:3000). To test the webhook consumer, you'll have to replace the default webhook URLs (`example.com`) with your ngrok URL from above. For Linear, go to Workspace Settings > API > Webhooks > edit. For GitHub, go to your chosen repo > Settings > Webhooks > edit.

That's it! Creating a GitHub issue in the synced repo should trigger a webhook to hit your API.

