import { GitHubRepo, LinearTeam } from "../typings";
import { linearQuery } from "./apollo";
import { GITHUB, LINEAR } from "./constants";

export const isDev = (): boolean => {
    return process.env.NODE_ENV === "development";
};

export const getWebhookURL = (): string => {
    if (isDev()) return "https://example.com";
    return `${window.location.origin}/api`;
};

export const copyToClipboard = (text: string) => {
    if (!window?.navigator) alert("Cannot copy to clipboard");

    navigator?.clipboard?.writeText(text);
};

export const getLinearTokenURL = (): string => {
    const baseURL = LINEAR.NEW_TOKEN_URL;
    const sectionSelector = `#:~:text=${LINEAR.TOKEN_SECTION_HEADER.split(
        " "
    ).join("%20")}`;
    const tokenURL = `${baseURL}${sectionSelector}`;

    return tokenURL;
};

export const getLinearContext = async (token: string) => {
    const query = `query {
        teams {
            nodes {
                name
                id
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

export const createLinearPublicLabel = async (
    token: string,
    teamID: string
) => {
    const mutation = `mutation CreateLabel($teamID: String!) {
        issueLabelCreate(
            input: {
                name: "Public"
                color: "#2DA54E"
                teamId: $teamID
            }
        ) {
            success
            issueLabel {
                id
                name
            }
        }
    }`;

    return await linearQuery(mutation, token, { teamID });
};

// TODO: extend this to save all Linear context (team ID, user ID, and labels)
export const saveLinearLabels = async (token: string, team: LinearTeam) => {
    const labels = [
        ...(team.states?.nodes ?? []),
        ...(team.labels?.nodes ?? [])
    ];

    if (!labels.find(n => n.name === "Public")) {
        const { data } = await createLinearPublicLabel(token, team.id);

        if (!data?.issueLabelCreate?.issueLabel)
            alert('Please create a Linear label called "Public"');

        labels.push(data?.issueLabelCreate?.issueLabel);
    }

    const data = {
        publicLabelId: labels.find(n => n.name === "Public")?.id,
        canceledStateId: labels.find(n => n.name === "Canceled")?.id,
        doneStateId: labels.find(n => n.name === "Done")?.id,
        toDoStateId: labels.find(n => n.name === "Todo")?.id,
        inProgressStateId: labels.find(n => n.name === "In Progress")?.id
    };

    const response = await fetch("/api/labels/", {
        method: "POST",
        body: JSON.stringify(data)
    });

    return response.json();
};

export const getGitHubTokenURL = (): string => {
    const scopes = GITHUB.SCOPES.join(",");
    const description = GITHUB.TOKEN_NOTE.split(" ").join("%20");
    const tokenURL = `${GITHUB.NEW_TOKEN_URL}?scopes=${scopes}&description=${description}`;

    return tokenURL;
};

export const saveGitHubContext = async (
    repo: GitHubRepo,
    webhookSecret: string
) => {
    const data = {
        repoId: repo.id,
        name: repo.name,
        webhookSecret
    };

    const response = await fetch("/api/github-context", {
        method: "POST",
        body: JSON.stringify(data)
    });

    return response.json();
};

export const setGitHubWebook = async (
    token: string,
    repo: GitHubRepo,
    webhookSecret: string
) => {
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

    return await fetch(`https://api.github.com/repos/${repo.name}/hooks`, {
        method: "POST",
        headers: {
            Authorization: `Bearer ${token}`,
            Accept: "application/vnd.github+json"
        },
        body: JSON.stringify(webhookData)
    });
};

