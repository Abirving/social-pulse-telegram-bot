import { ApifyClient } from "apify-client";
import {
  ComputedAccountKPIs,
  NormalizedSocialPost,
  SocialPlatform,
} from "../types/social";

const apifyToken = process.env.APIFY_API_TOKEN || "";

/**
 * Scrapes recent public posts from TikTok (clockworks/tiktok-scraper)
 * or Instagram (apify/instagram-scraper) and calculates quantitative KPIs.
 */
export async function fetchAndComputeSocialKPIs(
  platform: SocialPlatform,
  rawHandleOrUrl: string,
  maxPosts = 6
): Promise<ComputedAccountKPIs> {
  const cleanHandle = extractCleanHandle(rawHandleOrUrl);

  if (!apifyToken) {
    throw new Error(
      "Missing APIFY_API_TOKEN in environment variables. Add your token from https://apify.com/ to scrape live TikTok and Instagram profiles."
    );
  }

  const client = new ApifyClient({ token: apifyToken });
  let posts: NormalizedSocialPost[] = [];

  if (platform === "tiktok") {
    // Fast path: the public tikwm.com API returns recent posts in ~1-2s,
    // avoiding the 40s Apify cold start entirely.
    const fastPosts = await fetchTikTokViaTikwm(cleanHandle);
    if (fastPosts && fastPosts.length > 0) {
      return computeMetricsFromPosts("tiktok", cleanHandle, fastPosts);
    }

    // Fallback: Apify (runs as light as possible to stay inside the timeout)
    const run = await client.actor("clockworks/tiktok-scraper").call(
      {
        profiles: [cleanHandle],
        resultsPerPage: 5,
        shouldDownloadVideos: false,
        shouldDownloadCovers: false,
        shouldDownloadSubtitles: false,
      },
      { waitSecs: 25 }
    );
    const { items } = await client.dataset(run.defaultDatasetId).listItems();
    posts = (items || []).map((item: Record<string, any>) => {
      const views = Number(item.playCount ?? item.views ?? 0);
      const likes = Number(item.diggCount ?? item.likes ?? 0);
      const comments = Number(item.commentCount ?? item.comments ?? 0);
      const shares = Number(item.shareCount ?? item.shares ?? 0);
      const caption = String(item.text ?? item.desc ?? "");
      const hashtags = Array.isArray(item.hashtags)
        ? item.hashtags.map((h: any) => `#${h.name || h}`)
        : extractHashtagsFromText(caption);
      const engagementRate =
        views > 0 ? Number((((likes + comments + shares) / views) * 100).toFixed(2)) : 0;

      return {
        id: String(item.id || Math.random()),
        platform: "tiktok",
        url: String(item.webVideoUrl || `https://www.tiktok.com/@${cleanHandle}`),
        caption,
        hashtags,
        views,
        likes,
        comments,
        shares,
        durationSeconds: Number(item.videoMeta?.duration ?? item.duration ?? 15),
        publishedAt: item.createTimeISO || new Date().toISOString(),
        engagementRate,
      };
    });
  } else {
    const run = await client.actor("apify/instagram-scraper").call(
      {
        directUrls: [`https://www.instagram.com/${cleanHandle}/`],
        resultsType: "posts",
        resultsLimit: maxPosts,
      },
      { waitSecs: 25 }
    );
    const { items } = await client.dataset(run.defaultDatasetId).listItems();
    posts = (items || []).map((item: Record<string, any>) => {
      const views = Number(item.videoViewCount ?? item.videoPlayCount ?? (Number(item.likesCount || 0) * 8));
      const likes = Number(item.likesCount ?? 0);
      const comments = Number(item.commentsCount ?? 0);
      const shares = 0;
      const caption = String(item.caption ?? "");
      const hashtags = Array.isArray(item.hashtags)
        ? item.hashtags.map((h: string) => (h.startsWith("#") ? h : `#${h}`))
        : extractHashtagsFromText(caption);
      const engagementRate =
        views > 0 ? Number((((likes + comments) / views) * 100).toFixed(2)) : 0;

      return {
        id: String(item.id || item.shortCode || Math.random()),
        platform: "instagram",
        url: String(item.url || `https://www.instagram.com/${cleanHandle}/`),
        caption,
        hashtags,
        views,
        likes,
        comments,
        shares,
        durationSeconds: Number(item.videoDuration ?? 20),
        publishedAt: item.timestamp || new Date().toISOString(),
        engagementRate,
      };
    });
  }

  if (posts.length === 0) {
    throw new Error(
      `No public posts found for @${cleanHandle} on ${platform}. Verify the username is public and spelled accurately.`
    );
  }

  return computeMetricsFromPosts(platform, cleanHandle, posts);
}

/**
 * Fast TikTok post fetcher via the public tikwm.com API (~1-2s).
 * Returns null when the API is unavailable or has no videos, so the caller
 * can fall back to Apify.
 */
