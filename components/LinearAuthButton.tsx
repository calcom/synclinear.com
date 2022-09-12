import React, { useEffect } from "react";
import { v4 as uuid } from "uuid";
import { getLinearAuthURL } from "../utils";
import { LINEAR } from "../utils/constants";

const LinearAuthButton = () => {
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
            .then(body => console.log(body));
    }, []);

    const openLinearAuth = () => {
        // Generate random code to validate against CSRF attack
        const verificationCode = uuid();
        localStorage.setItem("linear-verification", verificationCode);
        window.open(getLinearAuthURL(verificationCode));
        window.close();
    };

    return <button onClick={openLinearAuth}>Authorize Linear</button>;
};

export default LinearAuthButton;

