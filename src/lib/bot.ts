import { Bot, InlineKeyboard } from "grammy";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import {
  createClientBrand,
  getActiveBrandProfile,
  getLastAuditForSession,
  listClientBrands,
  saveAuditResult,
  saveVideoRoastResult,
  switchActiveClientBrand,
} from "./supabase";
import { fetchAndComputeSocialKPIs } from "./scraper";
import {
  analyzeUploadedVideoDraft,
  generateAccountAuditAdvice,
  generateCompetitorSpyReport,
  generateHooksAndHashtagsForTopic,
} from "./gemini";
import { SocialPlatform } from "../types/social";

const token = process.env.TELEGRAM_BOT_TOKEN || "REPLACE_WITH_TELEGRAM_BOT_TOKEN";
export const bot = new Bot(token);

// Optional Whitelist: Restrict internal agency bot to your Telegram user IDs if configured
const allowedIds = (process.env.ALLOWED_TELEGRAM_USER_IDS || "")
  .split(",")
  .map((s) => Number(s.trim()))
  .filter((n) => !isNaN(n) && n > 0);

bot.use(async (ctx, next) => {
  const userId = ctx.from?.id;
  if (allowedIds.length > 0 && userId && !allowedIds.includes(userId)) {
    await ctx.reply("🔒 This is a private agency social media analytics bot.");
    return;
  }
  await next();
});

// ============================================================================
// 1. /start & /help — Agency Control Center
// ============================================================================
bot.command(["start", "help"], async (ctx) => {
  const userId = ctx.from?.id || 0;
  const activeBrand = await getActiveBrandProfile(userId);

  const kb = new InlineKeyboard()
    .text("👥 Switch / Add Client", "menu_clients")
    .text("🎯 Hook & Hashtag Guide", "menu_hooks_help")
    .row()
    .text("📊 How to Run /audit", "menu_audit_help")
    .text("🎬 Pre-Post Video Roast", "menu_video_help");

  await ctx.reply(
    `🚀 *SocialPulse AI — Agency Social Media Strategist*\n\n` +
      `🏷 *Active Client Profile:* ${escapeMd(activeBrand.brand_name)}\n` +
      `🎯 *Niche:* ${escapeMd(activeBrand.niche)}\n` +
      `👥 *Audience:* ${escapeMd(activeBrand.target_audience)}\n\n` +
      `*Core Commands:*\n` +
      `• \`/audit tiktok @handle\` — Scrape last 12 posts, calculate KPIs & get next steps\n` +
      `• \`/audit ig @handle\` — Audit an Instagram profile's reels & engagement\n` +
      `• \`/hooks <topic or product>\` — Generate 4 English + Amharic hooks, script & 3-tier hashtags\n` +
      `• \`/spy tiktok @competitor\` — Extract competitor winning hooks & content gaps\n` +
      `• \`/addclient Name | Niche | Audience\` — Save a new client profile\n` +
      `• \`/clients\` — Switch active client workspace\n` +
      `• *Upload any draft video (.mp4/.mov)* — Multimodal 3-second hook & pacing roast`,
    { parse_mode: "Markdown", reply_markup: kb }
  );
});

// ============================================================================
// 2. /addclient & /clients — Multi-Client Brand Profile Switcher
// ============================================================================
bot.command("addclient", async (ctx) => {
  const userId = ctx.from?.id || 0;
  const raw = ctx.match?.trim() || "";
  const parts = raw.split("|").map((s) => s.trim());

  if (parts.length < 2) {
    await ctx.reply(
      "📋 *Add a Client Brand Workspace*\n\n" +
        "Format:\n`/addclient Brand Name | Niche | Target Audience`\n\n" +
        "Example:\n`/addclient Bole Luxe Fashion | Women's Boutique & E-Commerce | Addis Ababa shoppers 18-35`",
      { parse_mode: "Markdown" }
    );
    return;
  }

  const [brandName, niche, targetAudience = "Addis Ababa & urban social users"] = parts;
  const created = await createClientBrand(userId, brandName, niche, targetAudience, "bilingual");

  await ctx.reply(
    `✅ *Client Workspace Created & Activated!*\n\n` +
      `🏷 *Brand:* ${escapeMd(created.brand_name)}\n` +
      `🎯 *Niche:* ${escapeMd(created.niche)}\n` +
      `👥 *Audience:* ${escapeMd(created.target_audience)}\n\n` +
      `All future \`/audit\`, \`/hooks\`, \`/spy\`, and video roasts are now tailored to *${escapeMd(created.brand_name)}*.`,
    { parse_mode: "Markdown" }
  );
});

