import { CheckIcon, CopyIcon } from "@radix-ui/react-icons";
import React, { useCallback, useEffect, useState } from "react";
import { v4 as uuid } from "uuid";
import { copyToClipboard, getLinearAuthURL } from "../utils";
import { LINEAR, TIMEOUTS } from "../utils/constants";

const LinearAuthButton = () => {
    const [accessToken, setAccessToken] = useState("");
    const [copied, setCopied] = useState(false);

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
            client_secret: process.env.LINEAR_OAUTH_SECRET, // TODO: find a way to obscure this
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
            });
    }, []);

    const openLinearAuth = () => {
        // Generate random code to validate against CSRF attack
        const verificationCode = uuid();
        localStorage.setItem("linear-verification", verificationCode);
        window.location.replace(getLinearAuthURL(verificationCode));
    };

    const copyAccessToken = useCallback(() => {
        copyToClipboard(accessToken);
        setCopied(true);
        setTimeout(() => setCopied(false), TIMEOUTS.DEFAULT);
    }, [accessToken]);

    return (
        <div className="center space-y-8 max-w-xs">
            <button onClick={openLinearAuth} disabled={!!accessToken}>
                <span>Authorize Linear</span>
                {accessToken && <CheckIcon className="ml-4 h-6 w-6" />}
            </button>
            {accessToken && (
                <div className="center text-center space-y-2">
                    <div>Your access token</div>
                    <button onClick={copyAccessToken}>
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

