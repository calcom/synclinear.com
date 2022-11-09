import React, { useContext, useEffect, useState } from "react";
import { exchangeGitHubToken, getGitHubAuthURL } from "../utils/github";
import GitHubLogo from "./icons/GitHubLogo";
import { v4 as uuid } from "uuid";
import { clearURLParams } from "../utils";
import { GENERAL } from "../utils/constants";
import { Cross1Icon } from "@radix-ui/react-icons";
import { Context } from "./ContextProvider";

const LoginButton = () => {
    const [loading, setLoading] = useState(false);

    const {
        gitHubToken,
        setGitHubToken,
        gitHubUsername,
        setGitHubUsername,
        setSyncs
    } = useContext(Context);

    // If present, exchange the temporary auth code for an access token
    useEffect(() => {
        if (gitHubToken) return;

        // If the URL params have an auth code, we're returning from the GitHub auth page
        const authResponse = new URLSearchParams(window.location.search);
        if (!authResponse.has("code")) return;

        // Ensure the verification code is unchanged
        const verificationCode = localStorage.getItem(
            `${GENERAL.LOGIN_KEY}-verification`
        );
        if (!authResponse.get("state")?.includes(GENERAL.LOGIN_KEY)) return;
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
                }
                setLoading(false);
            })
            .catch(err => {
                alert(`Error fetching access token: ${err}`);
                setLoading(false);
            });
    }, []);

    const getSyncs = async () => {
        const data = { accessToken: gitHubToken };

        const response = await fetch("/api/syncs", {
            method: "POST",
            body: JSON.stringify(data)
        });

        return await response.json();
    };

    // Fetch user's active syncs after auth
    useEffect(() => {
        if (!gitHubToken) return;

        setLoading(true);

        getSyncs()
            .then(res => {
                setGitHubUsername(res.name);
                setSyncs(res.syncs);
                console.log(res.syncs);
            })
            .catch(err => {
                alert(err);
            })
            .finally(() => setLoading(false));
    }, [gitHubToken]);

    const openAuthPage = () => {
        // Generate random code to validate against CSRF attack
        const verificationCode = `${GENERAL.LOGIN_KEY}-${uuid()}`;
        localStorage.setItem(
            `${GENERAL.LOGIN_KEY}-verification`,
            verificationCode
        );

        const authURL = getGitHubAuthURL(verificationCode);
        window.location.replace(authURL);
    };

    const logOut = () => {
        setGitHubToken("");
        setGitHubUsername("");
        localStorage.removeItem(`${GENERAL.LOGIN_KEY}-verification`);
        localStorage.removeItem(`${GENERAL.LOGIN_KEY}-token`);
    };

    return (
        <button
            onClick={gitHubToken ? logOut : openAuthPage}
            className="bg-cal-gray !w-40 !h-12 group"
        >
            <span>
                {gitHubUsername
                    ? gitHubUsername
                    : loading
                    ? "Loading..."
                    : "Log in"}
            </span>
            {gitHubToken ? (
                <Cross1Icon className="w-4 h-4 group-hover:text-danger transition-colors" />
            ) : (
                <GitHubLogo className={loading ? "animate-spin" : ""} />
            )}
        </button>
    );
};

export default LoginButton;

