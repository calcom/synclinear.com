import { CheckIcon, CopyIcon, DoubleArrowUpIcon } from "@radix-ui/react-icons";
import React, { useCallback, useEffect, useState } from "react";
import { v4 as uuid } from "uuid";
import {
    copyToClipboard,
    getLinearAuthURL,
    getLinearContext,
    setLinearWebhook
} from "../utils";
import { LINEAR } from "../utils/constants";

const LinearAuthButton = () => {
    const [accessToken, setAccessToken] = useState("");
    const [teamID, setTeamID] = useState("");
    const [teams, setTeams] = useState<Array<any>>([]);
    const [copied, setCopied] = useState(false);
    const [deployed, setDeployed] = useState(false);

    // If present, exchange the temporary auth code for an access token
    useEffect(() => {
        // If the URL params have an auth code, we're returning from the Linear auth page.
        // Ensure the verification code is unchanged.
        const authResponse = new URLSearchParams(window.location.search);
        if (!authResponse.has("code")) return;

        const verificationCode = localStorage.getItem("linear-verification");
        if (authResponse.get("state") !== verificationCode) {
            alert("Linear auth returned an invalid code. Please try again.");
            return;
        }

        // Exchange auth code for access token
        const tokenParams = new URLSearchParams({
            code: authResponse.get("code"),
            redirect_uri: window.location.origin,
            client_id: LINEAR.OAUTH_ID,
            client_secret: process.env.NEXT_PUBLIC_LINEAR_SECRET, // TODO: find a way to obscure this
            grant_type: "authorization_code"
        });
        fetch(LINEAR.TOKEN_URL, {
            method: "POST",
            body: tokenParams,
            headers: { "Content-Type": "application/x-www-form-urlencoded" }
        })
            .then(response => response.json())
            .then(body => {
                if (body.access_token) setAccessToken(body.access_token);
            })
            .catch(err => alert(err));
    }, []);

    // Fetch the user ID and available teams when the token is available
    useEffect(() => {
        if (!accessToken) return;
        getLinearContext(accessToken)
            .then(res => {
                if (!res?.data?.teams) alert("No Linear teams found");
                setTeams(res.data.teams.nodes);
            })
            .catch(err => alert(err));
    }, [accessToken]);

    const openLinearAuth = () => {
        // Generate random code to validate against CSRF attack
        const verificationCode = uuid();
        localStorage.setItem("linear-verification", verificationCode);
        window.location.replace(getLinearAuthURL(verificationCode));
    };

    const copyAccessToken = useCallback(() => {
        if (!accessToken) return;
        copyToClipboard(accessToken);
        setCopied(true);
    }, [accessToken]);

    const deployWebhook = useCallback(() => {
        if (!teamID) return;
        setLinearWebhook(accessToken, `${window.location.origin}/api`, teamID)
            .then(() => setDeployed(true))
            .catch(err => alert(err));
    }, [teamID, accessToken]);

    return (
        <div className="center space-y-12 max-w-xs">
            <button onClick={openLinearAuth} disabled={!!accessToken}>
                <span>Authorize Linear</span>
                {accessToken && <CheckIcon className="ml-4 h-6 w-6" />}
            </button>
            {teams.length > 0 && (
                <div className="flex flex-col items-center space-y-4">
                    <select
                        name="team-select"
                        className="rounded-md bg-gray-700 hover:bg-gray-600 py-3 px-6 text-xl focus:outline-none"
                        onChange={e => setTeamID(e.target.value)}
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
                    {teamID && (
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
            {accessToken && (
                <div className="center text-center space-y-2">
                    <div>Your access token</div>
                    <button
                        onClick={copyAccessToken}
                        className={copied ? "border-gray-500" : ""}
                    >
                        <span className="w-40 overflow-clip text-ellipsis">
                            {accessToken}
                        </span>
                        {copied ? (
                            <CheckIcon className="w-6 h-6" />
                        ) : (
                            <CopyIcon className="w-6 h-6" />
                        )}
                    </button>
                    <p className="font-tertiary">
                        Paste this as the <code>LINEAR_API_KEY</code> env
                        variable.
                    </p>
                </div>
            )}
        </div>
    );
};

export default LinearAuthButton;

