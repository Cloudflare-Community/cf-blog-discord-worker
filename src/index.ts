import { parseFeed } from "htmlparser2";
import config from "./config";

export default {
  async fetch(_: Request, env: Env) {
    try {
      await this.handleRequest(env);

      return new Response("Ok");
    } catch (e) {
      // @ts-ignore
      return new Response(e.stack, { status: 500 });
    }
  },

  async scheduled(_: ScheduledController | null, env: Env) {
    await this.handleRequest(env);
  },

  async handleRequest(env: Env) {
    // User-Agent, or we'll be hit with the are you human check
    const response = await fetch("https://blog.cloudflare.com/rss-media", {
      headers: { "User-Agent": config.USER_AGENT },
    });

    const xml = await response.text();
    // Reverse so old ones are posted first (catch up)
    const feed = parseFeed(xml);
    if (!feed) throw new Error("Failed to parse blog RSS feed");
    const posts: BlogPost[] = feed.items.reverse().map(({ media, ...post }) => {
      if (typeof post.id !== "string" || !(post.pubDate instanceof Date)) {
        throw new Error("Blog RSS feed item is missing its id or publication date");
      }

      return {
        ...post,
        id: post.id,
        pubDate: post.pubDate,
        image: media[0]?.url,
      };
    });

    await Promise.all(
      posts.map(async (post) => {
        const kv = await env.KV.get(config.KV_PREFIX + post.id);
        if (kv === null) await this.createNew(post, env);
        else await this.createUpdate(kv, post, env);
      }),
    );
  },

  async createNew(post: BlogPost, env: Env) {
    // Date properties
    const prevDate = new Date();
    prevDate.setDate(prevDate.getDate() - 1);
    const postDate = new Date(post.pubDate.getTime());

    // Only post if the post date is no older than 1 day. (To catch up, and avoid API spam)
    if (postDate > prevDate) {
      const messageId = await this.sendMessage(post, env);

      // dont save to KV if it failed
      if (typeof messageId === "string") {
        post.messageId = messageId;
        await env.KV.put(config.KV_PREFIX + post.id, JSON.stringify(post));
      }
    }
  },

  async createUpdate(kv: string, post: BlogPost, env: Env) {
    const cachedData: CachedBlogPost = JSON.parse(kv);
    const date = post.pubDate;
    const cachedDate = new Date(cachedData.pubDate);

    post.messageId = cachedData.messageId;

    const hasUpdated =
      date.getTime() !== cachedDate.getTime() ||
      post.link !== cachedData.link ||
      post.title !== cachedData.title;

    if (hasUpdated) {
      await env.KV.put(config.KV_PREFIX + cachedData.id, JSON.stringify(post));
      post.hasUpdate = true;
      await this.sendMessage(post, env);
    }
  },

  async sendMessage(post: BlogPost, env: Env): Promise<string | true | null> {
    const messageId = post.messageId;
    const update = post.hasUpdate;

    const data = {
      title: post.title,
      url: post.link,
      description: post.description,
      color: 0xf48120,
      image: {
        url: post.image,
      },
      timestamp: post.pubDate,
    };

    const res = await fetch(
      update
        ? `https://discord.com/api/v9/channels/${config.PUBLISH_CHANNEL_ID}/messages/${messageId}`
        : `https://discord.com/api/v9/channels/${config.PUBLISH_CHANNEL_ID}/messages`,
      {
        method: update ? "PATCH" : "POST",
        headers: {
          Authorization: "Bot " + env.DISCORD_TOKEN,
          "Content-Type": "application/json",
          "User-Agent": config.USER_AGENT,
        },
        body: JSON.stringify({
          embeds: [data],
        }),
      },
    );

    if (!res.ok) {
      console.error(
        `Failed to ${update ? "update" : "create"} message for post: ${post.title}\n${await res.text()}`,
      );
      return null;
    }

    if (!update) {
      const msg: unknown = await res.json();
      if (
        typeof msg !== "object" ||
        msg === null ||
        !("id" in msg) ||
        typeof msg.id !== "string"
      ) {
        throw new Error("Discord returned a message without a valid id");
      }

      await fetch(
        `https://discord.com/api/v9/channels/${config.PUBLISH_CHANNEL_ID}/messages/${msg.id}/threads`,
        {
          method: "POST",
          headers: {
            Authorization: "Bot " + env.DISCORD_TOKEN,
            "Content-Type": "application/json",
            "User-Agent": config.USER_AGENT,
          },
          body: JSON.stringify({
            name: post.title,
            auto_archive_duration: 1440,
          }),
        },
      );

      // Added mainly for use in the Cloudflare Dev discord
      if (config.PUBLISH_MESSAGE) {
        await fetch(
          `https://discord.com/api/v9/channels/${config.PUBLISH_CHANNEL_ID}/messages/${msg.id}/crosspost`,
          {
            method: "POST",
            headers: {
              Authorization: "Bot " + env.DISCORD_TOKEN,
              "Content-Type": "application/json",
              "User-Agent": config.USER_AGENT,
            },
          },
        );
      }

      return msg.id;
    } else {
      await fetch(`https://discord.com/api/v9/channels/${messageId}`, {
        method: "PATCH",
        headers: {
          Authorization: "Bot " + env.DISCORD_TOKEN,
          "Content-Type": "application/json",
          "User-Agent": config.USER_AGENT,
        },
        body: JSON.stringify({
          name: post.title,
        }),
      });
    }

    return true;
  },
};
