export const LINEAR = {
    SCOPES: ["write"],
    OAUTH_ID: "5025b476050c4cf25e36700b99ea9bad",
    NEW_TOKEN_URL: "https://linear.app/settings/api",
    TOKEN_SECTION_HEADER: "Personal API keys",
    GRAPHQL_ENDPOINT: "https://api.linear.app/graphql"
};

export const GITHUB = {
    OAUTH_ID: "487937ed57e1d5ffea0d",
    OAUTH_URL: "https://github.com/login/oauth/authorize",
    TOKEN_URL: "https://github.com/login/oauth/access_token",
    NEW_TOKEN_URL: "https://github.com/settings/tokens/new",
    SCOPES: ["repo", "write:repo_hook", "read:user", "user:email"],
    TOKEN_NOTE: "Linear-GitHub Sync",
    WEBHOOK_EVENTS: ["issues", "issue_comment", "label"],
    LIST_REPOS_ENDPOINT: "https://api.github.com/user/repos?per_page=100"
};

export const TIMEOUTS = {
    DEFAULT: 3000
};

