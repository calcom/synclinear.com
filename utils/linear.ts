import { LinearClient } from "@linear/sdk";
import { getWebhookURL, getSyncFooter } from ".";
import { linearQuery } from "./apollo";
import { LINEAR, GENERAL, GITHUB } from "./constants";
import { v4 as uuid } from "uuid";
import { LinearProjectState, LinearTeam } from "../typings";

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

export const createLinearProject = async (
    token: string,
    teamId: string,
    title: string,
    description?: string,
    state?: LinearProjectState
): Promise<{
    data: {
        success: boolean;
        project: {
            id: string;
        };
    };
}> => {
    const mutation = `mutation CreateProject(
        $teamId: String!,
        $title: String!,
        $state: String,
        $description: String
    ) {
        projectCreate(
            input: {
                name: $title,
                description: $description,
                state: $state,
                teamIds: [$teamId],
            }
        ) {
            success
            project {
                id
            }
        }
    }`;

    return await linearQuery(mutation, token, {
        teamId,
        title,
        ...(description && { description }),
        state: state || "backlog"
    });
};

export const updateLinearProject = async (
    token: string,
    projectId: string,
    name?: string,
    description?: string,
    state?: LinearProjectState
): Promise<{
    data: {
        success: boolean;
    };
}> => {
    const mutation = `mutation UpdateProject(
        $projectId: String!,
        $name: String,
        $state: String,
        $description: String
    ) {
        projectUpdate(
            id: $projectId,
            input: {
                name: $name,
                state: $state,
                description: $description
            }
        ) {
            success
        }
    }`;

    return await linearQuery(mutation, token, {
        projectId,
        // Only include the fields that are defined to avoid server error
        ...(name && { name }),
        ...(description && { description }),
        ...(state && { state })
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

