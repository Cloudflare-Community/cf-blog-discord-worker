import { XMLParser } from "fast-xml-parser";
import config from "./config";

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "",
  parseTagValue: false,
  htmlEntities: true,
  isArray: (name: string) => name === "item" || name === "media:content",
});

const LAST_MODIFIED_KEY = config.KV_PREFIX + "feed:lastModified";

function getText(value: unknown): string | undefined {
  if (value !== null && typeof value === "object" && "#text" in value) {
    return (value as Record<string, string>)["#text"];
  }
  return value as string | undefined;
}

function parseItems(xml: string): BlogPost[] {
  const feed = parser.parse(xml) as {
    rss?: { channel?: { item?: ParsedItem[] } };
  };
  const items = feed.rss?.channel?.item ?? [];
  if (items.length === 0) throw new Error("No items found in feed");

  return items.map((item) => {
    const post: BlogPost = {
      id: getText(item.guid) || "",
      title: getText(item.title) || "",
      link: getText(item.link) || "",
      description: getText(item.description) || "",
      pubDate: new Date(getText(item.pubDate) || ""),
      image: item["media:content"]?.[0]?.url,
    };

    // Fail loudly if the feed format changes, rather than posting or caching bad data
    if (
      !post.id ||
      !post.title ||
      !post.link ||
      isNaN(post.pubDate.getTime())
    ) {
      throw new Error(`Unexpected feed item format: ${JSON.stringify(post)}`);
    }

    return post;
  });
}

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
    const headers: Record<string, string> = {
      "User-Agent": config.USER_AGENT,
    };
    const lastModified = await env.KV.get(LAST_MODIFIED_KEY);
    if (lastModified) headers["If-Modified-Since"] = lastModified;

    const response = await fetch("https://blog.cloudflare.com/rss-media", {
      headers,
    });

    // Feed unchanged, so skip downloading and parsing it to stay within the free plan CPU limit
    if (response.status === 304) return;
    if (!response.ok) throw new Error(`Failed to fetch feed: ${response.status}`);

    const xml = await response.text();
    // Reverse so old ones are posted first (catch up)
    const posts = parseItems(xml).reverse();

    const results = await Promise.all(
      posts.map(async (post) => {
        const kv = await env.KV.get(config.KV_PREFIX + post.id);
        if (kv === null) return this.createNew(post, env);
        return this.createUpdate(kv, post, env);
      }),
    );

    // Only remember the feed version once every post went through, so failures are retried next run
    const newLastModified = response.headers.get("Last-Modified");
    if (newLastModified && results.every(Boolean)) {
      await env.KV.put(LAST_MODIFIED_KEY, newLastModified);
    }
  },

  async createNew(post: BlogPost, env: Env) {
    // Date properties
    const prevDate = new Date();
    prevDate.setDate(prevDate.getDate() - 1);

    // Only post if the post date is no older than 1 day. (To catch up, and avoid API spam)
    if (post.pubDate > prevDate) {
      const messageId = await this.sendMessage(post, env);

      // dont save to KV if it failed
      if (!messageId) return false;
      post.messageId = messageId as string;
      await env.KV.put(config.KV_PREFIX + post.id, JSON.stringify(post));
    }

    return true;
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

    return true;
  },

  async sendMessage(post: BlogPost, env: Env) {
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
