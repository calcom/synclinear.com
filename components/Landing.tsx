import { ArrowUpIcon } from "@radix-ui/react-icons";
import React from "react";
import { GENERAL } from "../utils/constants";
import GitHubLogo from "./icons/GitHubLogo";

const Landing = () => {
    return (
        <section className="w-screen min-h-screen center gap-40 py-40 px-6">
            <div className="space-y-12 text-center max-w-xl">
                <h2>What does it do?</h2>
                <h3>
                    This app lets you mirror Linear tickets to public GitHub
                    issues, comments and all.
                </h3>
                <h3>
                    This way, open-source teams can chat with contributors
                    without giving access to an internal Linear team.
                </h3>
            </div>
            <div className="space-y-12 text-center max-w-xl">
                <h2>How does it work?</h2>
                <h3>
                    Under the hood, a webhook pings the app with new issues and
                    comments.
                </h3>
                <h3>
                    Access tokens are encrypted at rest and in transit,
                    accessible only by your team's webhook.
                </h3>
            </div>
            <div className="space-y-12 center">
                <h2 className="text-center">How do I set it up?</h2>
                <ul className="text-xl font-tertiary">
                    <li>
                        1. If you're setting this up for your team, simply pick
                        your Linear team and a GitHub repo
                    </li>
                    <li>
                        2. If you're joining a team, simply authorize the app to
                        open issues as you
                    </li>
                    <li>
                        3. Label a Linear ticket as <code>Public</code> (or
                        label a GitHub issue as <code>linear</code>) to mirror
                        it
                    </li>
                    <li>4. Comments on that issue will sync back!</li>
                </ul>
                <button
                    onClick={() =>
                        window.scrollTo({ top: 0, behavior: "smooth" })
                    }
                    aria-label="Scroll to top"
                >
                    <span>Get started</span>
                    <ArrowUpIcon className="w-6 h-6" />
                </button>
            </div>
            <div className="space-y-12 max-w-xl text-center center">
                <h2 className="text-center">Missing something?</h2>
                <h3>
                    This app is completely open-source (even this sentence). If
                    you're facing a problem or want to add a feature, please
                    open a pull request!
                </h3>
                <button
                    onClick={() => window.open(GENERAL.CONTRIBUTE_URL)}
                    aria-label="Visit codebase"
                >
                    <span>Contribute</span>
                    <GitHubLogo />
                </button>
            </div>
            <div className="space-y-12 max-w-xl text-center center">
                <h2 className="text-center">Pricing</h2>
                <h3>
                    SyncLinear.com is completely free. If you want to donate, subcribe to a <a href="https://cal.com/pricing">Cal.com</a> or <a href="https://neat.run">Neat</a> plan to support the development.
                </h3>
            </div>
        </section>
    );
};

export default Landing;

