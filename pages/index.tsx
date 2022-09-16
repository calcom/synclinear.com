import React, { useState } from "react";
import GitHubAuthButton from "../components/GitHubAuthButton";
import LinearAuthButton from "../components/LinearAuthButton";
import SyncArrow from "../components/SyncArrow";

const index = () => {
    const [hasLinearToken, setHasLinearToken] = useState(false);
    const [hasLinearWebhook, setHasLinearWebhook] = useState(false);
    const [hasGitHubToken, setHasGitHubToken] = useState(false);
    const [hasGitHubWebhook, setHasGitHubWebhook] = useState(false);

    return (
        <div className="w-screen h-screen center gap-40">
            <h1>Linear-GitHub Sync</h1>
            <div className="w-full flex justify-center items-start gap-20">
                <LinearAuthButton
                    onPasteToken={() => setHasLinearToken(true)}
                    onDeployWebhook={() => setHasLinearWebhook(true)}
                />
                <div className="center w-56 shrink gap-4">
                    <SyncArrow
                        direction="right"
                        active={hasLinearWebhook && hasGitHubToken}
                    />
                    <SyncArrow
                        direction="left"
                        active={hasGitHubWebhook && hasLinearToken}
                    />
                </div>
                <GitHubAuthButton
                    onPasteToken={() => setHasGitHubToken(true)}
                    onDeployWebhook={() => setHasGitHubWebhook(true)}
                />
            </div>
        </div>
    );
};

export default index;

