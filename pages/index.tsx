import React, { useEffect, useState } from "react";
import Footer from "../components/Footer";
import GitHubAuthButton from "../components/GitHubAuthButton";
import Landing from "../components/Landing";
import LinearAuthButton from "../components/LinearAuthButton";
import PageHead from "../components/PageHead";
import SyncArrow from "../components/SyncArrow";
import { GitHubContext, LinearContext } from "../typings";
import { makeSerializable, saveSync } from "../utils";

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
            setLinearContext(
                makeSerializable<LinearContext>(
                    localStorage.getItem("linearContext")
                )
            );
        }
        if (localStorage.getItem("gitHubContext")) {
            setGitHubContext(
                makeSerializable<GitHubContext>(
                    localStorage.getItem("gitHubContext")
                )
            );
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
            <section className="w-screen h-screen center gap-28">
                <div className="space-y-4 text-center">
                    <h1>Linear-GitHub Sync</h1>
                    <h3>End-to-end sync of Linear tickets and GitHub issues</h3>
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
            </section>
            <Landing />
            <Footer />
        </div>
    );
};

export default index;

