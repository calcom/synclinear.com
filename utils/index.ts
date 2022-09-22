import { createCipheriv, createDecipheriv, randomBytes } from "crypto";
import { NextApiRequest } from "next";
import {
    GitHubContext,
    GitHubRepo,
    LinearContext,
    LinearTeam
} from "../typings";
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

export const formatJSON = (body: Object): string => {
    return JSON.stringify(body, null, 4);
};

export const encrypt = (text: string): { hash: string; initVector: string } => {
    const algorithm = "aes-256-ctr";
    const secret = process.env.ENCRYPTION_KEY;

    const initVector = randomBytes(16);
    const cipher = createCipheriv(algorithm, secret, initVector);
    const encrypted = Buffer.concat([cipher.update(text), cipher.final()]);

    return {
        hash: encrypted.toString("hex"),
        initVector: initVector.toString("hex")
    };
};

export const decrypt = (content: string, initVector: string): string => {
    const algorithm = "aes-256-ctr";
    const secret = process.env.ENCRYPTION_KEY;

    const decipher = createDecipheriv(
        algorithm,
        secret,
        Buffer.from(initVector, "hex")
    );
    const decrypted = Buffer.concat([
        decipher.update(Buffer.from(content, "hex")),
        decipher.final()
    ]);

    return decrypted.toString();
};

export const getLinearTokenURL = (): string => {
    const baseURL = LINEAR.NEW_TOKEN_URL;
    const sectionSelector = `#:~:text=${LINEAR.TOKEN_SECTION_HEADER.split(
        " "
    ).join("%20")}`;
    const tokenURL = `${baseURL}${sectionSelector}`;

    return tokenURL;
};

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

export const saveLinearContext = async (token: string, team: LinearTeam) => {
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
        teamId: team.id,
        teamName: team.name,
        publicLabelId: labels.find(n => n.name === "Public")?.id,
        canceledStateId: labels.find(n => n.name === "Canceled")?.id,
        doneStateId: labels.find(n => n.name === "Done")?.id,
        toDoStateId: labels.find(n => n.name === "Todo")?.id
    };

    const response = await fetch("/api/linear/save", {
        method: "POST",
        body: JSON.stringify(data)
    });

    return response.json();
};

export const getLinearFooter = (sender: {
    login: string;
    html_url: string;
}): string => {
    return `\n[${sender.login}](${sender.html_url}) on GitHub`;
};

export const getGitHubFooter = (userName: string): string => {
    return `\n<sub>${userName} on Linear</sub>`;
};

export const getSyncFooter = (): string => {
    return `\nFrom Linear-GitHub Sync`;
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

export const saveGitHubContext = async (repo: GitHubRepo) => {
    const data = {
        repoId: repo.id,
        repoName: repo.name
    };

    const response = await fetch("/api/github/save", {
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

export const saveSync = async (
    linearContext: LinearContext,
    githubContext: GitHubContext
) => {
    const data = {
        github: { ...githubContext },
        linear: { ...linearContext }
    };

    const response = await fetch("/api/save", {
        method: "POST",
        body: JSON.stringify(data)
    });

    return response.json();
};

export const getAttachmentQuery = (
    issueId: string,
    issueNumber: number,
    repoFullName: string
): string => {
    return `mutation {
        attachmentCreate(input:{
            issueId: "${issueId}"
            title: "GitHub Issue #${issueNumber}"
            subtitle: "Synchronized"
            url: "https://github.com/${repoFullName}/issues/${issueNumber}"
            iconUrl: "${GITHUB.ICON_URL}"
        }) {
            success
            attachment {
                id
            }
        }
    }`;
};

export const isIssue = (req: NextApiRequest): boolean => {
    return req.headers["x-github-event"] === "issues";
};

export const skipReason = (
    event: "issue" | "edit" | "comment" | "state change" | "label",
    issueNumber: number | string,
    causedBySync: boolean = false
): string => {
    return `Skipping over ${event} for issue #${issueNumber} as it is ${
        causedBySync ? "caused by sync" : "not synced"
    }.`;
};
