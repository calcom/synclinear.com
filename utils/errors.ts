import { formatJSON } from ".";

export const getIssueUpdateError = (
    resource: "state" | "description" | "title" | "assignee",
    data: { number: number; id: string; team: { key: string } },
    syncedIssue: { githubIssueNumber: number; githubIssueId: number },
    updatedIssueResponse: any
): string => {
    return `Failed to update GitHub issue ${resource} for ${data.team.key}-${
        data.number
    } [${data.id}] on GitHub issue #${syncedIssue.githubIssueNumber} [${
        syncedIssue.githubIssueId
    }], received status code ${
        updatedIssueResponse.statusCode
    }, body of ${formatJSON(JSON.parse(updatedIssueResponse.body))}.`;
};

export class ApiError extends Error {
    constructor(public message: string, public statusCode: number) {
        super(message);
    }
}
