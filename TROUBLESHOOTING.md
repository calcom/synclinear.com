# Troubleshooting

Having issues? Read through this guide before raising an issue on the repo to see if any of the following solutions work for you.  

- Also be sure to check [issues](https://github.com/calcom/synclinear.com/issues) for an open or closed item that relates to the issue you are having.

## Linear not syncing data to GitHub

In order for data to sync from Linear to GitHub, your Linear account must have both: 
- the SyncLinear application installed
- the SyncLinear webhook

### Linear application

To ensure the application is installed, see [Linear application settings](https://linear.app/settings/account/security). You should see the app installed.

<img width="667" alt="image" src="https://github.com/user-attachments/assets/cc81f256-aa6f-43e2-9a3b-8334f45c91a4" />

### Linear webhook

For the webhook, you can see your existing webhooks under [webhook settings](https://linear.app/settings/api).

You should have a Linear webhook with the following configuration. If it's not there and you've already set SyncLinear up, you can add it manually.

<img width="673" alt="image" src="https://github.com/user-attachments/assets/6384e416-d14a-4134-a7d3-20f552f2b6ce" />

Your Linear data should now be syncing to GitHub!

## GitHub not syncing data to Linear

If you are having issues with GitHub syncing to Linear, your GitHub account must have both:
- The SyncLinear OAuth application installed
- The SyncLinear webhook in GitHub

### GitHub application

To ensure the application is installed, see [GitHub application settings](https://github.com/settings/applications).

Under the `Authorized OAuth Apps` You should see the SyncLinear installed.

### GitHub webhook

Finally, we can ensure that the webhook GitHub triggers when an event occurs is functioning correctly. See:

`https://github.com/<your-org>/<your-repo>/settings/hooks`

You should see a webhook to `https://synclinear.com/api`. Have a look at the **Recent Deliveries** tab. 

Are there any webhooks failing? If your integration is not working and you are seeing errors, please [raise an issue](https://github.com/calcom/synclinear.com/issues/new) with the body/error message of the webhook request.

<img width="801" alt="Screenshot 2023-02-09 at 18 46 30" src="https://user-images.githubusercontent.com/11256663/217908361-8fa08cf7-1b46-4f4c-a6f7-8a662c234e8c.png">
