import Head from "next/head";
import React from "react";

/**
 * Common page headers: viewport and favicons for now.
 * @param {string} title of the page.
 * @param {string} description of the page. Aim for <150 characters for SEO.
 * @returns Next.js <Head /> with title, meta tags, and link tags
 */
function PageHead({
    title = "Linear-GitHub Sync",
    description = "Full end-to-end sync of Linear tickets and GitHub issues. An open-source project by Cal.com and Neat.run.",
    linkPreview = "https://user-images.githubusercontent.com/8019099/188273531-5ce9fa14-b8cf-4c9b-994b-2e00e3e5d537.png"
}) {
    return (
        <Head>
            <title>{title}</title>

            {/* Meta */}
            <meta
                name="viewport"
                content="width=device-width,initial-scale=1.0"
            />
            <meta name="theme-color" content="#F2F2F2" />
            <meta name="description" content={description} />

            {/* OG */}
            <meta property="og:title" content="Linear-GitHub Sync" />
            <meta property="og:description" content={description} />
            <meta property="og:url" content="https://synclinear.com" />
            <meta property="og:type" content="website" />
            <meta property="og:site_name" content="Linear-GitHub Sync" />
            <meta property="og:image" content={linkPreview} />
            <meta property="og:card" content={linkPreview} />
            <meta property="og:image:alt" content="Linear-GitHub Sync logos" />

            {/* Twitter */}
            <meta name="twitter:title" content={title} />
            <meta name="twitter:description" content={description} />
            <meta name="twitter:card" content="summary_large_image" />
            <meta name="twitter:image" content={linkPreview} />
            <meta name="twitter:image:alt" content="Linear-GitHub Sync logos" />

            {/* Links */}
            <link
                rel="preload"
                href="/fonts/CalSans-SemiBold.woff"
                as="font"
                crossOrigin=""
                type="font/woff"
            />
            <link rel="icon" type="image/svg+xml" href="/favicon.svg" />
            <link rel="alternate icon" href="/favicon.ico" />
            <link
                rel="icon"
                type="image/png"
                sizes="32x32"
                href="/favicon-32x32.png"
            />
            <link
                rel="icon"
                type="image/png"
                sizes="16x16"
                href="/favicon-16x16.png"
            />
            <link
                rel="apple-touch-icon"
                sizes="180x180"
                href="/apple-touch-icon.png"
            />
        </Head>
    );
}

export default PageHead;

