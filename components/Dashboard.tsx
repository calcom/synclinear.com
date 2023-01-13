import { Cross1Icon, InfoCircledIcon, WidthIcon } from "@radix-ui/react-icons";
import React, { useContext, useState } from "react";
import { LINEAR } from "../utils/constants";
import { updateGitHubWebhook } from "../utils/github";
import { updateLinearWebhook } from "../utils/linear";
import { Context } from "./ContextProvider";
import Tooltip from "./Tooltip";

const Dashboard = () => {
    const { syncs, setSyncs, gitHubContext, linearContext } =
        useContext(Context);

    const [loading, setLoading] = useState(false);

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

    const handleMilestoneSyncChange = async (
        e: React.ChangeEvent<HTMLInputElement>
    ) => {
        setLoading(true);

        const checked = e.target.checked || false;

        for (const sync of syncs) {
            await updateGitHubWebhook(
                gitHubContext.apiKey,
                sync.GitHubRepo.repoName,
                {
                    ...(checked && { add_events: ["milestone"] }),
                    ...(!checked && { remove_events: ["milestone"] })
                }
            );
            await updateLinearWebhook(
                linearContext.apiKey,
                sync.LinearTeam.teamName,
                {
                    resourceTypes: [
                        ...LINEAR.WEBHOOK_EVENTS,
                        ...(checked ? ["Cycle"] : [])
                    ]
                }
            );
        }

        setLoading(false);
    };

    if (!syncs?.length) return <></>;

    return (
        <div className="center space-y-4">
            {loading && <p className="animate-pulse">Loading...</p>}
            <div className="flex items-center space-x-2 mb-4">
                <input
                    disabled={!linearContext.apiKey}
                    type="checkbox"
                    id="syncsMilestones"
                    onChange={handleMilestoneSyncChange}
                />
                <label htmlFor="syncsMilestones" className="whitespace-nowrap">
                    Sync milestones to cycles
                </label>
                <Tooltip content="Requires connecting to Linear first">
                    <InfoCircledIcon className="w-6 h-6 text-gray-400 hover:font-secondary transition-colors duration-200" />
                </Tooltip>
            </div>
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
        </div>
    );
};

export default Dashboard;