bot.command("clients", async (ctx) => {
  const userId = ctx.from?.id || 0;
  const brands = await listClientBrands(userId);
  const active = await getActiveBrandProfile(userId);

  const kb = new InlineKeyboard();
  brands.slice(0, 8).forEach((b) => {
    const prefix = b.id === active.id ? "✅ " : "🏢 ";
    kb.text(`${prefix}${b.brand_name}`, `switch_brand:${b.id}`).row();
  });

  await ctx.reply(
    `🏢 *Your Client Brand Workspaces*\nActive: *${escapeMd(active.brand_name)}*\n\nTap a client below to switch context, or run:\n\`/addclient Name | Niche | Audience\``,
    { parse_mode: "Markdown", reply_markup: kb }
  );
});

// ============================================================================
// 3. /audit <platform> <@handle> — Full KPI & Next-Action Strategist
// ============================================================================
bot.command("audit", async (ctx) => {
  const userId = ctx.from?.id || 0;
  const args = (ctx.match || "").trim().split(/\s+/).filter(Boolean);

  if (args.length < 1) {
    await ctx.reply(
      "📊 *Run a Profile Audit*\n\n" +
        "Usage:\n" +
        "• `/audit tiktok @username`\n" +
        "• `/audit ig @username`\n" +
        "• Or paste a direct profile URL: `/audit https://www.tiktok.com/@username`",
      { parse_mode: "Markdown" }
    );
    return;
  }

  const { platform, handle } = parsePlatformAndHandle(args);
  const activeBrand = await getActiveBrandProfile(userId);

  const statusMsg = await ctx.reply(
    `⏳ Scraping recent ${platform.toUpperCase()} posts for *@${escapeMd(handle)}* and computing engagement benchmarks for *${escapeMd(activeBrand.brand_name)}*...`,
    { parse_mode: "Markdown" }
  );

  try {
    const kpis = await fetchAndComputeSocialKPIs(platform, handle, 12);
    const aiAdvice = await generateAccountAuditAdvice(kpis, activeBrand);
    await saveAuditResult(userId, activeBrand.id, "self_audit", kpis, aiAdvice);

    const hooksFormatted = (aiAdvice.rewrittenHooks || [])
      .map(
        (h, i) =>
          `*${i + 1}. [${escapeMd(h.style)}]*\n` +
          `🇬🇧 "${escapeMd(h.englishHook)}"\n` +
          `🇪🇹 "${escapeMd(h.amharicHook)}"\n` +
          `🎥 _Visual:_ ${escapeMd(h.visualDirection)}`
      )
      .join("\n\n");

    const nextVideos = (aiAdvice.nextThreeVideosToFilm || [])
      .map(
        (v, i) =>
          `*${i + 1}. ${escapeMd(v.title)}* (${escapeMd(v.format)})\n` +
          `   • *0-3s:* ${escapeMd(v.opening3Seconds)}\n` +
          `   • *CTA:* ${escapeMd(v.cta)}`
      )
      .join("\n");

    const reportText =
      `📈 *${platform.toUpperCase()} Audit: @${escapeMd(kpis.handle)}*\n` +
      `🏷 *Client Context:* ${escapeMd(activeBrand.brand_name)} | *Health Score:* ${aiAdvice.healthScore}/100\n\n` +
      `*1. Quantitative Benchmarks (${kpis.postsAnalyzed} Posts):*\n` +
      `• *Avg Views:* ${kpis.avgViews.toLocaleString()} (Median: ${kpis.medianViews.toLocaleString()})\n` +
      `• *Engagement Rate:* ${kpis.avgEngagementRate}% (Likes: ${kpis.avgLikes}, Comments: ${kpis.avgComments})\n` +
      `• *Winning Length:* ${escapeMd(kpis.optimalDurationRange)}\n` +
      `• *Best Posting Windows:* ${escapeMd(kpis.bestPostingHoursUTC3.join(" & "))}\n\n` +
      `*2. Performance Diagnosis:*\n` +
      `• *Summary:* ${escapeMd(aiAdvice.executiveDiagnosis)}\n` +
      `• *Why Top Posts Won:* ${escapeMd(aiAdvice.whyTopPostsWon)}\n` +
      `• *Why Bottom Posts Dropped:* ${escapeMd(aiAdvice.whyBottomPostsDropped)}\n` +
      `• *Hook Audit:* ${escapeMd(aiAdvice.hookDiagnosis)}\n\n` +
      `*3. Next-Post Hooks (English + አማርኛ):*\n${hooksFormatted}\n\n` +
      `*4. Next 3 Videos to Film:*\n${nextVideos}\n\n` +
      `🔥 *Single Highest-ROI Action Today:*\n👉 ${escapeMd(aiAdvice.singleNextActionToday)}`;

    const actionKb = new InlineKeyboard()
      .text("🎯 Copy 3-Tier Hashtags", "audit_hashtags")
      .text("📝 Write Full Script #1", "audit_script_1")
      .row()
      .text("🔄 Generate 4 More Hooks", "audit_more_hooks");

    await ctx.api.editMessageText(ctx.chat.id, statusMsg.message_id, reportText, {
      parse_mode: "Markdown",
      reply_markup: actionKb,
    });
  } catch (err: any) {
    await ctx.api.editMessageText(
      ctx.chat.id,
      statusMsg.message_id,
      `❌ *Audit Failed:* ${escapeMd(err.message || "Unknown error")}`,
      { parse_mode: "Markdown" }
    );
  }
});

