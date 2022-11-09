import { Cross1Icon, WidthIcon } from "@radix-ui/react-icons";
import React, { useContext, useState } from "react";
import { Context } from "./ContextProvider";
import Tooltip from "./Tooltip";

const Dashboard = () => {
    const { syncs, setSyncs, gitHubToken } = useContext(Context);

    const [loading, setLoading] = useState(false);

    const removeSync = async (syncId: string) => {
        if (!syncId || !gitHubToken) return;
        setLoading(true);
        const data = { syncId, accessToken: gitHubToken };

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

    if (!syncs?.length) return <></>;

    return (
        <div className="center space-y-4">
            <h3>Your active syncs</h3>
            {loading && <p className="animate-pulse">Loading...</p>}
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

