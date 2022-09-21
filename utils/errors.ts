import { formatJSON } from ".";

export const getIssueUpdateError = (
    resource: "state" | "description" | "title",
    data: { number: number; id: string; team: { key: string } },
    syncedIssue: { githubIssueNumber: number; githubIssueId: number },
    updatedIssueResponse: { statusCode: number; json: () => any }
): string => {
    return `Failed to update GitHub issue ${resource} for ${data.team.key}-${
        data.number
    } [${data.id}] on GitHub issue #${syncedIssue.githubIssueNumber} [${
        syncedIssue.githubIssueId
    }], received status code ${
        updatedIssueResponse.statusCode
    }, body of ${formatJSON(updatedIssueResponse.json())}.`;
};

export const getOtherUpdateError = (
    resource: "comment" | "attachment",
    data: { number: number; id: string; team: { key: string } },
    createdIssue: { number: number; id: number },
    createdIssueResponse: { statusCode: number; json: () => any },
    responseBody: any
): string => {
    return `Failed to update GitHub issue ${resource} for ${data.team.key}-${
        data.number
    } [${data.id}] on GitHub issue #${createdIssue.number} [${
        createdIssue.id
    }], received status code ${
        createdIssueResponse.statusCode
    }, body of ${formatJSON(responseBody)}.`;
};

