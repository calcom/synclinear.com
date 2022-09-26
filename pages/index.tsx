import React, { useEffect, useState } from "react";
import GitHubAuthButton from "../components/GitHubAuthButton";
import LinearAuthButton from "../components/LinearAuthButton";
import PageHead from "../components/PageHead";
import SyncArrow from "../components/SyncArrow";
import { GitHubContext, LinearContext } from "../typings";
import { saveSync } from "../utils";

const index = () => {
    const [linearContext, setLinearContext] = useState<LinearContext>({
        userId: "",
        teamId: "",
        apiKey: ""
    });
    const [gitHubContext, setGitHubContext] = useState<GitHubContext>({
        userId: "",
        repoId: "",
        webhookSecret: "",
        apiKey: ""
    });

    // Load the saved context from localStorage
    useEffect(() => {
        if (localStorage.getItem("linearContext")) {
            setLinearContext(JSON.parse(localStorage.getItem("linearContext")));
        }
        if (localStorage.getItem("gitHubContext")) {
            setLinearContext(JSON.parse(localStorage.getItem("gitHubContext")));
        }
    }, []);

    // Save the context to localStorage or server
    useEffect(() => {
        if (linearContext.apiKey) {
            localStorage.setItem(
                "linearContext",
                JSON.stringify(linearContext)
            );
        }
        if (gitHubContext.apiKey) {
            localStorage.setItem(
                "gitHubContext",
                JSON.stringify(gitHubContext)
            );
        }

        if (linearContext.teamId && gitHubContext.repoId) {
            saveSync(linearContext, gitHubContext);
            localStorage.clear();
        }
    }, [gitHubContext, linearContext]);

    return (
        <div>
            <PageHead />
            <div className="w-screen h-screen center gap-28">
                <div className="space-y-4 text-center">
                    <h1>Linear-GitHub Sync</h1>
                    <h2>End-to-end sync of Linear tickets and GitHub issues</h2>
                </div>
                <div className="w-full flex justify-center items-start gap-20">
                    <LinearAuthButton
                        restored={!!linearContext.teamId}
                        onAuth={(apiKey: string) =>
                            setLinearContext({ ...linearContext, apiKey })
                        }
                        onDeployWebhook={setLinearContext}
                    />
                    <div className="center w-56 shrink gap-4">
                        <SyncArrow
                            direction="right"
                            active={
                                !!linearContext.teamId && !!gitHubContext.apiKey
                            }
                        />
                        <SyncArrow
                            direction="left"
                            active={
                                !!gitHubContext.repoId && !!linearContext.apiKey
                            }
                        />
                    </div>
                    <GitHubAuthButton
                        restored={!!gitHubContext.repoId}
                        onAuth={(apiKey: string) =>
                            setGitHubContext({ ...gitHubContext, apiKey })
                        }
                        onDeployWebhook={setGitHubContext}
                    />
                </div>
            </div>
        </div>
    );
};

export default index;