// ============================================================================
// 4. /hooks <topic> — Bilingual Viral Hook, Script, Caption & Hashtag Generator
// ============================================================================
bot.command("hooks", async (ctx) => {
  const userId = ctx.from?.id || 0;
  const topic = (ctx.match || "").trim();

  if (!topic) {
    await ctx.reply(
      "🎯 *Viral Hook, Script & Hashtag Generator*\n\n" +
        "Usage:\n`/hooks <product, offer, or video topic>`\n\n" +
        "Examples:\n" +
        "• `/hooks New leather handbag collection arriving in Bole`\n" +
        "• `/hooks 3 mistakes people make when buying an apartment in Addis`\n" +
        "• `/hooks Custom modern kitchen cabinets walkthrough`",
      { parse_mode: "Markdown" }
    );
    return;
  }

  const activeBrand = await getActiveBrandProfile(userId);
  const waitMsg = await ctx.reply(
    `✍️ Crafting English + Amharic hooks, script outline & 3-tier hashtags for *${escapeMd(activeBrand.brand_name)}*...`,
    { parse_mode: "Markdown" }
  );

  try {
    const pack = await generateHooksAndHashtagsForTopic(topic, activeBrand);

    const hooksList = (pack.hooks || [])
      .map(
        (h, idx) =>
          `*${idx + 1}. ${escapeMd(h.framework)}*\n` +
          `🇬🇧 "${escapeMd(h.hookEn)}"\n` +
          `🇪🇹 "${escapeMd(h.hookAm)}"\n` +
          `🎬 _First 3s Action:_ ${escapeMd(h.visualAction)}`
      )
      .join("\n\n");

    const allTags = [
      ...(pack.hashtags?.broad || []),
      ...(pack.hashtags?.niche || []),
      ...(pack.hashtags?.local || []),
    ].join(" ");

    const text =
      `🎯 *Hook & Hashtag Strategy Pack*\n` +
      `📌 *Topic:* ${escapeMd(pack.topic)} (${escapeMd(activeBrand.brand_name)})\n\n` +
      `*4 High-Retention Opening Hooks:*\n${hooksList}\n\n` +
      `*⏱ 25-Second Script Structure:*\n` +
      `• *0–3s (Hook):* ${escapeMd(pack.shortScriptOutline?.hook0to3s || "")}\n` +
      `• *3–20s (Body):* ${escapeMd(pack.shortScriptOutline?.valueBody3to20s || "")}\n` +
      `• *20–25s (CTA):* ${escapeMd(pack.shortScriptOutline?.callToAction || "")}\n\n` +
      `*📝 English Caption:*\n${escapeMd(pack.captionEn)}\n\n` +
      `*📝 Amharic Caption (አማርኛ):*\n${escapeMd(pack.captionAm)}\n\n` +
      `*#️⃣ 3-Tier Hashtag Stack:*\n\`${escapeMd(allTags)}\``;

    await ctx.api.editMessageText(ctx.chat.id, waitMsg.message_id, text, {
      parse_mode: "Markdown",
    });
  } catch (err: any) {
    await ctx.api.editMessageText(
      ctx.chat.id,
      waitMsg.message_id,
      `❌ *Error generating hooks:* ${escapeMd(err.message || "Unknown error")}`,
      { parse_mode: "Markdown" }
    );
  }
});

