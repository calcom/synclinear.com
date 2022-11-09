import { CheckIcon, DotsHorizontalIcon } from "@radix-ui/react-icons";
import React, { useCallback, useContext, useEffect, useState } from "react";
import { GitHubContext, GitHubRepo } from "../typings";
import { clearURLParams } from "../utils";
import { v4 as uuid } from "uuid";
import { GITHUB } from "../utils/constants";
import DeployButton from "./DeployButton";
import {
    exchangeGitHubToken,
    getGitHubRepos,
    getGitHubUser,
    checkForExistingRepo,
    getGitHubAuthURL,
    saveGitHubContext,
    setGitHubWebook
} from "../utils/github";
import { Context } from "./ContextProvider";

interface IProps {
    onAuth: (apiKey: string) => void;
    onDeployWebhook: (context: GitHubContext) => void;
    restoredApiKey: string;
    restored: boolean;
}

const GitHubAuthButton = ({
    onAuth,
    onDeployWebhook,
    restoredApiKey,
    restored
}: IProps) => {
    const [repos, setRepos] = useState<GitHubRepo[]>([]);
    const [chosenRepo, setChosenRepo] = useState<GitHubRepo>();
    const [deployed, setDeployed] = useState(false);
    const [loading, setLoading] = useState(false);

    const { gitHubToken, setGitHubToken, gitHubUser, setGitHubUser } =
        useContext(Context);

    // If present, exchange the temporary auth code for an access token
    useEffect(() => {
        if (gitHubToken) return;

        // If the URL params have an auth code, we're returning from the GitHub auth page
        const authResponse = new URLSearchParams(window.location.search);
        if (!authResponse.has("code")) return;

        // Ensure the verification code is unchanged
        const verificationCode = localStorage.getItem("github-verification");
        if (!authResponse.get("state")?.includes("github")) return;
        if (authResponse.get("state") !== verificationCode) {
            alert("GitHub auth returned an invalid code. Please try again.");
            clearURLParams();
            return;
        }

        setLoading(true);

        // Exchange auth code for access token
        const refreshToken = authResponse.get("code");
        exchangeGitHubToken(refreshToken)
            .then(body => {
                if (body.access_token) setGitHubToken(body.access_token);
                else {
                    alert("No access token returned. Please try again.");
                    clearURLParams();
                    localStorage.removeItem(GITHUB.STORAGE_KEY);
                }
                setLoading(false);
            })
            .catch(err => {
                alert(`Error fetching access token: ${err}`);
                setLoading(false);
            });
    }, []);

    // Restore the GitHub context from local storage
    useEffect(() => {
        if (restoredApiKey) setGitHubToken(restoredApiKey);
    }, [restoredApiKey]);

    // Fetch the user's repos when a token is available
    useEffect(() => {
        if (!gitHubToken) return;
        if (gitHubUser?.id) return;

        onAuth(gitHubToken);

        getGitHubRepos(gitHubToken)
            .then(res => {
                setRepos(
                    res.map(repo => {
                        return { id: repo.id, name: repo.full_name };
                    })
                );
            })
            .catch(err => alert(`Error fetching repos: ${err}`));

        getGitHubUser(gitHubToken)
            .then(res => setGitHubUser({ id: res.id, name: res.login }))
            .catch(err => alert(`Error fetching user profile: ${err}`));
    }, [gitHubToken]);

    // Disable webhook deployment button if the repo already exists
    useEffect(() => {
        if (!chosenRepo || !gitHubUser || !gitHubToken) return;

        setLoading(true);

        checkForExistingRepo(chosenRepo.id)
            .then(res => {
                if (res?.exists) {
                    setDeployed(true);
                    onDeployWebhook({
                        userId: gitHubUser.id,
                        repoId: chosenRepo.id,
                        apiKey: gitHubToken
                    });
                } else {
                    setDeployed(false);
                }
                setLoading(false);
            })
            .catch(err => {
                alert(`Error checking for existing repo: ${err}`);
                setLoading(false);
            });
    }, [chosenRepo]);

    const openAuthPage = () => {
        // Generate random code to validate against CSRF attack
        const verificationCode = `github-${uuid()}`;
        localStorage.setItem("github-verification", verificationCode);

        const authURL = getGitHubAuthURL(verificationCode);
        window.location.replace(authURL);
    };

    const deployWebhook = useCallback(() => {
        if (!chosenRepo || deployed) return;

        const webhookSecret = `${uuid()}`;
        saveGitHubContext(chosenRepo, webhookSecret).catch(err =>
            alert(`Error saving repo to DB: ${err}`)
        );

        setGitHubWebook(gitHubToken, chosenRepo, webhookSecret)
            .then(res => {
                if (res.errors) {
                    alert(res.errors[0].message);
                    return;
                }
                setDeployed(true);
                onDeployWebhook({
                    userId: gitHubUser.id,
                    repoId: chosenRepo.id,
                    apiKey: gitHubToken
                });
            })
            .catch(err => alert(`Error deploying webhook: ${err}`));
    }, [gitHubToken, chosenRepo, deployed, gitHubUser]);

    return (
        <div className="center space-y-8 w-80">
            <button
                onClick={openAuthPage}
                disabled={!!gitHubToken || loading}
                className={loading ? "animate-pulse" : ""}
                aria-label="Authorize with GitHub"
            >
                {loading ? (
                    <>
                        <span>Loading</span>
                        <DotsHorizontalIcon className="w-6 h-6" />
                    </>
                ) : (
                    <span>2. Connect GitHub</span>
                )}
                {!!gitHubToken && <CheckIcon className="w-6 h-6" />}
            </button>
            {repos.length > 0 && gitHubUser && restored && (
                <div className="flex flex-col items-center space-y-4">
                    <select
                        name="GitHub repository"
                        disabled={deployed || loading}
                        onChange={e => {
                            setChosenRepo(
                                repos.find(repo => repo.id == e.target.value)
                            );
                        }}
                    >
                        <option value="" disabled selected>
                            4. Select your repo
                        </option>
                        {repos.map(repo => (
                            <option key={repo.id} value={repo.id}>
                                {repo.name}
                            </option>
                        ))}
                    </select>
                    {chosenRepo && (
                        <DeployButton
                            loading={loading}
                            deployed={deployed}
                            onDeploy={deployWebhook}
                        />
                    )}
                </div>
            )}
        </div>
    );
};

export default GitHubAuthButton;

