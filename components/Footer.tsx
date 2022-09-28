import React from "react";
import GitHubLogo from "./icons/GitHubLogo";

const Footer = () => {
    return (
        <footer className="w-screen p-6 text-lg font-light text-gray-200">
            <div className="p-20 flex items-center justify-between bg-gray-900 rounded-3xl">
                <a
                    href="https://github.com/calcom/linear-to-github"
                    rel="noreferrer"
                    target="_blank"
                    className="text-gray-400 hover:text-gray-100"
                >
                    <GitHubLogo />
                </a>
                <div className="space-x-1">
                    <span>An open-source project by</span>
                    <a
                        href="https://cal.com"
                        className="font-cal-sans"
                        rel="noreferrer"
                        target="_blank"
                    >
                        Cal.com
                    </a>
                    <span>and</span>
                    <a
                        href="https://studio.neat.run"
                        rel="noreferrer"
                        target="_blank"
                    >
                        Neat.run
                    </a>
                </div>
                <div></div>
            </div>
        </footer>
    );
};

export default Footer;

