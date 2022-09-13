import { LINEAR } from "./constants";

export const getLinearAuthURL = (verificationCode: string) => {
    // Specify OAuth app and scopes
    const params = {
        client_id: LINEAR.OAUTH_ID,
        redirect_uri: window.location.origin,
        scope: LINEAR.SCOPES.join(","),
        state: verificationCode,
        response_type: "code"
    };

    // Combine params in a URL-friendly string
    const authURL = Object.keys(params).reduce(
        (url, param, i) =>
            `${url}${i == 0 ? "?" : "&"}${param}=${params[param]}`,
        LINEAR.OAUTH_URL
    );

    return authURL;
};

export const copyToClipboard = (text: string) => {
    if (!window?.navigator) {
        throw new Error("window.navigator is not defined");
    }

    navigator?.clipboard?.writeText(text);
};

