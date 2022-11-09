import React, { createContext, useState } from "react";
import { Sync } from "../typings";

export const Context = createContext<any>({});

const ContextProvider = ({ children }: { children: React.ReactNode }) => {
    const [syncs, setSyncs] = useState<Sync[]>([]);
    const [gitHubToken, setGitHubToken] = useState("");
    const [gitHubUsername, setGitHubUsername] = useState("");

    return (
        <Context.Provider
            value={{
                syncs,
                setSyncs,
                gitHubToken,
                setGitHubToken,
                gitHubUsername,
                setGitHubUsername
            }}
        >
            {children}
        </Context.Provider>
    );
};

export default ContextProvider;

