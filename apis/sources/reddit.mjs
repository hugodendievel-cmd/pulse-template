// apis/sources/reddit.mjs — Reddit AI subreddits (OAuth when configured, public fallback)
// config: { subreddits?: string[] } — defaults preserve AI behavior
import log from "../../lib/logger.mjs";
import { safeFetch } from "../utils/fetch.mjs";

const SUBREDDITS = [
  "MachineLearning",
  "artificial",
  "LocalLLaMA",
  "singularity",
];

// Module-level cache. Shape when set:
//   { token: string, expiresAt: number, clientId: string, clientSecret: string }
// Credentials are read at call time inside getOAuthToken() so key rotation
// takes effect without a restart. Two concurrent cache misses may each fire
// an OAuth request; the second write wins — a minor rate waste, not a bug.
let cachedToken = null;

async function getOAuthToken() {
  const clientId = process.env.REDDIT_CLIENT_ID;
  const clientSecret = process.env.REDDIT_CLIENT_SECRET;

  // No credentials → public path
  if (!clientId || !clientSecret) return null;

  // Cache hit: same creds, token not expired
  if (
    cachedToken &&
    cachedToken.clientId === clientId &&
    cachedToken.clientSecret === clientSecret &&
    Date.now() < cachedToken.expiresAt
  ) {
    return cachedToken.token;
  }

  // Cache miss or creds rotated — fetch a new token
  try {
    const credentials = Buffer.from(`${clientId}:${clientSecret}`).toString(
      "base64",
    );
    const res = await fetch("https://www.reddit.com/api/v1/access_token", {
      method: "POST",
      headers: {
        Authorization: `Basic ${credentials}`,
        "Content-Type": "application/x-www-form-urlencoded",
        "User-Agent": "AIPulse/1.0",
      },
      body: "grant_type=client_credentials",
    });
    if (!res.ok) {
      log.warn(
        { status: res.status },
        "Reddit OAuth token request failed — falling back to public JSON",
      );
      cachedToken = null;
      return null;
    }
    const data = await res.json();
    cachedToken = {
      token: data.access_token,
      expiresAt: Date.now() + (data.expires_in - 60) * 1000,
      clientId,
      clientSecret,
    };
    return cachedToken.token;
  } catch (err) {
    log.warn(
      { err: err.message },
      "Reddit OAuth token request threw — falling back to public JSON",
    );
    cachedToken = null;
    return null;
  }
}

export async function briefing(config = {}) {
  const subs = config.subreddits ?? SUBREDDITS;
  const token = await getOAuthToken();
  const useOAuth = !!token;

  const results = await Promise.allSettled(
    subs.map((sub) => {
      const url = useOAuth
        ? `https://oauth.reddit.com/r/${sub}/hot?limit=15`
        : `https://www.reddit.com/r/${sub}/hot.json?limit=15`;
      const headers = useOAuth
        ? { Authorization: `Bearer ${token}`, "User-Agent": "AIPulse/1.0" }
        : { "User-Agent": "AIPulse/1.0" };
      return safeFetch(url, { timeout: 12000, headers });
    }),
  );

  const items = [];
  results.forEach((r, i) => {
    if (r.status !== "fulfilled") return;
    const posts = r.value?.data?.children || [];
    for (const p of posts) {
      const d = p.data;
      if (d.stickied) continue;
      items.push({
        title: d.title,
        subreddit: subs[i],
        score: d.score,
        comments: d.num_comments,
        author: d.author,
        url: d.url,
        permalink: `https://reddit.com${d.permalink}`,
        created: new Date(d.created_utc * 1000).toISOString(),
        flair: d.link_flair_text || null,
      });
    }
  });

  items.sort((a, b) => b.score - a.score);

  return {
    source: "Reddit",
    category: "community",
    count: items.length,
    items: items.slice(0, 25),
  };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  briefing().then((d) => console.log(JSON.stringify(d, null, 2)));
}
