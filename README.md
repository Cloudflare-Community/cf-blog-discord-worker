# Cloudflare Blog to Discord Worker

This is a simple worker that checks the Cloudflare Blog RSS for new posts and sends them to the specified Discord channel.
It will then create a thread on the respective messages posted for people to talk

Thank you @WalshyDev for the CF Status Worker and inspiration from that.
And thank you @Erisa for input on the readme

Want to see it in action?\
We use this in the [Orange Cloud Discord](https://discord.gg/49SE2dgNsm), come check it out!

## How do I set this up?

There are a few steps to the setup, but it should hopefully be pretty straightforward:

1. Clone the repo
2. Edit `src/config.ts` with your desired settings, including the `channelId` for the Discord channel you want to post in.
3. Authenticate Wrangler with `npx wrangler login`, or set the `CLOUDFLARE_ACCOUNT_ID` and `CLOUDFLARE_API_TOKEN` environment variables (or put them in `.env`)
4. Put your account ID in `wrangler.toml` (you can get this from `npx wrangler whoami`)
5. Create the KV namespace with `npx wrangler kv:namespace create KV`
6. Put the namespace ID in `wrangler.toml`
7. Add a Discord bot token with `npx wrangler secret put DISCORD_TOKEN`
8. Run `npx wrangler deploy` :)

[![Deploy to Cloudflare Workers](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/Cloudflare-Community/cf-blog-discord-worker)

## Example

![Discord Cloudflare Blog Post](https://user-images.githubusercontent.com/323222/136501524-6411edf0-5eac-4ae7-b3aa-405735f6f19e.png)
