const Config = require('./config.json')

const LAST_MODIFIED_KEY = Config.kvPrefix + 'feed:lastModified'

addEventListener('fetch', event => {
  event.respondWith(handleRequest(event.request)
      .catch((err) => new Response(err.stack, { status: 500 }))
  );
})

addEventListener('scheduled', event => {
  event.waitUntil(handleRequest(event));
})

/**
 * Handler
 * @param event
 * @returns {Promise<Response>}
 */
async function handleRequest(event) {
  // User-Agent, or we'll be hit with the are you human check
  const headers = { 'User-Agent': Config.userAgent }
  const lastModified = await KV.get(LAST_MODIFIED_KEY)
  if (lastModified) headers['If-Modified-Since'] = lastModified

  const response = await fetch('https://blog.cloudflare.com/rss-media', { headers });

  // Feed unchanged, so skip downloading and parsing it to stay within the free plan CPU limit
  if (response.status === 304) return new Response('Not Modified');
  if (!response.ok) throw new Error(`Failed to fetch feed: ${response.status}`);

  const xml = await response.text();
  // Reverse so old ones are posted first (catch up)
  const posts = parseItems(xml).reverse();

  const results = await Promise.all(posts.map(async post => {
    const kv = await KV.get(Config.kvPrefix + post.id)
    if(kv === null) return createNew(post)
    return createUpdate(kv, post)
  }));

  // Only remember the feed version once every post went through, so failures are retried next run
  const newLastModified = response.headers.get('Last-Modified')
  if (newLastModified && results.every(Boolean)) {
    await KV.put(LAST_MODIFIED_KEY, newLastModified)
  }

  return new Response('OK');
}

/**
 * Extract only the fields we need, skipping content:encoded which is most of the feed
 * @param xml
 * @returns {Array<Object>}
 */
function parseItems(xml) {
  const items = []
  let start = xml.indexOf('<item>')

  while (start !== -1) {
    const end = xml.indexOf('</item>', start)
    if (end === -1) break

    let item = xml.slice(start, end)

    const contentStart = item.indexOf('<content:encoded>')
    const contentEnd = item.indexOf('</content:encoded>', contentStart)
    if (contentStart !== -1 && contentEnd !== -1) {
      item = item.slice(0, contentStart) + item.slice(contentEnd)
    }

    const media = item.match(/<media:content[^>]*\burl="([^"]*)"/)
    const post = {
      id: getTag(item, 'guid'),
      title: getTag(item, 'title'),
      link: getTag(item, 'link'),
      description: getTag(item, 'description'),
      pubDate: new Date(getTag(item, 'pubDate')),
      image: media ? decodeEntities(media[1]) : undefined
    }

    // Fail loudly if the feed format changes, rather than posting or caching bad data
    if (!post.id || !post.title || !post.link || isNaN(post.pubDate.getTime())) {
      throw new Error(`Unexpected feed item format: ${item.slice(0, 500)}`)
    }

    items.push(post)
    start = xml.indexOf('<item>', end)
  }

  if (items.length === 0) throw new Error('No items found in feed')

  return items
}

function getTag(xml, tag) {
  const match = xml.match(new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)</${tag}>`))
  if (!match) return undefined

  const cdata = match[1].match(/^\s*<!\[CDATA\[([\s\S]*)\]\]>\s*$/)
  if (cdata) return cdata[1].trim()
  return decodeEntities(match[1].trim())
}

function decodeEntities(text) {
  return text.replace(/&(#x[\da-f]+|#\d+|amp|lt|gt|quot|apos);/gi, (entity, code) => {
    const lower = code.toLowerCase()
    if (lower === 'amp') return '&'
    if (lower === 'lt') return '<'
    if (lower === 'gt') return '>'
    if (lower === 'quot') return '"'
    if (lower === 'apos') return "'"
    if (lower[1] === 'x') return String.fromCodePoint(parseInt(lower.slice(2), 16))
    return String.fromCodePoint(parseInt(lower.slice(1), 10))
  })
}


/**
 * New Blog Post
 * @param post
 * @returns {Promise<boolean>} false if the post failed and should be retried
 */
async function createNew(post) {
  // Date properties
  const prevDate = new Date();
  prevDate.setDate(prevDate.getDate() - 1);
  const postDate = new Date(post.pubDate);

  // Only post if the post date is no older than 1 day. (To catch up, and avoid API spam)
  if(postDate > prevDate) {
    post.messageId = await sendMessage(post);

    // dont save to KV if it failed
    if (!post.messageId) return false
    await KV.put(Config.kvPrefix + post.id, JSON.stringify(post))
  }

  return true
}

/**
 * Updated Blog Post
 * @param kv
 * @param post
 * @returns {Promise<boolean>}
 */
async function createUpdate(kv, post) {
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
    await KV.put(Config.kvPrefix + cachedData.id, JSON.stringify(post))
    post.hasUpdate = true
    await sendMessage(post)
  }

  return true
}

async function sendMessage(post) {

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