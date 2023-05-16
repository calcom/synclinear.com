import {
    ArrowLeftIcon,
    ArrowRightIcon,
    ArrowUpIcon,
    QuestionMarkCircledIcon
} from "@radix-ui/react-icons";
import React, { Fragment } from "react";
import { GENERAL } from "../utils/constants";
import GitHubLogo from "./icons/GitHubLogo";
import Tooltip from "./Tooltip";

const Landing = () => {
    return (
        <section className="w-full min-h-screen center gap-40 py-40 px-6">
            <div className="mx-6 p-6 sm:p-12 w-full rounded-3xl bg-gray-900 center">
                <div className="space-y-10 max-w-xl text-center">
                    <h2 className="text-gray-200">What does it do?</h2>
                    <h3 className="font-negative">
                        This app lets you mirror Linear and GitHub issues.
                    </h3>
                    <h3 className="font-negative">
                        This way, open-source teams can chat with contributors
                        without giving access to an internal Linear team.
                    </h3>
                </div>
            </div>
            <div className="space-y-10 text-center max-w-xl">
                <h2>What gets synced?</h2>
                <h3>
                    Full two-way sync means titles, descriptions, and labels are
                    magically kept in sync.
                </h3>
                <div className="grid grid-cols-3 font-tertiary gap-y-3">
                    <>
                        <h2 className="text-right font-tertiary">Linear</h2>
                        <div />
                        <h2 className="text-left font-tertiary">GitHub</h2>
                    </>
                    {GENERAL.SYNCED_ITEMS.map(
                        ({
                            linearField,
                            githubField,
                            toGithub,
                            toLinear,
                            notes
                        }) => (
                            <Fragment key={`${linearField}-${githubField}`}>
                                <code className="ml-auto">{linearField}</code>
                                <div className="center !flex-row">
                                    {!toLinear && !toGithub ? (
                                        <span className="italic">
                                            Coming soon
                                        </span>
                                    ) : (
                                        <>
                                            {toLinear ? (
                                                <ArrowLeftIcon className="w-6 h-6 translate-x-1" />
                                            ) : (
                                                <div className="w-6 h-6" />
                                            )}
                                            {toGithub ? (
                                                <ArrowRightIcon className="w-6 h-6 -translate-x-1" />
                                            ) : (
                                                <div className="w-6 h-6" />
                                            )}
                                        </>
                                    )}
                                </div>
                                <div className="flex justify-between">
                                    <code>{githubField}</code>
                                    {notes && (
                                        <Tooltip content={notes}>
                                            <QuestionMarkCircledIcon className="w-6 h-6 text-gray-400 hover:font-secondary transition-colors duration-200" />
                                        </Tooltip>
                                    )}
                                </div>
                            </Fragment>
                        )
                    )}
                </div>
            </div>
            <div className="space-y-10 text-center max-w-xl">
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
            <div className="space-y-10 center">
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
            <div className="space-y-10 max-w-xl text-center center">
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
            <div className="space-y-10 max-w-xl text-center center">
                <h2 className="text-center">Pricing</h2>
                <h3>
                    SyncLinear.com is completely free. If you want to donate,
                    subscribe to a <a href="https://cal.com/pricing">Cal.com</a>{" "}
                    or <a href="https://neat.run/pro">Neat</a> plan to support
                    the development.
                </h3>
            </div>
        </section>
    );
};

export default Landing;
