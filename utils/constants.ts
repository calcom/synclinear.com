export const LINEAR = {
    OAUTH_ID: "de24196afa78e6f3f99875b753a3ae29",
    OAUTH_URL: "https://linear.app/oauth/authorize",
    TOKEN_URL: "https://api.linear.app/oauth/token",
    SCOPES: ["write"],
    NEW_TOKEN_URL: "https://linear.app/settings/api",
    TOKEN_SECTION_HEADER: "Personal API keys",
    GRAPHQL_ENDPOINT: "https://api.linear.app/graphql"
};

export const GITHUB = {
    OAUTH_ID: "487937ed57e1d5ffea0d",
    OAUTH_URL: "https://github.com/login/oauth/authorize",
    TOKEN_URL: "https://github.com/login/oauth/access_token",
    SCOPES: ["repo", "write:repo_hook", "read:user", "user:email"],
    NEW_TOKEN_URL: "https://github.com/settings/tokens/new",
    TOKEN_NOTE: "Linear-GitHub Sync",
    WEBHOOK_EVENTS: ["issues", "issue_comment", "label"],
    LIST_REPOS_ENDPOINT: "https://api.github.com/user/repos?per_page=100",
    USER_ENDPOINT: "https://api.github.com/user",
    ICON_URL:
        "https://cdn.discordapp.com/attachments/937628023497297930/988735284504043520/github.png"
};

export const TIMEOUTS = {
    DEFAULT: 3000
};

