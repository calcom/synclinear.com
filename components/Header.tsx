import React from "react";
import LoginButton from "./LoginButton";

const Header = () => {
    return (
        <header className="sticky top-0 z-10 w-full">
            <div className="p-3 sm:px-6 flex items-center justify-between gap-4">
                <div className="text-xl font-cal-sans font-tertiary font-semibold">
                    SyncLinear.com
                </div>
                <LoginButton />
            </div>
        </header>
    );
};

export default Header;

