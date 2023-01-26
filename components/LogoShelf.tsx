import React from "react";
import AmieLogo from "./logos/AmieLogo";
import CalLogo from "./logos/Cal";
import LivepeerLogo from "./logos/Livepeer";
import NovuLogo from "./logos/Novu";
import PostHogLogo from "./logos/PostHog";

function LogoShelf() {
    const LOGOS = [
        { url: "https://cal.com", Logo: CalLogo },
        { url: "https://posthog.com", Logo: PostHogLogo },
        { url: "https://amie.so", Logo: AmieLogo },
        {
            url: "https://livepeer.org",
            Logo: LivepeerLogo
        },
        { url: "https://novu.co", Logo: NovuLogo }
    ];

    return (
        <div className="space-y-4 text-center max-w-xl">
            <h4 className="uppercase font-tertiary tracking-widest">Used by</h4>
            <div className="flex flex-col md:flex-row gap-6 items-center justify-center">
                {LOGOS.map(({ url, Logo }) => (
                    <a href={url} target="_blank" rel="noreferrer">
                        <Logo className="h-6 max-w-[12rem] font-tertiary hover:font-secondary transition-colors" />
                    </a>
                ))}
            </div>
        </div>
    );
}

export default LogoShelf;

