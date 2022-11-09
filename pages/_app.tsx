import React from "react";
import ContextProvider from "../components/ContextProvider";
import "../styles/globals.css";

export default function App({ Component, pageProps }) {
    return (
        <ContextProvider>
            <Component {...pageProps} />
        </ContextProvider>
    );
}
