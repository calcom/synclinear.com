<img src="https://user-images.githubusercontent.com/8019099/188273531-5ce9fa14-b8cf-4c9b-994b-2e00e3e5d537.png" width="100%" />

Initially created by [Spacedrive](https://github.com/spacedriveapp/linear-github-sync), now maintained by [Cal.com](https://cal.com/) and [Neat.run](https://neat.run/)

# Linear to GitHub Sync

This is a system to synchronize Linear issues to GitHub issues when a specific tag tag is added to the Linear issue. This allows contributors to work with open source projects without having to give them access to your internal Linear team.

## Usage

Ensure you have the [Vercel CLI](https://vercel.com/docs/cli) installed globally on your machine!

```
git clone https://github.com/calcom/linear-to-github.git
cd linear-to-github/
cp .env.example .env # Make sure to fill to fill out your .env file
pnpm i
vercel dev
```

Before you've started the server make sure to fill out the information in the `.env` file, if you don't know how:

# Setup

Welcome to the installation page for Spacedrive's Linear and GitHub sync system.

You'll be able to follow along with this guide below, if you need any help please feel free to join our [Discord](https://discord.gg/XzDj6gXf28).

## Linear

### Linear Webhook

1. Go to "Workspace Settings" and then go to "API".
2. Under "Webhooks" click "New webhook".
3. Label this webhook whatever you want, however, set the URL to the URL of the deployed Vercel API, ensuring the URL ends with "/api".
4. Under "Event Types" check "Issues", "Issue comments", and "Labels".
5. Press "Create webhook".

### Linear API Key

1. Go to "Workspace Settings" and then go to "API".
2. Under "Personal API keys" enter a name for your API key in the "Label" field.
3. Press "Create key".
4. Hover over the created API key to copy it, make sure to save this somewhere as you can only view it upon creation.

### Linear IDs

To get all of the IDs needed from Linear run the following GQL request however you please. Make sure to have your "Authorization" header set to `Bearer ${LINEAR_API_KEY}` and "Content-Type" as `application/json`.

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
3. Set the payload URL to the URL of the deployed Vercel API, ensuring the URL ends with "/api".
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
7. Check all top-level scopes <sub>I wasn't able to figure out which scopes properly worked with both public and private repositories, if you have please feel free to make an issue!</sub>
8. Press "Generate token".
9. Copy the generated token.

