import { CheckIcon, DoubleArrowUpIcon } from "@radix-ui/react-icons";
import React, { useEffect, useState } from "react";
import { GitHubRepo } from "../typings";
import {
    getGitHubTokenURL,
    saveGitHubContext,
    setGitHubWebook
} from "../utils";
import { v4 as uuid } from "uuid";

const GitHubAuthButton = () => {
    const [clicked, setClicked] = useState(false);
    const [tokenInput, setTokenInput] = useState("");
    const [repos, setRepos] = useState<GitHubRepo[]>([]);
    const [chosenRepo, setChosenRepo] = useState<GitHubRepo>();
    const [deployed, setDeployed] = useState(false);

    const openGitHubTokenPage = () => {
        window.open(getGitHubTokenURL());
        setClicked(true);
    };

    useEffect(() => {
        if (!tokenInput) return;

        fetch("https://api.github.com/user/repos", {
            headers: { Authorization: `Bearer ${tokenInput}` }
        })
            .then(res => res.json())
            .then(res => {
                setRepos(
                    res.map(repo => {
                        return { id: repo.id, name: repo.full_name };
                    })
                );
            })
            .catch(err => alert(err));
    }, [tokenInput]);

    const deployWebhook = async () => {
        if (!chosenRepo || deployed) return;

        const webhookSecret = `${uuid()}`;
        await saveGitHubContext(chosenRepo, webhookSecret);

        setGitHubWebook(tokenInput, chosenRepo, webhookSecret)
            .then(res => res.json())
            .then(res => {
                if (res.errors) {
                    alert(res.errors[0].message);
                    return;
                }
                setDeployed(true);
            })
            .catch(err => alert(err));
    };

    return (
        <div className="center space-y-8 max-w-xs">
            {clicked ? (
                <div className="flex items-center pr-3 w-full rounded-md bg-gray-800 border border-gray-500 hover:border-gray-400 hover:bg-gray-700">
                    <input
                        placeholder="Paste your token here"
                        value={tokenInput}
                        onChange={e => setTokenInput(e.target?.value)}
                        type="text"
                        spellCheck="false"
                        className="bg-transparent grow p-3 text-ellipsis focus:outline-none"
                    />
                    {tokenInput && <CheckIcon className="w-6 h-6" />}
                </div>
            ) : (
                <button onClick={openGitHubTokenPage}>
                    Generate GitHub Token
                </button>
            )}
            {tokenInput && (
                <p>
                    Also paste your token as the <code>GITHUB_API_KEY</code> env
                    variable
                </p>
            )}
            {!tokenInput && (
                <ul className="font-tertiary">
                    <li>
                        1. Set <code>Expiration</code> to maximum
                    </li>
                    <li>
                        2. Click <code>Generate token</code>
                    </li>
                    <li>3. Copy your newly created token</li>
                </ul>
            )}
            {repos.length > 0 && (
                <div className="flex flex-col items-center space-y-4">
                    <select
                        disabled={deployed}
                        onChange={e => {
                            setChosenRepo(
                                repos.find(repo => repo.id == e.target.value)
                            );
                        }}
                    >
                        <option value="" disabled selected>
                            Select your repo
                        </option>
                        {repos.map(repo => (
                            <option key={repo.id} value={repo.id}>
                                {repo.name}
                            </option>
                        ))}
                    </select>
                    {chosenRepo && (
                        <button onClick={deployWebhook} disabled={deployed}>
                            <span>Deploy webhook</span>
                            {deployed ? (
                                <CheckIcon className="w-6 h-6" />
                            ) : (
                                <DoubleArrowUpIcon className="w-6 h-6" />
                            )}
                        </button>
                    )}
                </div>
            )}
        </div>
    );
};

export default GitHubAuthButton;

