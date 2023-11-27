import { Cross1Icon, InfoCircledIcon, WidthIcon } from "@radix-ui/react-icons";
import React, { useContext, useEffect, useState } from "react";
import { LINEAR } from "../utils/constants";
import { updateGitHubWebhook } from "../utils/github";
import { getLinearWebhook, updateLinearWebhook } from "../utils/linear";
import { Context } from "./ContextProvider";
import Tooltip from "./Tooltip";

const options = ["Cycle", "Project"] as const;
type Option = (typeof options)[number];

const Dashboard = () => {
    const { syncs, setSyncs, gitHubContext, linearContext } =
        useContext(Context);

    const [loading, setLoading] = useState(false);
    const [milestoneAction, setMilestoneAction] = useState<Option | null>(null);

    // Get initial webhook settings
    useEffect(() => {
        if (!syncs?.length) return;

        getLinearWebhook(
            linearContext.apiKey,
            syncs[0].LinearTeam.teamName
        ).then(res => {
            if (res.resourceTypes.includes("Cycle")) {
                setMilestoneAction("Cycle");
            } else if (res.resourceTypes.includes("Project")) {
                setMilestoneAction("Project");
            }
        });
    }, [syncs]);

    const removeSync = async (syncId: string) => {
        if (!syncId || !gitHubContext.apiKey) return;
        setLoading(true);
        const data = { syncId, accessToken: gitHubContext.apiKey };

        await fetch("/api/syncs", {
            method: "DELETE",
            body: JSON.stringify(data)
        })
            .then(response => {
                if (response.status === 200) {
                    const newSyncs = syncs.filter(sync => sync.id !== syncId);
                    setSyncs(newSyncs);
                } else {
                    throw new Error("Error deleting sync");
                }
            })
            .catch(error => {
                alert(error);
            })
            .finally(() => {
                setLoading(false);
            });
    };

    useEffect(() => {
        const handleMilestoneSyncChange = async () => {
            setLoading(true);

            for (const sync of syncs) {
                await updateGitHubWebhook(
                    gitHubContext.apiKey,
                    sync.GitHubRepo.repoName,
                    {
                        ...(milestoneAction
                            ? { add_events: ["milestone"] }
                            : { remove_events: ["milestone"] })
                    }
                );
                await updateLinearWebhook(
                    linearContext.apiKey,
                    sync.LinearTeam.teamName,
                    {
                        resourceTypes: [
                            ...LINEAR.WEBHOOK_EVENTS,
                            ...(milestoneAction ? [milestoneAction] : [])
                        ]
                    }
                );
            }

            setLoading(false);
        };

        handleMilestoneSyncChange();
    }, [milestoneAction]);

    if (!syncs?.length) return <></>;

    return (
        <div className="center space-y-4">
            {loading && <p className="animate-pulse">Loading...</p>}
            <h3>Your active syncs</h3>
            {syncs.map((sync, index) => (
                <div
                    key={index}
                    className="flex items-center justify-between gap-12 p-1 pl-6 w-full rounded-full bg-gray-300"
                >
                    <div className="flex gap-2">
                        <div className="font-semibold">
                            {sync.LinearTeam?.teamName}
                        </div>
                        <WidthIcon className="w-6 h-6" />
                        <div>
                            <span>
                                {sync.GitHubRepo?.repoName?.split("/")?.[0]}
                            </span>
                            /
                            <span className="font-semibold">
                                {sync.GitHubRepo?.repoName?.split("/")?.[1]}
                            </span>
                        </div>
                    </div>
                    <Tooltip content="This will un-sync the team and repo for all users">
                        <div
                            onClick={() => removeSync(sync.id)}
                            className="rounded-full p-3 group cursor-pointer"
                        >
                            <Cross1Icon className="w-4 h-4 group-hover:text-danger transition-colors" />
                        </div>
                    </Tooltip>
                </div>
            ))}
            <div className="flex flex-col items-start">
                {options.map(option => (
                    <div
                        key={option}
                        className="flex items-center space-x-2 mb-4"
                    >
                        <input
                            id={option}
                            disabled={!linearContext.apiKey}
                            type="checkbox"
                            checked={milestoneAction === option}
                            onChange={e =>
                                setMilestoneAction(
                                    e.target.checked
                                        ? (e.target.id as Option)
                                        : null
                                )
                            }
                        />
                        <label htmlFor={option} className="whitespace-nowrap">
                            Sync {option}s to Milestones
                        </label>
                        <Tooltip
                            content={
                                !linearContext.apiKey
                                    ? "Requires connecting to Linear first"
                                    : milestoneAction
                                    ? `Will disable ${
                                          option == "Cycle"
                                              ? "Project"
                                              : "Cycle"
                                      } sync`
                                    : ""
                            }
                        >
                            <InfoCircledIcon className="w-6 h-6 text-gray-400 hover:font-secondary transition-colors duration-200" />
                        </Tooltip>
                    </div>
                ))}
            </div>
        </div>
    );
};

export default Dashboard;

