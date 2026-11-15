interface Env {
	KV: KVNamespace;
	DISCORD_TOKEN: string;
}

interface ParsedItem {
	guid: string | { "#text": string };
	title: string | { "#text": string };
	link: string | { "#text": string };
	description: string | { "#text": string };
	pubDate: string | { "#text": string };
	"media:content"?: Array<{ url: string }>;
}

interface BlogPost {
	id: string;
	title: string;
	link: string;
	description: string;
	pubDate: Date;
	image?: string;
	messageId?: string;
	hasUpdate?: boolean;
}

interface CachedBlogPost extends Omit<BlogPost, "pubDate"> {
	pubDate: string;
}
