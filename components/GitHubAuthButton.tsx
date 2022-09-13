import { CheckIcon } from "@radix-ui/react-icons";
import React, { useState } from "react";
import { getGitHubTokenURL } from "../utils";

const GitHubAuthButton = () => {
    const [clicked, setClicked] = useState(false);
    const [tokenInput, setTokenInput] = useState("");

    const openGitHubTokenPage = () => {
        window.open(getGitHubTokenURL());
        setClicked(true);
    };

    return (
        <div className="center space-y-4 max-w-xs">
            {clicked ? (
                <div className="flex items-center pr-3 w-full rounded-md bg-gray-800 border border-gray-500 hover:border-gray-400 hover:bg-gray-700">
                    <input
                        placeholder="Paste your token here"
                        value={tokenInput}
                        onChange={e => setTokenInput(e.target?.value)}
                        type="text"
                        spellCheck="false"
                        className="bg-transparent p-3 text-ellipsis focus:outline-none"
                    />
                    {!!tokenInput && <CheckIcon className="w-6 h-6" />}
                </div>
            ) : (
                <button onClick={openGitHubTokenPage}>
                    Generate GitHub Token
                </button>
            )}
            <ul className={`${tokenInput ? "invisible" : ""} font-tertiary`}>
                <li>
                    1. Set <code>Expiration</code> to maximum
                </li>
                <li>
                    2. Click <code>Generate token</code>
                </li>
                <li>3. Copy your newly created token</li>
                <li>4. Paste your token above</li>
            </ul>
        </div>
    );
};

export default GitHubAuthButton;

