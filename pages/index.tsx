import React, { useContext, useEffect, useState } from "react";
import Footer from "../components/Footer";
import GitHubAuthButton from "../components/GitHubAuthButton";
import Landing from "../components/Landing";
import LinearAuthButton from "../components/LinearAuthButton";
import PageHead from "../components/PageHead";
import SyncArrow from "../components/SyncArrow";
import { saveSync } from "../utils";
import confetti from "canvas-confetti";
import { GITHUB, LINEAR } from "../utils/constants";
import { ExternalLinkIcon } from "@radix-ui/react-icons";
import Header from "../components/Header";
import { Context } from "../components/ContextProvider";
import Dashboard from "../components/Dashboard";
import LogoShelf from "../components/LogoShelf";

const index = () => {
    const { linearContext, setLinearContext, gitHubContext, setGitHubContext } =
        useContext(Context);
    const [synced, setSynced] = useState(false);
    const [restored, setRestored] = useState(false);

    // Load the saved context from localStorage
    useEffect(() => {
        if (localStorage.getItem(LINEAR.STORAGE_KEY)) {
            setLinearContext(
                JSON.parse(localStorage.getItem(LINEAR.STORAGE_KEY))
            );
            setRestored(true);
        }
        if (localStorage.getItem(GITHUB.STORAGE_KEY)) {
            setGitHubContext(
                JSON.parse(localStorage.getItem(GITHUB.STORAGE_KEY))
            );
            setRestored(true);
        }
    }, []);

    // Save the context to localStorage or server
    useEffect(() => {
        if (linearContext.apiKey) {
            localStorage.setItem(
                LINEAR.STORAGE_KEY,
                JSON.stringify(linearContext)
            );
        }
        if (gitHubContext.apiKey) {
            localStorage.setItem(
                GITHUB.STORAGE_KEY,
                JSON.stringify(gitHubContext)
            );
        }

        if (linearContext.teamId && gitHubContext.repoId) {
            saveSync(linearContext, gitHubContext)
                .then(res => {
                    if (res.error) {
                        alert(res.error);
                        return;
                    }

                    setSynced(true);

                    confetti({
                        disableForReducedMotion: true,
                        particleCount: 250,
                        spread: 360,
                        ticks: 500,
                        decay: 0.95
                    });

                    localStorage.clear();
                })
                .catch(err => {
                    alert(err);
                    setSynced(false);
                });
        }
    }, [gitHubContext, linearContext]);

    return (
        <div>
            <PageHead />
            <Header />
            <section className="w-full min-h-[80vh] center gap-24 px-6">
                <div className="space-y-4 text-center pt-8">
                    <span className="px-3 py-1 rounded-full bg-blue-500 text-gray-200">
                        Beta
                    </span>
                    <h1>Linear-GitHub Sync</h1>
                    <p className="text-2xl font-tertiary">
                        End-to-end sync of Linear tickets and GitHub issues
                    </p>
                </div>
                <Dashboard />
                <div className="w-full flex flex-col sm:flex-row justify-center items-center sm:items-start gap-4">
                    <LinearAuthButton
                        restoredApiKey={linearContext.apiKey}
                        restored={restored}
                        onAuth={(apiKey: string) =>
                            setLinearContext({
                                ...linearContext,
                                apiKey
                            })
                        }
                        onDeployWebhook={setLinearContext}
                    />
                    <div className="flex sm:center h-20 sm:h-fit sm:w-56 shrink gap-4">
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
                        restoredApiKey={gitHubContext.apiKey}
                        restored={restored}
                        onAuth={(apiKey: string) =>
                            setGitHubContext({
                                ...gitHubContext,
                                apiKey
                            })
                        }
                        onDeployWebhook={setGitHubContext}
                    />
                </div>
                <div
                    className={`space-y-4 text-center ${
                        synced ? "visible" : "invisible"
                    }`}
                >
                    <h3 className="text-green-600">Synced!</h3>
                    <p>
                        To test your connection, tag a Linear issue as{" "}
                        <code>Public</code>:
                    </p>
                    <button onClick={() => window.open(LINEAR.APP_URL)}>
                        <span>Open Linear</span>
                        <ExternalLinkIcon className="w-6 h-6" />
                    </button>
                </div>
                <LogoShelf />
            </section>
            <Landing />
            <Footer />
        </div>
    );
};

export default index;
