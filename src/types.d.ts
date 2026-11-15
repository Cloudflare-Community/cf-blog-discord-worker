interface Env {
  KV: KVNamespace;
  DISCORD_TOKEN: string;
}

type FeedItem = NonNullable<
  ReturnType<typeof import("htmlparser2").parseFeed>
>["items"][number];

type BlogPost = Omit<FeedItem, "media" | "id" | "pubDate"> & {
  id: string;
  pubDate: Date;
  image?: string;
  messageId?: string;
  hasUpdate?: boolean;
};

type CachedBlogPost = Omit<BlogPost, "pubDate"> & { pubDate: string };
