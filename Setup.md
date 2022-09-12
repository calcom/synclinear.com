# Setup

Welcome to the installation page for Linear-GitHub sync.

If you need any help, please feel free to raise an issue!

## Getting Started

Before you've started the server, make sure to fill out the `.env` file (see [below](#linear-ids)).

To run the app locally,

```
git clone https://github.com/calcom/linear-to-github.git
cd linear-to-github/
cp .env.example .env # Make sure to fill out your .env file
pnpm i
pnpm start:dev
```

To receive webhooks locally, install [ngrok](https://ngrok.com) (`pnpm install -g ngrok`) then expose your local server with `ngrok http 3000` (or whichever port it's running on). This will give you a temporary public URL.

## Linear

### Linear Webhook

1. Go to "Workspace Settings" and then go to "API".
2. Under "Webhooks" click "New webhook".
3. Label this webhook whatever you want, however, set the URL to the URL of the API (Vercel or ngrok), ensuring the URL ends with "/api".
4. Under "Event Types" check "Issues", "Issue comments", and "Labels".
5. Press "Create webhook".

### Linear API Key

1. Go to "Workspace Settings" and then go to "API".
2. Under "Personal API keys" enter a name for your API key in the "Label" field.
3. Press "Create key".
4. Hover over the created API key to copy it. Make sure to save this somewhere as you can only view it upon creation.

### Linear IDs

To get all of the IDs needed from Linear run the following GraphQL request however you please ([Apollo Studio](https://studio.apollographql.com) for example). We're looking for a way to automate this step.

Make sure to have your "Authorization" header set to `Bearer ${LINEAR_API_KEY}` and "Content-Type" as `application/json`.

```
query {
	users {
		nodes {
			id
			name
			displayName
		}
	}
	teams {
		nodes {
			id
			name
			key
			labels {
				nodes {
					id
					name
				}
			}
			states {
				nodes {
					id
					name
				}
			}
		}
	}
}
```

## GitHub

### GitHub Webhook

1. In a repository go to "Settings" -> "Webhooks".
2. Press "Add webhook".
3. Set the payload URL to the URL of the API (Vercel or ngrok), ensuring the URL ends with "/api".
4. Set "Content type" to `application/json`.
5. Set the "Secret" to a random string, make sure to set it in the .env file as well.
6. Press "Let me select individual events." and check "Issue comments" and "Issues".
7. Press "Add webhook"

### GitHub API Key

1. Log in to the account you want to use for syncing.
2. Click on the dropdown in the top right where your profile picture is.
3. Press "Settings" -> "Developer Settings" -> "Personal Access Tokens".
4. Press "Generate new token".
5. Write a memorable note.
6. Set Expiration to "No Expiration".
7. Check all top-level scopes. <sub>I wasn't able to figure out which scopes properly worked with both public and private repositories, if you have please feel free to make an issue!</sub>
8. Press "Generate token".
9. Copy the generated token.

## Database

### PostgreSQL Instance

To persist synced issues, you'll need to provision a simple PostgreSQL instance. [Railway](https://docs.railway.app/databases/postgresql) makes this easy:

1. Sign up for [Railway](https://railway.app/)
2. Click "Start a New Project" -> "Provision PostgreSQL"
3. Once the DB is ready, focus it -> go to "Connect" -> "Postgres Connection URL" -> hover to copy
4. Paste this URL (beginning with `postgresql://`) to the `DATABASE_URL` variable in `.env`.
5. Run `npx prisma migrate dev` to generate a table with the necessary fields.

That's it! If your `.env` is populated, creating a GitHub issue in the synced repo should trigger a webhook to hit your API.

