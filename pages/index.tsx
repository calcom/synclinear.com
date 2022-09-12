import React from "react";
import LinearAuthButton from "../components/LinearAuthButton";
import SyncArrow from "../components/SyncArrow";

const index = () => {
    return (
        <div className="w-screen h-screen center gap-40">
            <h1>Linear-GitHub Sync</h1>
            <div className="w-full flex justify-center gap-20">
                <LinearAuthButton />
                <div className="center w-56 shrink gap-4">
                    <SyncArrow direction="right" />
                    <SyncArrow direction="left" />
                </div>
                <button>Authorize GitHub</button>
            </div>
        </div>
    );
};

export default index;

