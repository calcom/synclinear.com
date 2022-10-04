import { ArrowUpIcon } from "@radix-ui/react-icons";
import React from "react";
import { GENERAL } from "../utils/constants";
import GitHubLogo from "./icons/GitHubLogo";

const Landing = () => {
    return (
        <section className="w-screen min-h-screen center gap-40 py-40">
            <div className="space-y-12 text-center max-w-xl">
                <h2>What does it do?</h2>
                <h3>
                    Linear-GitHub Sync lets you mirror Linear tickets in a
                    public repo by adding a special <code>Public</code> tag.
                </h3>
                <h3>Comments on the mirrored issue sync back.</h3>
                <h3>
                    This way, open-source teams can chat with contributors
                    without giving access to an internal Linear team.
                </h3>
            </div>
            <div className="space-y-12 text-center max-w-xl">
                <h2>How does it work?</h2>
                <h3>
                    Under the hood, webhooks ping the app from both Linear and
                    GitHub when issues and comments are made.
                </h3>
                <h3>
                    User tokens are encrypted at rest and in transit, accessible
                    only by a team's webhook.
                </h3>
            </div>
            <div className="space-y-12 center">
                <h2 className="text-center">How do I set it up?</h2>
                <ul className="text-xl font-tertiary">
                    <li>
                        1. One member of your Linear team selects a GitHub repo
                        to sync with
                    </li>
                    <li>
                        2. All members of your team authorize the app to open
                        issues as them
                    </li>
                    <li>
                        3. Add the <code>Public</code> tag to a Linear ticket to
                        mirror it in the repo
                    </li>
                    <li>
                        4. Public comments on that issue will sync back to the
                        Linear ticket!
                    </li>
                </ul>
                <button
                    onClick={() =>
                        window.scrollTo({ top: 0, behavior: "smooth" })
                    }
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
                <button onClick={() => window.open(GENERAL.CONTRIBUTE_URL)}>
                    <span>Contribute</span>
                    <GitHubLogo />
                </button>
            </div>
        </section>
    );
};

export default Landing;

