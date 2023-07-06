import { GitHubRepo, MilestoneState } from "../typings";
import { getWebhookURL } from ".";
import { GITHUB } from "./constants";

export const getGitHubFooter = (userName: string): string => {
    // To avoid exposing a user email if their username is an email address
    const sanitizedUsername = userName.split("@")?.[0];

    return `\n\n<!-- From ${sanitizedUsername} on Linear -->`;
};

export const getGitHubTokenURL = (): string => {
    const scopes = GITHUB.SCOPES.join(",");
    const description = GITHUB.TOKEN_NOTE.split(" ").join("%20");
    const tokenURL = `${GITHUB.NEW_TOKEN_URL}?scopes=${scopes}&description=${description}`;

    return tokenURL;
};

export const getGitHubAuthURL = (verificationCode: string): string => {
    // Specify OAuth app and scopes
    const params = {
        client_id: GITHUB.OAUTH_ID,
        redirect_uri: window.location.origin,
        scope: GITHUB.SCOPES.join(" "),
        state: verificationCode
    };

    // Combine params in a URL-friendly string
    const authURL = Object.keys(params).reduce(
        (url, param, i) =>
            `${url}${i == 0 ? "?" : "&"}${param}=${params[param]}`,
        GITHUB.OAUTH_URL
    );

    return authURL;
};

export const saveGitHubContext = async (
    repo: GitHubRepo,
    webhookSecret: string
) => {
    const data = {
        repoId: repo.id,
        repoName: repo.name,
        webhookSecret
    };

    const response = await fetch("/api/github/save", {
        method: "POST",
        body: JSON.stringify(data)
    });

    return response.json();
};

export const getRepoWebhook = async (
    repoName: string,
    token: string
): Promise<any> => {
    const webhookUrl = getWebhookURL();

    const response = await fetch(`/api/github/webhook`, {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`
        },
        body: JSON.stringify({
            repoName,
            webhookUrl
        })
    });

    return await response.json();
};

export const setGitHubWebook = async (
    token: string,
    repo: GitHubRepo,
    webhookSecret: string
): Promise<any> => {
    const webhookURL = getWebhookURL();
    const webhookData = {
        name: "web",
        active: true,
        events: GITHUB.WEBHOOK_EVENTS,
        config: {
            url: webhookURL,
            content_type: "json",
            insecure_ssl: "0",
            secret: webhookSecret
        }
    };

    const response = await fetch(
        `https://api.github.com/repos/${repo.name}/hooks`,
        {
            method: "POST",
            headers: {
                Authorization: `Bearer ${token}`,
                Accept: "application/vnd.github+json"
            },
            body: JSON.stringify(webhookData)
        }
    );

    return await response.json();
};

export const updateGitHubWebhook = async (
    token: string,
    repoName: string,
    updates: { add_events?: string[]; remove_events?: string[] }
): Promise<any> => {
    const webhook = await getRepoWebhook(repoName, token);
    if (!webhook.id) {
        console.error(`Could not find webhook for ${repoName}.`);
        return;
    }

    const response = await fetch(
        `https://api.github.com/repos/${repoName}/hooks/${webhook.id}`,
        {
            method: "PATCH",
            headers: {
                Authorization: `Bearer ${token}`,
                Accept: "application/vnd.github+json"
            },
            body: JSON.stringify(updates)
        }
    );

    return await response.json();
};

export const exchangeGitHubToken = async (
    refreshToken: string
): Promise<any> => {
    const redirectURI = window.location.origin;

    const response = await fetch("/api/github/token", {
        method: "POST",
        body: JSON.stringify({ refreshToken, redirectURI }),
        headers: { "Content-Type": "application/json" }
    });

    return await response.json();
};

export const listReposForUser = async (
    token: string,
    page = 0
): Promise<any> => {
    const response = await fetch(
        `${GITHUB.LIST_REPOS_ENDPOINT}&page=${page + 1}`,
        {
            headers: { Authorization: `Bearer ${token}` }
        }
    );

    return await response.json();
};

export const getGitHubUser = async (token: string): Promise<any> => {
    const response = await fetch(GITHUB.USER_ENDPOINT, {
        headers: { Authorization: `Bearer ${token}` }
    });

    return await response.json();
};

export const createMilestone = async (
    token: string,
    repoName: string,
    title: string,
    description?: string,
    state?: MilestoneState
): Promise<{ milestoneId: number }> => {
    const milestoneData = {
        title,
        state: state || "open",
        ...(description && { description })
    };

    const response = await fetch(
        `https://api.github.com/repos/${repoName}/milestones`,
        {
            method: "POST",
            headers: {
                Authorization: `Bearer ${token}`,
                Accept: "application/vnd.github+json"
            },
            body: JSON.stringify(milestoneData)
        }
    );

    const responseBody = await response.json();

    return { milestoneId: responseBody?.number };
};

export const updateMilestone = async (
    token: string,
    repoName: string,
    milestoneId: number,
    title?: string,
    state?: MilestoneState,
    description?: string
): Promise<any> => {
    const milestoneData = {
        ...(title && { title }),
        ...(state && { state }),
        ...(description && { description })
    };

    const response = await fetch(
        `https://api.github.com/repos/${repoName}/milestones/${milestoneId}`,
        {
            method: "PATCH",
            headers: {
                Authorization: `Bearer ${token}`,
                Accept: "application/vnd.github+json"
            },
            body: JSON.stringify(milestoneData)
        }
    );

    return response;
};

export const setIssueMilestone = async (
    token: string,
    repoName: string,
    issueNumber: number,
    milestoneId: number | null
): Promise<any> => {
    const response = await fetch(
        `https://api.github.com/repos/${repoName}/issues/${issueNumber}`,
        {
            headers: {
                Authorization: `Bearer ${token}`,
                Accept: "application/vnd.github+json"
            },
            method: "PATCH",
            body: JSON.stringify({ milestone: milestoneId })
        }
    );

    return response;
};

