interface Config {
  PUBLISH_MESSAGE: boolean;
  PUBLISH_CHANNEL_ID: string;
  
  USER_AGENT: string;
  KV_PREFIX: string;
}

export default Object.freeze<Config>({
  ////////////////////////////////////////
  // Discord stuff
  ////////////////////////////////////////
  // If we should try to publish messages to Discord (requires PUBLISH_CHANNEL_ID to be an announcement channel)
  PUBLISH_MESSAGE: true,
  // Channel ID used for posting messages
  PUBLISH_CHANNEL_ID: '',

  ////////////////////////////////////////
  // Worker stuff
  ////////////////////////////////////////
  // User-Agent used for fetching the Cloudflare Blog RSS feed
  USER_AGENT: 'CF-Blog-Discord-Worker (https://github.com/phaxenor/cf-blog-discord-worker)',
  // Optional prefix for KV keys to avoid collisions with other data
  KV_PREFIX: ''
});
