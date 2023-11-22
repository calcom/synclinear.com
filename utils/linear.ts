import { LinearClient } from "@linear/sdk";
import { getWebhookURL, getSyncFooter } from ".";
import { linearQuery } from "./apollo";
import { LINEAR, GENERAL, GITHUB } from "./constants";
import { v4 as uuid } from "uuid";
import { LinearObject, LinearTeam, TicketState } from "../typings";
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
        w => w.url === callbackURL && w.team?.name === teamName
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
    teamName: string,
    updates: WebhookUpdateInput
) => {
    const webhook = await getLinearWebhook(token, teamName);
    if (!webhook?.id) {
        console.error(`Could not find webhook for Linear team ${teamName}`);
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

export const createLinearLabel = async (
    token: string,
    teamID: string,
    labelName: string,
    color: string
) => {
    const mutation = `mutation CreateLabel($teamID: String!, $labelName: String!, $color: String!) {
        issueLabelCreate(
            input: {
                name: $labelName,
                color: $color,
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

    return await linearQuery(mutation, token, {
        teamID,
        labelName,
        color
    });
};

export const getLinearCycle = async (
    token: string,
    cycleId: string
): Promise<{
    data: {
        cycle: {
            name: string;
            description: string;
            number: number;
            endsAt: string;
        };
    };
}> => {
    const query = `query GetCycle($cycleId: String!) {
        cycle(id: $cycleId) {
            name
            description
            number
            endsAt
        }
    }`;

    return await linearQuery(query, token, { cycleId });
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

export const saveLinearContext = async (
    token: string,
    team: LinearTeam,
    stateLabels: { [key in TicketState]: LinearObject }
) => {
    let publicLabel = team.labels?.nodes?.find?.(n => n.name === "Public");

    if (!publicLabel) {
        const { data } = await createLinearLabel(
            token,
            team.id,
            "Public",
            "#2DA54E"
        );

        if (!data?.issueLabelCreate?.issueLabel) {
            alert('Please create a Linear label called "Public"');
        }

        publicLabel = data?.issueLabelCreate?.issueLabel;
    }

    if (!stateLabels) {
        alert("Please select a label for each ticket state");
        return;
    }

    const data = {
        teamId: team.id,
        teamName: team.name,
        publicLabelId: publicLabel?.id,
        toDoStateId: stateLabels.todo?.id,
        doneStateId: stateLabels.done?.id,
        canceledStateId: stateLabels.canceled?.id
    };

    const response = await fetch("/api/linear/save", {
        method: "POST",
        body: JSON.stringify(data)
    });

    return response.json();
};

export const exchangeLinearToken = async (
    refreshToken: string
): Promise<{ access_token?: string }> => {
    const redirectURI = window.location.origin;

    const response = await fetch("/api/linear/token", {
        method: "POST",
        body: JSON.stringify({ refreshToken, redirectURI }),
        headers: { "Content-Type": "application/json" }
    });

    return await response.json();
};

export const checkTeamWebhook = async (
    teamId: string,
    teamName: string,
    token: string
): Promise<{ teamInDB?: boolean; webhookExists?: boolean }> => {
    const response = await fetch("/api/linear/webhook", {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`
        },
        body: JSON.stringify({
            teamId,
            teamName
        })
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

    linearClient.createIssue({
        title: `GitHub Sync — ${issueCreator.name}, please join our workspace`,
        description: message,
        teamId: teamId,
        assigneeId: memberId
    });
};

export const generateLinearUUID = (): string => {
    return `${uuid().substring(0, 28)}${GITHUB.UUID_SUFFIX}`;
};

