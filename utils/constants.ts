import colors from "tailwindcss/colors";

export const LINEAR = {
    OAUTH_ID: process.env.NEXT_PUBLIC_LINEAR_OAUTH_ID,
    OAUTH_URL: "https://linear.app/oauth/authorize",
    TOKEN_URL: "https://api.linear.app/oauth/token",
    SCOPES: ["write"],
    NEW_TOKEN_URL: "https://linear.app/settings/api",
    TOKEN_SECTION_HEADER: "Personal API keys",
    GRAPHQL_ENDPOINT: "https://api.linear.app/graphql",
    IP_ORIGINS: ["35.231.147.226", "35.243.134.228"],
    STORAGE_KEY: "linear-context",
    APP_URL: "https://linear.app",
    GITHUB_LABEL: "linear"
};

export const SHARED = {
    PRIORITY_LABELS: {
        0: { name: "No priority", color: colors.gray["500"] },
        1: { name: "Urgent", color: colors.red["600"] },
        2: { name: "High priority", color: colors.orange["500"] },
        3: { name: "Medium priority", color: colors.yellow["500"] },
        4: { name: "Low priority", color: colors.green["600"] }
    }
};

export const GITHUB = {
    OAUTH_ID: process.env.NEXT_PUBLIC_GITHUB_OAUTH_ID,
    OAUTH_URL: "https://github.com/login/oauth/authorize",
    TOKEN_URL: "https://github.com/login/oauth/access_token",
    SCOPES: ["repo", "write:repo_hook", "read:user", "user:email"],
    NEW_TOKEN_URL: "https://github.com/settings/tokens/new",
    TOKEN_NOTE: "Linear-GitHub Sync",
    WEBHOOK_EVENTS: ["issues", "issue_comment", "label"],
    LIST_REPOS_ENDPOINT:
        "https://api.github.com/user/repos?per_page=100&sort=updated",
    USER_ENDPOINT: "https://api.github.com/user",
    REPO_ENDPOINT: "https://api.github.com/repos",
    ICON_URL:
        "https://cdn.discordapp.com/attachments/937628023497297930/988735284504043520/github.png",
    STORAGE_KEY: "github-context",
    UUID_SUFFIX: "decafbad"
};

export const TIMEOUTS = {
    DEFAULT: 3000
};

export const GENERAL = {
    APP_NAME: "Linear-GitHub Sync",
    APP_URL: "https://synclinear.com",
    CONTRIBUTE_URL: "https://github.com/calcom/linear-to-github",
    IMG_TAG_REGEX: /<img.*src=[\'|\"| ]?https?:\/\/(.*?)[\'|\"| ].*\/?>/g,
    LOGIN_KEY: "login",
    SYNCED_ITEMS: [
        {
            linearField: "Title",
            githubField: "Title",
            toGithub: true,
            toLinear: true
        },
        {
            linearField: "Description",
            githubField: "Description",
            toGithub: true,
            toLinear: true
        },
        {
            linearField: "Labels",
            githubField: "Labels",
            toGithub: true,
            notes: "GitHub labels will be created if they don't yet exist"
        },
        {
            linearField: "Assignee",
            githubField: "Assignee",
            toGithub: true,
            toLinear: true,
            notes: "For authenticated users only. Silently ignored otherwise."
        },
        {
            linearField: "Status",
            githubField: "State",
            toGithub: true,
            toLinear: true,
            notes: "eg. Closed issue in GitHub will be marked as Done in Linear"
        },
        {
            linearField: "Comments",
            githubField: "Comments",
            toGithub: true,
            toLinear: true,
            notes: "GitHub comments by non-members are ignored"
        },
        {
            linearField: "Priority",
            toGithub: true,
            githubField: "Label"
        },
        {
            linearField: "Cycle",
            githubField: "Milestone",
            toGithub: true,
            toLinear: true,
            notes: "Optional. Milestone due date syncs to cycle end date."
        }
    ]
};

