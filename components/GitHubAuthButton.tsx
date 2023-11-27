import { CheckIcon, DotsHorizontalIcon } from "@radix-ui/react-icons";
import React, { useCallback, useContext, useEffect, useState } from "react";
import { GitHubContext, GitHubRepo } from "../typings";
import { clearURLParams } from "../utils";
import { v4 as uuid } from "uuid";
import { GITHUB } from "../utils/constants";
import DeployButton from "./DeployButton";
import {
    exchangeGitHubToken,
    listReposForUser,
    getGitHubUser,
    getRepoWebhook,
    getGitHubAuthURL,
    saveGitHubContext,
    setGitHubWebook,
    getGitHubContext
} from "../utils/github";
import { Context } from "./ContextProvider";
import Select from "./Select";

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
    const [reposLoading, setReposLoading] = useState(false);
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
        if (!gitHubToken || gitHubUser?.id) return;

        onAuth(gitHubToken);

        const startingPage = 0;

        const listReposRecursively = async (page: number): Promise<void> => {
            try {
                const res = await listReposForUser(gitHubToken, page);

                if (!res || res?.length < 1) {
                    setReposLoading(false);
                    return;
                }

                setRepos((current: GitHubRepo[]) => [
                    ...current,
                    ...(res?.map?.(repo => {
                        return { id: repo.id, name: repo.full_name };
                    }) ?? [])
                ]);

                return await listReposRecursively(page + 1);
            } catch (err) {
                alert(`Error fetching repos: ${err}`);
                setReposLoading(false);

                return;
            }
        };

        setReposLoading(true);
        listReposRecursively(startingPage);

        getGitHubUser(gitHubToken)
            .then(res => setGitHubUser({ id: res.id, name: res.login }))
            .catch(err => alert(`Error fetching user profile: ${err}`));
    }, [gitHubToken]);

    // Disable webhook deployment button if the repo already exists
    useEffect(() => {
        if (!chosenRepo || !gitHubUser || !gitHubToken) return;

        setLoading(true);

        const checkRepo = async () => {
            try {
                const [webhook, repo] = await Promise.all([
                    getRepoWebhook(chosenRepo.name, gitHubToken),
                    getGitHubContext(chosenRepo.id, gitHubToken)
                ]);

                if (webhook?.exists && repo?.inDb) {
                    setDeployed(true);
                    onDeployWebhook({
                        userId: gitHubUser.id,
                        repoId: chosenRepo.id,
                        apiKey: gitHubToken
                    });
                } else {
                    setDeployed(false);
                }
            } catch (err) {
                alert(`Error checking for existing repo: ${err}`);
            }

            setLoading(false);
        };

        checkRepo();
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
        saveGitHubContext(chosenRepo, webhookSecret, gitHubToken).catch(err =>
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
            {repos?.length > 0 && gitHubUser && restored && (
                <div className="flex flex-col w-full items-center space-y-4">
                    <Select
                        values={repos.map((repo: GitHubRepo) => ({
                            value: repo.id,
                            label: repo.name
                        }))}
                        onChange={repoId =>
                            setChosenRepo(repos.find(repo => repo.id == repoId))
                        }
                        placeholder="4. Find your repo"
                        loading={reposLoading}
                    />
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

