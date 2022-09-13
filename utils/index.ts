import { linearQuery } from "./apollo";
import { GITHUB, LINEAR } from "./constants";

export const getLinearAuthURL = (verificationCode: string): string => {
    // Specify OAuth app and scopes
    const params = {
        client_id: LINEAR.OAUTH_ID,
        redirect_uri: window.location.origin,
        scope: LINEAR.SCOPES.join(","),
        state: verificationCode,
        response_type: "code",
        prompt: "consent"
    };

    // Combine params in a URL-friendly string
    const authURL = Object.keys(params).reduce(
        (url, param, i) =>
            `${url}${i == 0 ? "?" : "&"}${param}=${params[param]}`,
        LINEAR.OAUTH_URL
    );

    return authURL;
};

export const getLinearContext = async (token: string) => {
    const query = `query {
        projects {
            nodes {
                name
                id
            }
        }
        teams {
            nodes {
                name
                id
            }
        }
        viewer {
            name
            id
        }
    }`;

    return await linearQuery(query, token);
};

export const setLinearWebhook = async (
    token: string,
    callbackURL: string,
    teamID: string
) => {
    const mutation = `mutation CreateWebhook($callbackURL: String!, $teamID: String) {
        webhookCreate(
            input: {
                url: $callbackURL
                teamId: $teamID
                label: "GitHub Sync"
                resourceTypes: ["Issue", "Comment", "IssueLabel"]
            }
        ) {
            success
            webhook {
            id
            enabled
            }
        }
    }`;

    return await linearQuery(mutation, token, { callbackURL, teamID });
};

export const getGitHubTokenURL = (): string => {
    const scopes = GITHUB.SCOPES.join(",");
    const description = GITHUB.TOKEN_NOTE.split(" ").join("%20");
    const tokenURL = `${GITHUB.NEW_TOKEN_URL}?scopes=${scopes}&description=${description}`;

    return tokenURL;
};

export const copyToClipboard = (text: string) => {
    if (!window?.navigator) {
        throw new Error("window.navigator is not defined");
    }

    navigator?.clipboard?.writeText(text);
};

