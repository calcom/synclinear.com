interface LinearWebhookPayload {
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
    // previousIdentifiers: string[];
    creatorId: string;
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

interface LinearObject {
    id: string;
    name: string;
}

interface ColoredLinearObject extends LinearObject {
    color: string;
}

interface LinearState extends ColoredLinearObject {
    type: string;
}

interface LinearTeam extends LinearObject {
    key: string;
}

export { LinearWebhookPayload };

