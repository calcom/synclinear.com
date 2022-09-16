import { CheckIcon, DoubleArrowUpIcon } from "@radix-ui/react-icons";
import React, { useCallback, useEffect, useState } from "react";
import { LinearTeam } from "../typings";
import {
    getLinearContext,
    getLinearTokenURL,
    getWebhookURL,
    saveLinearLabels,
    setLinearWebhook
} from "../utils";

interface IProps {
    onPasteToken: () => void;
    onDeployWebhook: () => void;
}

const LinearAuthButton = ({ onPasteToken, onDeployWebhook }: IProps) => {
    const [clicked, setClicked] = useState(false);
    const [tokenInput, setTokenInput] = useState("");
    const [teams, setTeams] = useState<Array<LinearTeam>>([]);
    const [chosenTeam, setChosenTeam] = useState<LinearTeam>();
    const [deployed, setDeployed] = useState(false);

    // Fetch the user ID and available teams when the token is available
    useEffect(() => {
        if (!tokenInput) return;

        getLinearContext(tokenInput)
            .then(res => {
                if (!res?.data?.teams) alert("No Linear teams found");
                setTeams(res.data.teams.nodes);
                onPasteToken();
            })
            .catch(err => alert(err));
    }, [tokenInput]);

    const openTokenPage = () => {
        const tokenURL = getLinearTokenURL();
        window.open(tokenURL);
        setClicked(true);
    };

    const deployWebhook = useCallback(() => {
        if (!chosenTeam) return;

        saveLinearLabels(tokenInput, chosenTeam)
            .then(res => console.log(res))
            .catch(err => alert(err));

        setLinearWebhook(tokenInput, getWebhookURL(), chosenTeam.id)
            .then(() => {
                setDeployed(true);
                onDeployWebhook();
            })
            .catch(err => alert(err));

        setDeployed(true);
    }, [chosenTeam, tokenInput]);

    return (
        <div className="center space-y-8 w-80">
            <div className="space-y-2 w-full">
                {clicked ? (
                    <div className="flex items-center pr-3 w-full rounded-md bg-gray-800 border border-gray-500 hover:border-gray-400 hover:bg-gray-700">
                        <input
                            placeholder="Paste your token here"
                            value={tokenInput}
                            onChange={e => setTokenInput(e.target?.value)}
                            type="text"
                            spellCheck="false"
                        />
                        {tokenInput && <CheckIcon className="w-6 h-6" />}
                    </div>
                ) : (
                    <button onClick={openTokenPage}>
                        Generate Linear Token
                    </button>
                )}
                {tokenInput && (
                    <p className="font-tertiary text-center">
                        Also paste this as the <code>LINEAR_API_KEY</code> env
                        variable
                    </p>
                )}
            </div>
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
            {teams.length > 0 && (
                <div className="flex flex-col items-center w-full space-y-4">
                    <select
                        disabled={deployed}
                        onChange={e =>
                            setChosenTeam(
                                teams.find(team => team.id === e.target.value)
                            )
                        }
                    >
                        <option value="" disabled selected>
                            Select your team
                        </option>
                        {teams.map(team => (
                            <option key={team.id} value={team.id}>
                                {team.name}
                            </option>
                        ))}
                    </select>
                    {chosenTeam && (
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

export default LinearAuthButton;

