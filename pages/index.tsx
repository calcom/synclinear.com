import React, { useEffect, useState } from "react";
import GitHubAuthButton from "../components/GitHubAuthButton";
import LinearAuthButton from "../components/LinearAuthButton";
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
            console.log("saving linearContext", linearContext);

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

        console.log(gitHubContext);
        console.log(linearContext);

        if (linearContext.teamId && gitHubContext.repoId) {
            console.log("saving to server");

            saveSync(linearContext, gitHubContext);
            localStorage.clear();
        }

        return () => {
            console.log("navving away");
        };
    }, [gitHubContext, linearContext]);

    return (
        <div className="w-screen h-screen center gap-40">
            <h1>Linear-GitHub Sync</h1>
            <div className="w-full flex justify-center items-start gap-20">
                <LinearAuthButton
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
                    onAuth={(apiKey: string) =>
                        setGitHubContext({ ...gitHubContext, apiKey })
                    }
                    onDeployWebhook={setGitHubContext}
                />
            </div>
        </div>
    );
};

export default index;

