import { CheckIcon, DoubleArrowUpIcon } from "@radix-ui/react-icons";
import React, { useCallback, useEffect, useState } from "react";
import { LinearContext, LinearObject, LinearTeam } from "../typings";
import {
    clearURLParams,
    getLinearAuthURL,
    getLinearContext,
    getWebhookURL,
    saveLinearContext,
    setLinearWebhook
} from "../utils";
import { v4 as uuid } from "uuid";

interface IProps {
    onAuth: (apiKey: string) => void;
    onDeployWebhook: (context: LinearContext) => void;
    restored: boolean;
}

const LinearAuthButton = ({ onAuth, onDeployWebhook, restored }: IProps) => {
    const [accessToken, setAccessToken] = useState("");
    const [teams, setTeams] = useState<Array<LinearTeam>>([]);
    const [chosenTeam, setChosenTeam] = useState<LinearTeam>();
    const [user, setUser] = useState<LinearObject>();
    const [deployed, setDeployed] = useState(false);
    const [loading, setLoading] = useState(false);

    // If present, exchange the temporary auth code for an access token
    useEffect(() => {
        if (accessToken) return;

        // If the URL params have an auth code, we're returning from the Linear auth page
        const authResponse = new URLSearchParams(window.location.search);
        if (!authResponse.has("code")) return;

        // Ensure the verification code is unchanged
        const verificationCode = localStorage.getItem("linear-verification");
        if (!authResponse.get("state")?.includes("linear")) return;
        if (authResponse.get("state") !== verificationCode) {
            alert("Linear auth returned an invalid code. Please try again.");
            return;
        }

        const refreshToken = authResponse.get("code");
        const redirectURI = window.location.origin;

        // Exchange auth code for access token
        fetch("/api/linear/token", {
            method: "POST",
            body: JSON.stringify({ refreshToken, redirectURI }),
            headers: { "Content-Type": "application/json" }
        })
            .then(res => res.json())
            .then(body => {
                if (body.access_token) setAccessToken(body.access_token);
                else {
                    alert("No Linear access token returned. Please try again.");
                    clearURLParams();
                }
            })
            .catch(err => alert(`Error fetching access token: ${err}`));
    }, []);

    // Fetch the user ID and available teams when the token is available
    useEffect(() => {
        if (!accessToken) return;

        onAuth(accessToken);

        getLinearContext(accessToken)
            .then(res => {
                if (!res?.data?.teams || !res.data?.viewer)
                    alert("No Linear user or teams found");

                setTeams(res.data.teams.nodes);
                setUser(res.data.viewer);
            })
            .catch(err => alert(`Error fetching labels: ${err}`));
    }, [accessToken]);

    // Disable webhook deployment button if the team already exists
    useEffect(() => {
        if (!chosenTeam) return;

        setLoading(true);

        fetch(`/api/linear/team/${chosenTeam.id}`)
            .then(res => res.json())
            .then(res => {
                if (res?.exists) {
                    setDeployed(true);
                } else {
                    setDeployed(false);
                }
                setLoading(false);
            })
            .catch(err => {
                alert(`Error checking for existing labels: ${err}`);
                setLoading(false);
            });
    }, [chosenTeam]);

    const openLinearAuth = () => {
        // Generate random code to validate against CSRF attack
        const verificationCode = `linear-${uuid()}`;
        localStorage.setItem("linear-verification", verificationCode);
        window.location.replace(getLinearAuthURL(verificationCode));
    };

    const deployWebhook = useCallback(() => {
        if (!chosenTeam || deployed) return;

        saveLinearContext(accessToken, chosenTeam).catch(err =>
            alert(`Error saving labels to DB: ${err}`)
        );

        setLinearWebhook(accessToken, getWebhookURL(), chosenTeam.id)
            .then(() => {
                setDeployed(true);
                onDeployWebhook({
                    userId: user.id,
                    teamId: chosenTeam.id,
                    apiKey: accessToken
                });
            })
            .catch(err => alert(`Error deploying webhook: ${err}`));

        setDeployed(true);
    }, [accessToken, chosenTeam, deployed, user]);

    return (
        <div className="center space-y-8 w-80">
            <button
                onClick={openLinearAuth}
                disabled={!!accessToken || restored}
            >
                <span>Connect Linear</span>
                {(!!accessToken || restored) && (
                    <CheckIcon className="w-6 h-6" />
                )}
            </button>
            {teams.length > 0 && (
                <div className="flex flex-col items-center w-full space-y-4">
                    <select
                        disabled={deployed || loading}
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
                        <button
                            onClick={deployWebhook}
                            disabled={deployed || loading}
                            className={`${loading ? "animate-pulse" : ""}`}
                        >
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