// ============================================================================
// 5. /spy <platform> <@competitor> — Competitor Gap Analysis
// ============================================================================
bot.command("spy", async (ctx) => {
  const userId = ctx.from?.id || 0;
  const args = (ctx.match || "").trim().split(/\s+/).filter(Boolean);

  if (args.length < 1) {
    await ctx.reply(
      "🕵️‍♂️ *Competitor Gap Spy*\n\n" +
        "Usage:\n" +
        "• `/spy tiktok @competitor_handle`\n" +
        "• `/spy ig @competitor_handle`",
      { parse_mode: "Markdown" }
    );
    return;
  }

  const { platform, handle } = parsePlatformAndHandle(args);
  const activeBrand = await getActiveBrandProfile(userId);

  const waitMsg = await ctx.reply(
    `🕵️‍♂️ Analyzing *@${escapeMd(handle)}* on ${platform.toUpperCase()} to uncover winning hooks and content gaps for *${escapeMd(activeBrand.brand_name)}*...`,
    { parse_mode: "Markdown" }
  );

  try {
    const compKpis = await fetchAndComputeSocialKPIs(platform, handle, 10);
    const spyReport = await generateCompetitorSpyReport(compKpis, activeBrand);
    await saveAuditResult(userId, activeBrand.id, "competitor_spy", compKpis, spyReport as any);

    const stealable = (spyReport.stealableVideoIdeas || [])
      .map(
        (idea, idx) =>
          `*${idx + 1}. ${escapeMd(idea.conceptTitle)}*\n` +
          `🇬🇧 Hook: "${escapeMd(idea.openingHookEn)}"\n` +
          `🇪🇹 Hook: "${escapeMd(idea.openingHookAm)}"\n` +
          `💡 _Why it wins:_ ${escapeMd(idea.whyItBeatsCompetitor)}`
      )
      .join("\n\n");

    const text =
      `🕵️‍♂️ *Competitor Intelligence: @${escapeMd(compKpis.handle)}*\n` +
      `📊 *Avg Views:* ${compKpis.avgViews.toLocaleString()} | *ER:* ${compKpis.avgEngagementRate}% | *Best Length:* ${escapeMd(compKpis.optimalDurationRange)}\n\n` +
      `*🏆 Why Their Top Posts Work:*\n${escapeMd(spyReport.winningPatternSummary)}\n\n` +
      `*🕳 Content Gaps They Missed:*\n${(spyReport.contentGapsTheyMissed || []).map((g) => `• ${escapeMd(g)}`).join("\n")}\n\n` +
      `*🎬 3 Videos You Should Film to Beat Them:*\n${stealable}`;

    await ctx.api.editMessageText(ctx.chat.id, waitMsg.message_id, text, {
      parse_mode: "Markdown",
    });
  } catch (err: any) {
    await ctx.api.editMessageText(
      ctx.chat.id,
      waitMsg.message_id,
      `❌ *Competitor Spy Failed:* ${escapeMd(err.message || "Unknown error")}`,
      { parse_mode: "Markdown" }
    );
  }
});

