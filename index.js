import { XMLParser } from 'fast-xml-parser';
import Config from './config.json';

const LAST_MODIFIED_KEY = Config.kvPrefix + 'feed:lastModified'

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '',
  // Keep values as strings so a numeric title or guid isn't turned into a number
  parseTagValue: false,
  // Needed to decode numeric entities like &#8217; which the blog uses in titles
  htmlEntities: true,
  isArray: name => name === 'item' || name === 'media:content'
})

export default {
  async fetch(request, env) {
    try {
      return await handleRequest(env);
    } catch (err) {
      return new Response(err.stack, { status: 500 });
    }
  },

  async scheduled(event, env, ctx) {
    ctx.waitUntil(handleRequest(env));
  }
}

/**
 * Handler
 * @param env
 * @returns {Promise<Response>}
 */
async function handleRequest(env) {
  // User-Agent, or we'll be hit with the are you human check
  const headers = { 'User-Agent': Config.userAgent }
  const lastModified = await env.KV.get(LAST_MODIFIED_KEY)
  if (lastModified) headers['If-Modified-Since'] = lastModified

  const response = await fetch('https://blog.cloudflare.com/rss-media', { headers });

  // Feed unchanged, so skip downloading and parsing it to stay within the free plan CPU limit
  if (response.status === 304) return new Response('Not Modified');
  if (!response.ok) throw new Error(`Failed to fetch feed: ${response.status}`);

  const xml = await response.text();
  // Reverse so old ones are posted first (catch up)
  const posts = parseItems(xml).reverse();

  const results = await Promise.all(posts.map(async post => {
    const kv = await env.KV.get(Config.kvPrefix + post.id)
    if(kv === null) return createNew(env, post)
    return createUpdate(env, kv, post)
  }));

  // Only remember the feed version once every post went through, so failures are retried next run
  const newLastModified = response.headers.get('Last-Modified')
  if (newLastModified && results.every(Boolean)) {
    await env.KV.put(LAST_MODIFIED_KEY, newLastModified)
  }

  return new Response('OK');
}

/**
 * Parse the feed into the post fields we use
 * @param xml
 * @returns {Array<Object>}
 */
function parseItems(xml) {
  const feed = parser.parse(xml)
  const items = feed.rss?.channel?.item ?? []
  if (items.length === 0) throw new Error('No items found in feed')

  return items.map(item => {
    const post = {
      id: getText(item.guid),
      title: getText(item.title),
      link: getText(item.link),
      description: getText(item.description),
      pubDate: new Date(getText(item.pubDate)),
      image: item['media:content']?.[0]?.url
    }

    // Fail loudly if the feed format changes, rather than posting or caching bad data
    if (!post.id || !post.title || !post.link || isNaN(post.pubDate.getTime())) {
      throw new Error(`Unexpected feed item format: ${JSON.stringify(post)}`)
    }

    return post
  })
}

// Tags with attributes (e.g. guid isPermaLink) parse to an object rather than a string
function getText(value) {
  if (value !== null && typeof value === 'object') return value['#text']
  return value
}


/**
 * New Blog Post
 * @param env
 * @param post
 * @returns {Promise<boolean>} false if the post failed and should be retried
 */
async function createNew(env, post) {
  // Date properties
  const prevDate = new Date();
  prevDate.setDate(prevDate.getDate() - 1);
  const postDate = new Date(post.pubDate);

  // Only post if the post date is no older than 1 day. (To catch up, and avoid API spam)
  if(postDate > prevDate) {
    post.messageId = await sendMessage(env, post);

    // dont save to KV if it failed
    if (!post.messageId) return false
    await env.KV.put(Config.kvPrefix + post.id, JSON.stringify(post))
  }

  return true
}

/**
 * Updated Blog Post
 * @param env
 * @param kv
 * @param post
 * @returns {Promise<boolean>}
 */
async function createUpdate(env, kv, post) {
  const cachedData = JSON.parse(kv)
  const date = new Date(post.pubDate)
  const cachedDate = new Date(cachedData.pubDate)

  post.messageId = cachedData.messageId

  const hasUpdated = (
      date.getTime() !== cachedDate.getTime() ||
      post.link !== cachedData.link ||
      post.title !== cachedData.title
  )

  if(hasUpdated) {
    await env.KV.put(Config.kvPrefix + cachedData.id, JSON.stringify(post))
    post.hasUpdate = true
    await sendMessage(env, post)
  }

  return true
}

async function sendMessage(env, post) {
  const { CHANNEL_ID, DISCORD_BOT_TOKEN } = env

  const messageId = post.messageId;
  const update = post.hasUpdate

  const data = {
    title: post.title,
    url: post.link,
    description: post.description,
    color: 0xf48120,
    image: {
      url: post.image,
    },
    timestamp: post.pubDate
  }

  if(Config.useEmbedThumbnail) Object.assign(data, {
    thumbnail: {
      url: 'https://blog.cloudflare.com/favicon_package_v0.16/apple-touch-icon.png'
    }
  })

  const res = await fetch(update ? `https://discord.com/api/v9/channels/${CHANNEL_ID}/messages/${messageId}` : `https://discord.com/api/v9/channels/${CHANNEL_ID}/messages`, {
    method: update ? 'PATCH' : 'POST',
    headers: {
      'Authorization': 'Bot ' + DISCORD_BOT_TOKEN,
      'Content-Type': 'application/json',
      'User-Agent': Config.userAgent
    },
    body: JSON.stringify({
      embeds: [data]
    })
  });

  if (!res.ok) {
    console.error(`Failed to ${update ? 'update' : 'create'} message for post: ${post.title}\n{${await res.text()}}`)
    return null;
  }

  if(!update) {
    const msg = await res.json();

    const threadRes = await fetch(`https://discord.com/api/v9/channels/${CHANNEL_ID}/messages/${msg.id}/threads`, {
      method: 'POST',
      headers: {
        'Authorization': 'Bot ' + DISCORD_BOT_TOKEN,
        'Content-Type': 'application/json',
        'User-Agent': Config.userAgent
      },
      body: JSON.stringify({
        name: post.title,
        auto_archive_duration: 1440
      })
    })

    // Added mainly for use in the Cloudflare Dev discord
    if(Config.discordCrosspost) {
      await fetch(`https://discord.com/api/v9/channels/${CHANNEL_ID}/messages/${msg.id}/crosspost`, {
        method: 'POST',
        headers: {
          'Authorization': 'Bot ' + DISCORD_BOT_TOKEN,
          'Content-Type': 'application/json',
          'User-Agent': Config.userAgent
        }
      })
    }

    return msg.id
  } else {
    await fetch(`https://discord.com/api/v9/channels/${messageId}`, {
      method: 'PATCH',
      headers: {
        'Authorization': 'Bot ' + DISCORD_BOT_TOKEN,
        'Content-Type': 'application/json',
        'User-Agent': Config.userAgent
      },
      body: JSON.stringify({
        name: post.title
      })
    })
  }

  return true
}