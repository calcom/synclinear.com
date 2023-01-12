import { LinearClient } from "@linear/sdk";
import { getWebhookURL, getSyncFooter } from ".";
import { linearQuery } from "./apollo";
import { LINEAR, GENERAL, GITHUB } from "./constants";
import { v4 as uuid } from "uuid";
import { LinearTeam } from "../typings";
import { WebhookUpdateInput } from "@linear/sdk/dist/_generated_documents";

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

export const getLinearWebhook = async (token: string, teamName: string) => {
    const callbackURL = getWebhookURL();

    const query = `query GetWebhook {
        webhooks {
            nodes {
                url
                id
                team {
                    name
                }
            }
        }
    }`;

    const response = await linearQuery(query, token);
    if (!response?.data) {
        console.error("No webhook response from Linear");
        return null;
    }

    const webhook = response.data.webhooks?.nodes?.find(
        webhook =>
            webhook.url === callbackURL && webhook.team?.name === teamName
    );

    return webhook;
};

export const setLinearWebhook = async (token: string, teamID: string) => {
    const callbackURL = getWebhookURL();

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

export const updateLinearWebhook = async (
    token: string,
    teamId: string,
    updates: WebhookUpdateInput
) => {
    const webhook = await getLinearWebhook(token, teamId);
    if (!webhook?.id) {
        console.error(`Could not find webhook for Linear team ${teamId}`);
        return;
    }

    const mutation = `mutation UpdateWebhook($input: WebhookUpdateInput!, $webhookId: String!) {
        webhookUpdate(
            id: $webhookId,
            input: $input
        ) {
            success
        }
    }`;

    return await linearQuery(mutation, token, {
        webhookId: webhook.id,
        input: updates
    });
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

export const createLinearCycle = async (
    token: string,
    teamId: string,
    title: string,
    description?: string,
    endDate?: Date
): Promise<{
    data: { cycleCreate: { success: boolean; cycle: { id: string } } };
}> => {
    const mutation = `mutation CreateCycle(
        $teamId: String!,
        $title: String!,
        $description: String,
        $startsAt: DateTime!,
        $endsAt: DateTime!
    ) {
        cycleCreate(
            input: {
                name: $title,
                description: $description,
                teamId: $teamId,
                startsAt: $startsAt,
                endsAt: $endsAt
            }
        ) {
            success
            cycle {
                id
            }
        }
    }`;

    return await linearQuery(mutation, token, {
        teamId,
        title,
        ...(description && { description }),
        ...(endDate && { endsAt: endDate }),
        startsAt: new Date()
    });
};

export const updateLinearCycle = async (
    token: string,
    cycleId: string,
    name?: string,
    description?: string,
    endDate?: Date
): Promise<{
    data: { cycleUpdate: { success: boolean } };
}> => {
    const mutation = `mutation UpdateCycle(
        $cycleId: String!,
        $name: String,
        $description: String,
        $endsAt: DateTime
    ) {
        cycleUpdate(
            id: $cycleId,
            input: {
                name: $name,
                description: $description,
                endsAt: $endsAt
            }
        ) {
            success
        }
    }`;

    return await linearQuery(mutation, token, {
        cycleId,
        // Only include the fields that are defined to avoid server error
        ...(name && { name }),
        ...(description && { description }),
        ...(endDate && { endsAt: endDate })
    });
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

export const exchangeLinearToken = async (
    refreshToken: string
): Promise<any> => {
    const redirectURI = window.location.origin;

    const response = await fetch("/api/linear/token", {
        method: "POST",
        body: JSON.stringify({ refreshToken, redirectURI }),
        headers: { "Content-Type": "application/json" }
    });

    return await response.json();
};

export const checkForExistingTeam = async (teamId: string): Promise<any> => {
    const response = await fetch(`/api/linear/team/${teamId}`, {
        method: "GET"
    });

    return await response.json();
};

// Open a Linear ticket for the creator to authenticate with this app
export const inviteMember = async (
    memberId: string,
    teamId: string,
    repoName,
    linearClient: LinearClient
) => {
    const issueCreator = await linearClient.user(memberId);
    const message = [
        `Hey @${issueCreator.displayName}!`,
        `Someone on your team signed up for [Linear-GitHub Sync](${GENERAL.APP_URL}).`,
        `To mirror issues you tag as Public in ${repoName}, simply follow the auth flow [here](${GENERAL.APP_URL}).`,
        `If you'd like to stop seeing these messages, please ask your workspace admin to let us know!`,
        getSyncFooter()
    ].join("\n");

    linearClient.issueCreate({
        title: `GitHub Sync — ${issueCreator.name}, please join our workspace`,
        description: message,
        teamId: teamId,
        assigneeId: memberId
    });
};

export const generateLinearUUID = (): string => {
    return `${uuid().substring(0, 28)}${GITHUB.UUID_SUFFIX}`;
};

export const getProjectFooter = (name: string, url: string): string => {
    return `\n\n<sub>[${name}](${url}) on Linear</sub>`;
};