// ============================================================================
// 6. Direct Video Upload Handler — Multimodal 3-Second Hook & Pacing Roaster
// ============================================================================
bot.on(["message:video", "message:document"], async (ctx) => {
  const userId = ctx.from?.id || 0;
  const video = ctx.message.video || ctx.message.document;

  if (!video) return;
  const mimeType = video.mime_type || "video/mp4";
  if (!mimeType.startsWith("video/")) {
    await ctx.reply("⚠️ Please upload a video file (`.mp4` or `.mov`) for a multimodal hook & retention audit.");
    return;
  }

  // Telegram Bot API standard download limit is 20MB
  if (video.file_size && video.file_size > 20 * 1024 * 1024) {
    await ctx.reply(
      "⚠️ This video is over 20 MB (Telegram Bot API download limit). Please compress or trim the clip to under 20 MB and send it again."
    );
    return;
  }

  const activeBrand = await getActiveBrandProfile(userId);
  const userCaptionNote = ctx.message.caption || "";

  const waitMsg = await ctx.reply(
    `🎬 *Analyzing Draft Video for ${escapeMd(activeBrand.brand_name)}...*\n` +
      `Inspecting the 0–3s visual/audio hook, frame pacing, and retention drop-off points via Gemini Multimodal API...`,
    { parse_mode: "Markdown" }
  );

  const tmpFilePath = path.join(os.tmpdir(), `tg_video_${Date.now()}.mp4`);

  try {
    const file = await ctx.api.getFile(video.file_id);
    const fileUrl = `https://api.telegram.org/file/bot${token}/${file.file_path}`;

    const res = await fetch(fileUrl);
    if (!res.ok) throw new Error("Could not download video from Telegram servers.");
    const arrayBuffer = await res.arrayBuffer();
    fs.writeFileSync(tmpFilePath, Buffer.from(arrayBuffer));

    const durationSec = "duration" in video ? Number(video.duration || 15) : 15;
    const roast = await analyzeUploadedVideoDraft(tmpFilePath, mimeType, activeBrand, userCaptionNote);
    await saveVideoRoastResult(userId, activeBrand.id, video.file_id, durationSec, roast);

    const dropOffs = (roast.timestampedDropOffRisks || [])
      .map(
        (d) =>
          `• *${escapeMd(d.timestamp)}* — ${escapeMd(d.issue)}\n  🔧 _Fix:_ ${escapeMd(d.fix)}`
      )
      .join("\n");

    const hooks = (roast.upgradedHooks || [])
      .map(
        (h, i) =>
          `*${i + 1}. ${escapeMd(h.angle)}*\n` +
          `🇬🇧 "${escapeMd(h.spokenOrTextEn)}"\n` +
          `🇪🇹 "${escapeMd(h.spokenOrTextAm)}"\n` +
          `🎥 _Opening Frame:_ ${escapeMd(h.firstFrameVisual)}`
      )
      .join("\n\n");

    const replyText =
      `🎬 *Pre-Post Video & 3-Second Hook Audit*\n` +
      `🏷 *Client:* ${escapeMd(activeBrand.brand_name)}\n` +
      `🪝 *Hook Score:* ${roast.hookScoreOutOf10}/10 | ⚡ *Pacing:* ${roast.pacingScoreOutOf10}/10 | 🚨 *Drop-Off Risk:* ${escapeMd(roast.retentionRiskLevel)}\n\n` +
      `*⏱ First 3 Seconds Verdict (0:00–0:03):*\n${escapeMd(roast.firstThreeSecondsVerdict)}\n\n` +
      `*📉 Timestamped Retention Fixes:*\n${dropOffs || "• Clean pacing throughout."}\n\n` +
      `*🔥 3 Stronger Hook Upgrades (EN + አማርኛ):*\n${hooks}\n\n` +
      `*📝 Ready-to-Post Captions:*\n` +
      `🇬🇧 ${escapeMd(roast.recommendedCaptionEn)}\n` +
      `🇪🇹 ${escapeMd(roast.recommendedCaptionAm)}\n\n` +
      `*#️⃣ Hashtags:*\n\`${escapeMd((roast.hashtagPack || []).join(" "))}\`\n\n` +
      `✅ *#1 Edit Before Publishing:*\n👉 ${escapeMd(roast.nextStepBeforePosting)}`;

    await ctx.api.editMessageText(ctx.chat.id, waitMsg.message_id, replyText, {
      parse_mode: "Markdown",
    });
  } catch (err: any) {
    await ctx.api.editMessageText(
      ctx.chat.id,
      waitMsg.message_id,
      `❌ *Video Analysis Failed:* ${escapeMd(err.message || "Unknown error")}`,
      { parse_mode: "Markdown" }
    );
  } finally {
    if (fs.existsSync(tmpFilePath)) {
      fs.unlinkSync(tmpFilePath);
    }
  }
});