async function fetchTikTokViaTikwm(
  cleanHandle: string
): Promise<NormalizedSocialPost[] | null> {
  try {
    const res = await fetch(
      `https://www.tikwm.com/api/user/posts?unique_id=${encodeURIComponent(cleanHandle)}&count=8`,
      { signal: AbortSignal.timeout(10000) }
    );
    if (!res.ok) return null;

    const json: any = await res.json();
    const videos: any[] = json?.data?.videos || [];
    if (!Array.isArray(videos) || videos.length === 0) return null;

    return videos.map((v: any): NormalizedSocialPost => {
      const views = Number(v.play_count ?? 0);
      const likes = Number(v.digg_count ?? 0);
      const comments = Number(v.comment_count ?? 0);
      const shares = Number(v.share_count ?? 0);
      const caption = String(v.title ?? "");
      const engagementRate =
        views > 0 ? Number((((likes + comments + shares) / views) * 100).toFixed(2)) : 0;

      return {
        id: String(v.video_id ?? Math.random()),
        platform: "tiktok",
        url: `https://www.tiktok.com/@${cleanHandle}/video/${v.video_id}`,
        caption,
        hashtags: extractHashtagsFromText(caption),
        views,
        likes,
        comments,
        shares,
        durationSeconds: Number(v.duration ?? 15),
        publishedAt: v.create_time
          ? new Date(v.create_time * 1000).toISOString()
          : new Date().toISOString(),
        engagementRate,
      };
    });
  } catch {
    return null;
  }
}

export function computeMetricsFromPosts(
  platform: SocialPlatform,
  handle: string,
  posts: NormalizedSocialPost[]
): ComputedAccountKPIs {
  const n = posts.length;
  const totalViews = posts.reduce((acc, p) => acc + p.views, 0);
  const totalLikes = posts.reduce((acc, p) => acc + p.likes, 0);
  const totalComments = posts.reduce((acc, p) => acc + p.comments, 0);
  const totalShares = posts.reduce((acc, p) => acc + p.shares, 0);
  const totalER = posts.reduce((acc, p) => acc + p.engagementRate, 0);
  const totalCaptionLen = posts.reduce((acc, p) => acc + p.caption.length, 0);
  const totalHashtags = posts.reduce((acc, p) => acc + p.hashtags.length, 0);

  const sortedByViews = [...posts].sort((a, b) => b.views - a.views);
  const medianViews = sortedByViews[Math.floor(n / 2)]?.views || 0;

  const topPosts = sortedByViews.slice(0, 2);
  const bottomPosts = [...sortedByViews].reverse().slice(0, 2);

  // Track best performing hashtags across top half of posts
  const hashtagCounts = new Map<string, number>();
  sortedByViews.slice(0, Math.ceil(n / 2)).forEach((p) => {
    p.hashtags.forEach((tag) => {
      const lower = tag.toLowerCase();
      hashtagCounts.set(lower, (hashtagCounts.get(lower) || 0) + 1);
    });
  });

  const topPerformingHashtags = [...hashtagCounts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 6)
    .map(([tag]) => tag);

  // Calculate best posting hours in East Africa Time (UTC+3 / Addis Ababa)
  const hourPerformance = new Map<number, { views: number; count: number }>();
  posts.forEach((p) => {
    const date = new Date(p.publishedAt);
    if (!isNaN(date.getTime())) {
      const eatHour = (date.getUTCHours() + 3) % 24;
      const prev = hourPerformance.get(eatHour) || { views: 0, count: 0 };
      hourPerformance.set(eatHour, {
        views: prev.views + p.views,
        count: prev.count + 1,
      });
    }
  });

  const bestHours = [...hourPerformance.entries()]
    .map(([hour, stats]) => ({ hour, avg: stats.views / stats.count }))
    .sort((a, b) => b.avg - a.avg)
    .slice(0, 2)
    .map(({ hour }) => `${hour.toString().padStart(2, "0")}:00 EAT (UTC+3)`);

  const avgTopDuration =
    topPosts.reduce((sum, p) => sum + p.durationSeconds, 0) / Math.max(1, topPosts.length);

  return {
    platform,
    handle,
    postsAnalyzed: n,
    avgViews: Math.round(totalViews / n),
    medianViews: Math.round(medianViews),
    avgLikes: Math.round(totalLikes / n),
    avgComments: Math.round(totalComments / n),
    avgShares: Math.round(totalShares / n),
    avgEngagementRate: Number((totalER / n).toFixed(2)),
    avgCaptionLength: Math.round(totalCaptionLen / n),
    avgHashtagCount: Number((totalHashtags / n).toFixed(1)),
    optimalDurationRange: `${Math.max(7, Math.round(avgTopDuration - 5))}s - ${Math.round(avgTopDuration + 5)}s`,
    bestPostingHoursUTC3: bestHours.length > 0 ? bestHours : ["18:00 EAT (UTC+3)", "20:00 EAT (UTC+3)"],
    topPosts,
    bottomPosts,
    topPerformingHashtags,
  };
}

export function extractCleanHandle(input: string): string {
  const trimmed = (input || "").trim();

  const tiktokMatch = trimmed.match(/tiktok\.com\/@([^/?#\s]+)/i);
  if (tiktokMatch) return tiktokMatch[1].replace(/^@/, "");

  const instaMatch = trimmed.match(/instagram\.com\/([^/?#\s]+)/i);
  if (instaMatch && !/^(p|reel|reels|stories|tv)$/i.test(instaMatch[1])) {
    return instaMatch[1].replace(/^@/, "");
  }

  return trimmed.replace(/^@/, "").split(/[/?#\s]/)[0];
}

function extractHashtagsFromText(text: string): string[] {
  const matches = text.match(/#[\p{L}\p{N}_]+/gu);
  return matches ? Array.from(new Set(matches)) : [];
}
