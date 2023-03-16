export interface LinearWebhookPayload {
    action: "create" | "update" | "remove";
    type: string;
    createdAt: string;
    data: LinearData;
    url: string;
    updatedFrom?: Partial<LinearData>;
}

interface LinearData {
    id: string;
    createdAt: string;
    updatedAt: string;
    number: number;
    title: string;
    description: string;
    priority: number;
    boardOrder: number;
    sortOrder: number;
    startedAt: string;
    teamId: string;
    projectId: string;
    cycleId?: string;
    // previousIdentifiers: string[];
    creatorId: string;
    userId?: string;
    assigneeId: string;
    stateId: string;
    priorityLabel: string;
    subscriberIds: string[];
    labelIds: string[];
    assignee: LinearObject;
    project: LinearObject;
    state: LinearState;
    team: LinearTeam;
    user?: LinearObject;
    body?: string;
    issueId?: string;
    issue?: {
        id: string;
        title: string;
    };
}

export interface LinearObject {
    id: string;
    name: string;
}

interface ColoredLinearObject extends LinearObject {
    color: string;
}

export interface LinearState extends ColoredLinearObject {
    type: string;
}

export interface LinearTeam extends LinearObject {
    key: string;
    labels: { nodes: LinearObject[] };
    states: { nodes: LinearState[] };
}

export interface GitHubRepo {
    id: string;
    name: string;
}

export interface LinearContext {
    userId: string;
    teamId: string;
    apiKey: string;
}

export interface GitHubContext {
    userId: string;
    repoId: string;
    apiKey: string;
}

export interface Sync {
    id: string;
    LinearTeam: { id: string; teamName: string };
    GitHubRepo: { id: string; repoName: string };
}

export type MilestoneState = "open" | "closed";

export type GitHubIssueLabel = {
    name: string;
    color: string;
};

