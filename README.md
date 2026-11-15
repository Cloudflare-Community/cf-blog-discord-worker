## Cloudflare Blog to Discord Worker
This is a simple worker that checks the Cloudflare Blog RSS for new posts and sends them to the specified Discord channel.
It will then create a thread on the respective messages posted for people to talk

Initially wanted CF Blog post updates on my private discord, to help me keep various feeds in one place without the need for various apps/extensions to stay up to date.

But after reading the Cloudflare Dev Discord and them also wanted something for their server, but with threads, I decided to change it around and support that. Possibly for my own future use too.

Thank you @WalshyDev for the CF Status Worker and inspiration from that.
And thank you @Erisa for input on the readme

---
### How to set up

There are a few steps to the setup, but it should hopefully be pretty straightforward:

1. Clone the repo
2. Edit `config.json` with your desired settings, including the `channelId` for the Discord channel you want to post in.
3. Authenticate Wrangler with `npx wrangler login`, or set the `CLOUDFLARE_ACCOUNT_ID` and `CLOUDFLARE_API_TOKEN` environment variables (or put them in `.env`)
4. Put your account ID in `wrangler.toml` (you can get this from `npx wrangler whoami`)
5. Create the KV namespace with `npx wrangler kv:namespace create KV`
6. Put the namespace ID in `wrangler.toml`
7. Add a Discord bot token with `npx wrangler secret put DISCORD_BOT_TOKEN`
8. Run `npx wrangler deploy` :)

[![Deploy to Cloudflare Workers](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/PhaxeNor/cf-blog-discord-worker)

### Config
Default Config
```json
{
  "useEmbedThumbnail": false,
  "discordCrosspost": false,
  "userAgent": "CF-Blog-Discord-Worker (https://github.com/phaxenor/cf-blog-discord-worker)",
  "kvPrefix": "",
  "channelId": ""
}
```

`useEmbedThumbnail`: Add a Cloudflare thumbnail icon. Useful if you have more messages posted by the same bot.

`discordCrosspost`: Crosspost (Discord News Channel) messages to followers. 

`userAgent`: The user agent used when making web requests

`kvPrefix`: Prefix for your key-value namespace, if needed. 

`channelId`: The ID of the Discord channel where messages will be posted.

### Example
![Discord Cloudflare Blog Post](https://user-images.githubusercontent.com/323222/136501524-6411edf0-5eac-4ae7-b3aa-405735f6f19e.png)
