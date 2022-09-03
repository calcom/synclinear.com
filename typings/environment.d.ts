declare global {
    namespace NodeJS {
        interface ProcessEnv {
            LINEAR_API_KEY: string;
            GITHUB_API_KEY: string;
            GITHUB_WEBHOOK_SECRET: string;

            LINEAR_USER_ID: string;
            LINEAR_TEAM_ID: string;

            LINEAR_PUBLIC_LABEL_ID: string;
            LINEAR_CANCELED_STATE_ID: string;
            LINEAR_DONE_STATE_ID: string;
            LINEAR_TODO_STATE_ID: string;
            LINEAR_IN_PROGRESS_STATE_ID: string;

            GITHUB_OWNER: string;
            GITHUB_REPO: string;
        }
    }
}

export {};