// ============================================================================
// 7. Inline Keyboard Callback Handlers
// ============================================================================
bot.on("callback_query:data", async (ctx) => {
  const userId = ctx.from.id;
  const data = ctx.callbackQuery.data;

  if (data.startsWith("switch_brand:")) {
    const brandId = data.replace("switch_brand:", "");
    const switched = await switchActiveClientBrand(userId, brandId);
    await ctx.answerCallbackQuery({
      text: switched ? `Switched to ${switched.brand_name}` : "Could not switch client",
    });
    if (switched) {
      await ctx.reply(
        `✅ Active client switched to *${escapeMd(switched.brand_name)}* (${escapeMd(switched.niche)}).`,
        { parse_mode: "Markdown" }
      );
    }
    return;
  }

  if (data === "audit_hashtags") {
    const last = await getLastAuditForSession(userId);
    await ctx.answerCallbackQuery();
    if (!last) {
      await ctx.reply("Run `/audit tiktok @handle` first to generate a hashtag stack.", {
        parse_mode: "Markdown",
      });
      return;
    }
    const hs = last.ai.hashtagStrategy;
    const combined = [
      ...(hs?.broadNiche || []),
      ...(hs?.midVolumeCategory || []),
      ...(hs?.localAndIntent || []),
    ].join(" ");

    await ctx.reply(
      `#️⃣ *3-Tier Hashtag Stack for @${escapeMd(last.kpis.handle)}*\n\n` +
        `• *Broad Niche:* ${escapeMd((hs?.broadNiche || []).join(" "))}\n` +
        `• *Category:* ${escapeMd((hs?.midVolumeCategory || []).join(" "))}\n` +
        `• *Local / High-Intent:* ${escapeMd((hs?.localAndIntent || []).join(" "))}\n\n` +
        `*Tap to Copy All:*\n\`${escapeMd(combined)}\``,
      { parse_mode: "Markdown" }
    );
    return;
  }

  if (data === "audit_script_1") {
    const last = await getLastAuditForSession(userId);
    await ctx.answerCallbackQuery({ text: "Generating script..." });
    if (!last || !last.ai.nextThreeVideosToFilm?.[0]) {
      await ctx.reply("Run `/audit tiktok @handle` first.", { parse_mode: "Markdown" });
      return;
    }
    const videoIdea = last.ai.nextThreeVideosToFilm[0];
    const activeBrand = await getActiveBrandProfile(userId);
    const pack = await generateHooksAndHashtagsForTopic(videoIdea.title, activeBrand);

    await ctx.reply(
      `🎬 *Ready-to-Shoot Script: ${escapeMd(videoIdea.title)}*\n\n` +
        `• *0–3s (Hook):* ${escapeMd(pack.shortScriptOutline.hook0to3s)}\n` +
        `• *3–20s (Body):* ${escapeMd(pack.shortScriptOutline.valueBody3to20s)}\n` +
        `• *20–25s (CTA):* ${escapeMd(pack.shortScriptOutline.callToAction)}\n\n` +
        `🇬🇧 *EN Hook:* "${escapeMd(pack.hooks?.[0]?.hookEn || "")}"\n` +
        `🇪🇹 *AM Hook:* "${escapeMd(pack.hooks?.[0]?.hookAm || "")}"`,
      { parse_mode: "Markdown" }
    );
    return;
  }

  if (data === "audit_more_hooks") {
    const last = await getLastAuditForSession(userId);
    await ctx.answerCallbackQuery({ text: "Writing 4 new hooks..." });
    const activeBrand = await getActiveBrandProfile(userId);
    const topic = last?.ai.nextThreeVideosToFilm?.[0]?.title || activeBrand.niche;
    const pack = await generateHooksAndHashtagsForTopic(topic, activeBrand);

    const list = (pack.hooks || [])
      .map(
        (h, i) =>
          `*${i + 1}. ${escapeMd(h.framework)}*\n🇬🇧 "${escapeMd(h.hookEn)}"\n🇪🇹 "${escapeMd(h.hookAm)}"`
      )
      .join("\n\n");

    await ctx.reply(`🔥 *4 Fresh Hooks for ${escapeMd(activeBrand.brand_name)}:*\n\n${list}`, {
      parse_mode: "Markdown",
    });
    return;
  }

  await ctx.answerCallbackQuery();
  if (data === "menu_clients") {
    await ctx.reply(
      "Use `/clients` to view and switch between your client brands, or `/addclient Brand Name | Niche | Audience` to add a new client.",
      { parse_mode: "Markdown" }
    );
  } else if (data === "menu_hooks_help") {
    await ctx.reply(
      "Send `/hooks <product or video topic>` to get 4 bilingual (English + Amharic) viral hooks, a 25-second script, and a 3-tier hashtag pack.",
      { parse_mode: "Markdown" }
    );
  } else if (data === "menu_audit_help") {
    await ctx.reply(
      "Send `/audit tiktok @handle` or `/audit ig @handle` to scrape the last 12 posts, calculate engagement rate & best posting hours, and get next-step advice.",
      { parse_mode: "Markdown" }
    );
  } else if (data === "menu_video_help") {
    await ctx.reply(
      "Directly upload or forward any unposted `.mp4` or `.mov` video (under 20MB) into this chat. The bot will watch it frame-by-frame and critique your 3-second hook and pacing!",
      { parse_mode: "Markdown" }
    );
  }
});

// ============================================================================
// Helpers
// ============================================================================
function parsePlatformAndHandle(args: string[]): {
  platform: SocialPlatform;
  handle: string;
} {
  const first = args[0].toLowerCase();
  if (first.includes("instagram.com")) {
    return { platform: "instagram", handle: args[0] };
  }
  if (first.includes("tiktok.com")) {
    return { platform: "tiktok", handle: args[0] };
  }
  if (first === "ig" || first === "instagram" || first === "insta") {
    return { platform: "instagram", handle: args[1] || args[0] };
  }
  if (first === "tiktok" || first === "tt") {
    return { platform: "tiktok", handle: args[1] || args[0] };
  }
  return { platform: "tiktok", handle: args[0] };
}

function escapeMd(text: string): string {
  return String(text || "").replace(/([_*`\[])/g, "\\$1");
}
