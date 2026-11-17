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
import { extractCleanHandle, fetchAndComputeSocialKPIs } from "./scraper";
import {
  analyzeUploadedVideoDraft,
  generateAccountAuditAdvice,
  generateBioAndProfileFix,
  generateCommentAndDmFunnel,
  generateCompetitorSpyReport,
  generateHooksAndHashtagsForTopic,
  generateSevenDayGrowthPlan,
  generateWinnerCloneAndFlopFix,
} from "./gemini";
import {
  BioAndProfileFix,
  BrandProfile,
  CommentAndDmFunnel,
  ComputedAccountKPIs,
  SevenDayGrowthPlan,
  SocialPlatform,
  WinnerCloneAndFlopFix,
} from "../types/social";

const token = process.env.TELEGRAM_BOT_TOKEN || "REPLACE_WITH_TELEGRAM_BOT_TOKEN";
export const bot = new Bot(token);

// Optional Whitelist: Restrict internal agency bot to your Telegram user IDs if configured
const allowedIds = (process.env.ALLOWED_TELEGRAM_USER_IDS || "")
  .split(",")
  .map((s) => Number(s.trim()))
  .filter((n) => !isNaN(n) && n > 0);

// In-memory registry of running tasks per user so /stop can cancel them
const activeJobs = new Map<number, { cancelled: boolean; statusMsgId?: number }>();
const JOB_TIMEOUT_MS = 55_000;

// Remembers each user's last topic/handle so the action buttons can regenerate content
const lastTopicByUser = new Map<number, string>();

function withTimeout<T>(promise: Promise<T>, ms = JOB_TIMEOUT_MS): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<T>((_, reject) => {
    timer = setTimeout(() => reject(new Error("TIMEOUT")), ms);
  });
  return Promise.race([promise, timeout]).finally(() => {
    if (timer) clearTimeout(timer);
  });
}

// One-line loading message + 🛑 Cancel button that triggers the /stop logic
const cancelKb = () => new InlineKeyboard().text("🛑 Cancel", "stop_job");

bot.use(async (ctx, next) => {
  const userId = ctx.from?.id;
  if (allowedIds.length > 0 && userId && !allowedIds.includes(userId)) {
    await ctx.reply("🔒 Private agency bot.");
    return;
  }
  await next();
});

// ============================================================================
// 0. /stop — Cancel Any Running Scrape / AI Task
// ============================================================================
async function stopActiveJob(ctx: any): Promise<boolean> {
  const userId = ctx.from?.id || 0;
  const job = activeJobs.get(userId);
  if (!job) return false;
  job.cancelled = true;
  activeJobs.delete(userId);
  return true;
}

bot.command("stop", async (ctx) => {
  const userId = ctx.from?.id || 0;
  const job = activeJobs.get(userId);
  if (!job) {
    await ctx.reply("ℹ️ Nothing running.");
    return;
  }
  job.cancelled = true;
  activeJobs.delete(userId);

  const text = "🛑 Stopped.";
  if (job.statusMsgId) {
    await ctx.api
      .editMessageText(ctx.chat.id, job.statusMsgId, text)
      .catch(() => ctx.reply(text));
  } else {
    await ctx.reply(text);
  }
});

// ============================================================================
// 1. /start & /help — Minimal Control Center
// ============================================================================
bot.command(["start", "help"], async (ctx) => {
  const userId = ctx.from?.id || 0;
  const activeBrand = await getActiveBrandProfile(userId);
  const lastAudit = await getLastAuditForSession(userId);
  const tracked = lastAudit?.kpis?.handle ? `@${lastAudit.kpis.handle}` : "—";

  const kb = new InlineKeyboard()
    .text("📊 Audit", "menu_audit")
    .text("🎯 Hooks", "menu_hooks")
    .row()
    .text("🕵️ Spy", "menu_spy")
    .text("👥 Clients", "menu_clients")
    .row()
    .text("🛑 Stop", "stop_job");

  await ctx.reply(
    `🚀 *SocialPulse AI*\n` +
      `🏷 Client: *${escapeMd(activeBrand.brand_name)}*\n` +
      `📡 Tracked: ${escapeMd(tracked)}`,
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
    await ctx.reply("📋 `/addclient Brand | Niche | Audience`", { parse_mode: "Markdown" });
    return;
  }

  const [brandName, niche, targetAudience = "Addis Ababa & urban social users"] = parts;
  const created = await createClientBrand(userId, brandName, niche, targetAudience, "bilingual");

  await ctx.reply(
    `✅ *${escapeMd(created.brand_name)}* is now active\n🎯 ${escapeMd(created.niche)}`,
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

  await ctx.reply(`👥 *Clients* · active: *${escapeMd(active.brand_name)}*`, {
    parse_mode: "Markdown",
    reply_markup: kb,
  });
});

// ============================================================================
// 3. /audit <platform> <@handle> — Tight KPI Audit & Next Action
// ============================================================================
async function runAuditFlow(ctx: any, platform: SocialPlatform, handle: string) {
  const userId = ctx.from?.id || 0;
  const cleanHandle = extractCleanHandle(handle);
  const activeBrand = await getActiveBrandProfile(userId);

  const statusMsg = await ctx.reply(`⏳ Auditing @${cleanHandle}…`, {
    reply_markup: cancelKb(),
  });

  const job = { cancelled: false, statusMsgId: statusMsg.message_id };
  activeJobs.set(userId, job);

  try {
    const { kpis, aiAdvice } = await withTimeout(
      (async () => {
        const kpis = await fetchAndComputeSocialKPIs(platform, cleanHandle, 12);
        const aiAdvice = await generateAccountAuditAdvice(kpis, activeBrand);
        return { kpis, aiAdvice };
      })()
    );

    if (job.cancelled) return;

    await saveAuditResult(userId, activeBrand.id, "self_audit", kpis, aiAdvice);
    lastTopicByUser.set(
      userId,
      aiAdvice.nextThreeVideosToFilm?.[0]?.title || kpis.handle
    );

    const hooksFormatted = (aiAdvice.rewrittenHooks || [])
      .slice(0, 3)
      .map(
        (h, i) =>
          `*${i + 1}.* 🇬🇧 "${escapeMd(h.englishHook)}"\n` +
          `    🇪🇹 "${escapeMd(h.amharicHook)}"`
      )
      .join("\n");

    const reportText =
      `📈 *${platform.toUpperCase()} @${escapeMd(kpis.handle)}* · ${escapeMd(activeBrand.brand_name)}\n` +
      `👁 Views: ${kpis.avgViews.toLocaleString()}\n` +
      `❤️ ER: ${kpis.avgEngagementRate}%\n` +
      `⏱ Best Length: ${escapeMd(kpis.optimalDurationRange)}\n` +
      `🕐 Peak Time: ${escapeMd(kpis.bestPostingHoursUTC3.join(" / "))}\n` +
      `🩺 Health: ${aiAdvice.healthScore}/100\n\n` +
      `🪝 *Top Hooks*\n${hooksFormatted}\n\n` +
      `👉 ${escapeMd(aiAdvice.singleNextActionToday)}`;

    const actionKb = new InlineKeyboard()
      .text("🎯 Hashtags", "audit_hashtags")
      .text("📝 Script", "script_now")
      .row()
      .text("🪪 Fix Bio & Pinned", "audit_bio")
      .text("📅 7-Day Plan", "audit_7day")
      .row()
      .text("🧬 Clone #1 Winner", "audit_clone")
      .text("💬 Comment & DM Funnel", "audit_dm")
      .row()
      .text("🔄 More Hooks", "more_hooks")
      .text("🛑 Stop", "stop_job");

    if (job.cancelled) return;
    await ctx.api.editMessageText(ctx.chat.id, statusMsg.message_id, reportText, {
      parse_mode: "Markdown",
      reply_markup: actionKb,
    });
  } catch (err: any) {
    if (job.cancelled) return;
    await ctx.api.editMessageText(
      ctx.chat.id,
      statusMsg.message_id,
      err.message === "TIMEOUT"
        ? "⏱ Timed out after 55s — try a smaller/public @handle."
        : `❌ Audit failed: ${escapeMd(err.message || "Unknown error")}`,
      { parse_mode: "Markdown" }
    );
  } finally {
    if (activeJobs.get(userId) === job) activeJobs.delete(userId);
  }
}

bot.command("audit", async (ctx) => {
  const args = (ctx.match || "").trim().split(/\s+/).filter(Boolean);

  if (args.length < 1) {
    await ctx.reply("📊 `/audit tiktok @handle` — or paste a profile link.", {
      parse_mode: "Markdown",
    });
    return;
  }

  const { platform, handle } = parsePlatformAndHandle(args);
  await runAuditFlow(ctx, platform, handle);
});

// ============================================================================
// 4. /hooks <topic> — Bilingual Hooks, Script & Hashtags
// ============================================================================
bot.command("hooks", async (ctx) => {
  const userId = ctx.from?.id || 0;
  const topic = (ctx.match || "").trim();

  if (!topic) {
    await ctx.reply("🎯 `/hooks <product or topic>`", { parse_mode: "Markdown" });
    return;
  }

  const activeBrand = await getActiveBrandProfile(userId);
  const waitMsg = await ctx.reply("⏳ Writing hooks…", { reply_markup: cancelKb() });

  const job = { cancelled: false, statusMsgId: waitMsg.message_id };
  activeJobs.set(userId, job);

  try {
    const pack = await withTimeout(generateHooksAndHashtagsForTopic(topic, activeBrand));

    if (job.cancelled) return;

    lastTopicByUser.set(userId, topic);

    const hooksList = (pack.hooks || [])
      .slice(0, 3)
      .map(
        (h, i) =>
          `*${i + 1}.* 🇬🇧 "${escapeMd(h.hookEn)}"\n` +
          `    🇪🇹 "${escapeMd(h.hookAm)}"`
      )
      .join("\n");

    const allTags = [
      ...(pack.hashtags?.broad || []),
      ...(pack.hashtags?.niche || []),
      ...(pack.hashtags?.local || []),
    ].join(" ");

    const text =
      `🎯 *${escapeMd(pack.topic)}* · ${escapeMd(activeBrand.brand_name)}\n\n` +
      `${hooksList}\n\n` +
      `📝 ${escapeMd(pack.captionEn)}\n\n` +
      `#️⃣ \`${escapeMd(allTags)}\``;

    const kb = new InlineKeyboard()
      .text("🔄 More Hooks", "more_hooks")
      .text("📝 Script", "script_now")
      .row()
      .text("🛑 Stop", "stop_job");

    if (job.cancelled) return;
    await ctx.api.editMessageText(ctx.chat.id, waitMsg.message_id, text, {
      parse_mode: "Markdown",
      reply_markup: kb,
    });
  } catch (err: any) {
    if (job.cancelled) return;
    await ctx.api.editMessageText(
      ctx.chat.id,
      waitMsg.message_id,
      err.message === "TIMEOUT"
        ? "⏱ Timed out after 55s."
        : `❌ Hooks failed: ${escapeMd(err.message || "Unknown error")}`,
      { parse_mode: "Markdown" }
    );
  } finally {
    if (activeJobs.get(userId) === job) activeJobs.delete(userId);
  }
});

// ============================================================================
// 5. /spy <platform> <@competitor> — Competitor Gap Analysis
// ============================================================================
bot.command("spy", async (ctx) => {
  const userId = ctx.from?.id || 0;
  const args = (ctx.match || "").trim().split(/\s+/).filter(Boolean);

  if (args.length < 1) {
    await ctx.reply("🕵️ `/spy tiktok @competitor`", { parse_mode: "Markdown" });
    return;
  }

  const { platform, handle } = parsePlatformAndHandle(args);
  const cleanHandle = extractCleanHandle(handle);
  const activeBrand = await getActiveBrandProfile(userId);

  const waitMsg = await ctx.reply(`⏳ Spying @${cleanHandle}…`, { reply_markup: cancelKb() });

  const job = { cancelled: false, statusMsgId: waitMsg.message_id };
  activeJobs.set(userId, job);

  try {
    const { compKpis, spyReport } = await withTimeout(
      (async () => {
        const compKpis = await fetchAndComputeSocialKPIs(platform, cleanHandle, 10);
        const spyReport = await generateCompetitorSpyReport(compKpis, activeBrand);
        return { compKpis, spyReport };
      })()
    );

    if (job.cancelled) return;

    await saveAuditResult(userId, activeBrand.id, "competitor_spy", compKpis, spyReport as any);
    lastTopicByUser.set(
      userId,
      spyReport.stealableVideoIdeas?.[0]?.conceptTitle || cleanHandle
    );

    const gaps = (spyReport.contentGapsTheyMissed || [])
      .slice(0, 2)
      .map((g) => `• ${escapeMd(g)}`)
      .join("\n");

    const stealable = (spyReport.stealableVideoIdeas || [])
      .slice(0, 2)
      .map(
        (idea, i) =>
          `*${i + 1}. ${escapeMd(idea.conceptTitle)}*\n` +
          `    🇬🇧 "${escapeMd(idea.openingHookEn)}"\n` +
          `    🇪🇹 "${escapeMd(idea.openingHookAm)}"`
      )
      .join("\n");

    const text =
      `🕵️ *@${escapeMd(compKpis.handle)}* · ${escapeMd(activeBrand.brand_name)}\n` +
      `👁 Views: ${compKpis.avgViews.toLocaleString()}\n` +
      `❤️ ER: ${compKpis.avgEngagementRate}%\n` +
      `⏱ Best Length: ${escapeMd(compKpis.optimalDurationRange)}\n` +
      `🕐 Peak Time: ${escapeMd(compKpis.bestPostingHoursUTC3.join(" / "))}\n\n` +
      `🕳 *Gaps*\n${gaps}\n\n` +
      `🎬 *Steal These*\n${stealable}`;

    const kb = new InlineKeyboard()
      .text("📝 Script", "script_now")
      .text("🔄 More Hooks", "more_hooks")
      .row()
      .text("🛑 Stop", "stop_job");

    if (job.cancelled) return;
    await ctx.api.editMessageText(ctx.chat.id, waitMsg.message_id, text, {
      parse_mode: "Markdown",
      reply_markup: kb,
    });
  } catch (err: any) {
    if (job.cancelled) return;
    await ctx.api.editMessageText(
      ctx.chat.id,
      waitMsg.message_id,
      err?.message === "TIMEOUT"
        ? "⏱ Timed out after 55s — try a smaller/public @handle."
        : `❌ Spy failed: ${escapeMd(err.message || "Unknown error")}`,
      { parse_mode: "Markdown" }
    );
  } finally {
    if (activeJobs.get(userId) === job) activeJobs.delete(userId);
  }
});

// ============================================================================
// 5b. /bio & /plan — One-Tap Account Growth Tools
// ============================================================================
bot.command("bio", async (ctx) => {
  const args = (ctx.match || "").trim().split(/\s+/).filter(Boolean);
  await runAggregateToolFlow(ctx, args, "⏳ Optimizing bio…", async (kpis, brand) =>
    formatBioFix(kpis, await generateBioAndProfileFix(kpis, brand))
  );
});

bot.command("plan", async (ctx) => {
  const args = (ctx.match || "").trim().split(/\s+/).filter(Boolean);
  await runAggregateToolFlow(ctx, args, "⏳ Building 7-day plan…", async (kpis, brand) =>
    formatSevenDayPlan(kpis, await generateSevenDayGrowthPlan(kpis, brand))
  );
});

// ============================================================================
// 6. Direct Video Upload — 3-Second Hook & Pacing Roast
// ============================================================================
bot.on(["message:video", "message:document"], async (ctx) => {
  const userId = ctx.from?.id || 0;
  const video = ctx.message.video || ctx.message.document;

  if (!video) return;
  const mimeType = video.mime_type || "video/mp4";
  if (!mimeType.startsWith("video/")) {
    await ctx.reply("⚠️ Send a `.mp4` or `.mov` video.");
    return;
  }

  // Telegram Bot API standard download limit is 20MB
  if (video.file_size && video.file_size > 20 * 1024 * 1024) {
    await ctx.reply("⚠️ Video is over 20 MB — compress or trim it first.");
    return;
  }

  const activeBrand = await getActiveBrandProfile(userId);
  const userCaptionNote = ctx.message.caption || "";

  const waitMsg = await ctx.reply("⏳ Watching your video…", { reply_markup: cancelKb() });
  const job = { cancelled: false, statusMsgId: waitMsg.message_id };
  activeJobs.set(userId, job);

  const tmpFilePath = path.join(os.tmpdir(), `tg_video_${Date.now()}.mp4`);

  try {
    const file = await ctx.api.getFile(video.file_id);
    const fileUrl = `https://api.telegram.org/file/bot${token}/${file.file_path}`;

    const res = await fetch(fileUrl);
    if (!res.ok) throw new Error("Could not download video from Telegram.");
    const arrayBuffer = await res.arrayBuffer();
    fs.writeFileSync(tmpFilePath, Buffer.from(arrayBuffer));

    const durationSec = "duration" in video ? Number(video.duration || 15) : 15;
    const roast = await analyzeUploadedVideoDraft(tmpFilePath, mimeType, activeBrand, userCaptionNote);
    await saveVideoRoastResult(userId, activeBrand.id, video.file_id, durationSec, roast);

    if (job.cancelled) return;

    lastTopicByUser.set(userId, roast.upgradedHooks?.[0]?.angle || activeBrand.niche);

    const dropOffs = (roast.timestampedDropOffRisks || [])
      .slice(0, 3)
      .map((d) => `• *${escapeMd(d.timestamp)}* ${escapeMd(d.fix)}`)
      .join("\n");

    const hooks = (roast.upgradedHooks || [])
      .slice(0, 2)
      .map(
        (h, i) =>
          `*${i + 1}.* 🇬🇧 "${escapeMd(h.spokenOrTextEn)}"\n` +
          `    🇪🇹 "${escapeMd(h.spokenOrTextAm)}"`
      )
      .join("\n");

    const replyText =
      `🎬 *Video Roast* · ${escapeMd(activeBrand.brand_name)}\n` +
      `🪝 Hook: ${roast.hookScoreOutOf10}/10\n` +
      `⚡ Pacing: ${roast.pacingScoreOutOf10}/10\n` +
      `🚨 Risk: ${escapeMd(roast.retentionRiskLevel)}\n\n` +
      `*Fixes*\n${dropOffs || "• Clean pacing."}\n\n` +
      `*Upgraded Hooks*\n${hooks}\n\n` +
      `✅ ${escapeMd(roast.nextStepBeforePosting)}`;

    const kb = new InlineKeyboard()
      .text("🔄 More Hooks", "more_hooks")
      .text("🛑 Stop", "stop_job");

    if (job.cancelled) return;
    await ctx.api.editMessageText(ctx.chat.id, waitMsg.message_id, replyText, {
      parse_mode: "Markdown",
      reply_markup: kb,
    });
  } catch (err: any) {
    if (job.cancelled) return;
    await ctx.api.editMessageText(
      ctx.chat.id,
      waitMsg.message_id,
      `❌ Video failed: ${escapeMd(err.message || "Unknown error")}`,
      { parse_mode: "Markdown" }
    );
  } finally {
    if (activeJobs.get(userId) === job) activeJobs.delete(userId);
    if (fs.existsSync(tmpFilePath)) fs.unlinkSync(tmpFilePath);
  }
});

// ============================================================================
// 7. Plain-Text Auto-Detect — Paste a TikTok / Instagram Link to Auto-Audit
// ============================================================================
bot.on("message:text", async (ctx) => {
  const text = ctx.message.text;

  // Ignore slash commands — handled by their dedicated handlers
  if (text.startsWith("/")) return;

  const urlMatch = text.match(/https?:\/\/\S+/);
  if (urlMatch) {
    if (urlMatch[0].includes("tiktok.com")) {
      await runAuditFlow(ctx, "tiktok", urlMatch[0]);
      return;
    }
    if (urlMatch[0].includes("instagram.com")) {
      await runAuditFlow(ctx, "instagram", urlMatch[0]);
      return;
    }
  }

  await ctx.reply("💡 Paste a TikTok/IG link · send a `.mp4` · or `/hooks <topic>`.", {
    parse_mode: "Markdown",
  });
});

// ============================================================================
// 8. Inline Keyboard Callback Handlers
// ============================================================================
bot.on("callback_query:data", async (ctx) => {
  const userId = ctx.from.id;
  const data = ctx.callbackQuery.data;

  if (data === "stop_job") {
    const stopped = await stopActiveJob(ctx);
    await ctx.answerCallbackQuery({ text: stopped ? "🛑 Stopped" : "Nothing running" });
    await ctx
      .editMessageText("🛑 Stopped.")
      .catch(() => ctx.reply("🛑 Stopped."));
    return;
  }

  if (data.startsWith("switch_brand:")) {
    const brandId = data.replace("switch_brand:", "");
    const switched = await switchActiveClientBrand(userId, brandId);
    await ctx.answerCallbackQuery({
      text: switched ? `Switched to ${switched.brand_name}` : "Could not switch",
    });
    if (switched) {
      await ctx.reply(`✅ *${escapeMd(switched.brand_name)}* active`, {
        parse_mode: "Markdown",
      });
    }
    return;
  }

  if (data === "menu_audit") {
    await ctx.answerCallbackQuery();
    await ctx.reply("📊 `/audit tiktok @handle` — or paste a profile link.", {
      parse_mode: "Markdown",
    });
    return;
  }

  if (data === "menu_hooks") {
    await ctx.answerCallbackQuery();
    await ctx.reply("🎯 `/hooks <product or topic>`", { parse_mode: "Markdown" });
    return;
  }

  if (data === "menu_spy") {
    await ctx.answerCallbackQuery();
    await ctx.reply("🕵️ `/spy tiktok @competitor`", { parse_mode: "Markdown" });
    return;
  }

  if (data === "menu_clients") {
    await ctx.answerCallbackQuery();
    const brands = await listClientBrands(userId);
    const active = await getActiveBrandProfile(userId);
    const kb = new InlineKeyboard();
    brands.slice(0, 8).forEach((b) => {
      kb.text(`${b.id === active.id ? "✅ " : "🏢 "}${b.brand_name}`, `switch_brand:${b.id}`).row();
    });
    await ctx.reply(`👥 *Clients* · active: *${escapeMd(active.brand_name)}*`, {
      parse_mode: "Markdown",
      reply_markup: kb,
    });
    return;
  }

  if (data === "audit_hashtags") {
    const last = await getLastAuditForSession(userId);
    await ctx.answerCallbackQuery();
    if (!last) {
      await ctx.reply("Run `/audit tiktok @handle` first.", { parse_mode: "Markdown" });
      return;
    }
    const hs = last.ai.hashtagStrategy;
    const combined = [
      ...(hs?.broadNiche || []),
      ...(hs?.midVolumeCategory || []),
      ...(hs?.localAndIntent || []),
    ].join(" ");

    await ctx.reply(`#️⃣ *@${escapeMd(last.kpis.handle)}*\n\`${escapeMd(combined)}\``, {
      parse_mode: "Markdown",
    });
    return;
  }

  if (data === "more_hooks") {
    await ctx.answerCallbackQuery({ text: "Writing fresh hooks…" });
    const activeBrand = await getActiveBrandProfile(userId);
    const topic = lastTopicByUser.get(userId) || activeBrand.niche;
    const pack = await generateHooksAndHashtagsForTopic(topic, activeBrand);
    const list = (pack.hooks || [])
      .slice(0, 3)
      .map(
        (h, i) =>
          `*${i + 1}.* 🇬🇧 "${escapeMd(h.hookEn)}"\n` + `    🇪🇹 "${escapeMd(h.hookAm)}"`
      )
      .join("\n");
    await ctx.reply(`🔥 *Fresh Hooks* · ${escapeMd(topic)}\n\n${list}`, {
      parse_mode: "Markdown",
    });
    return;
  }

  if (data === "script_now") {
    await ctx.answerCallbackQuery({ text: "Writing script…" });
    const activeBrand = await getActiveBrandProfile(userId);
    const topic = lastTopicByUser.get(userId) || activeBrand.niche;
    const pack = await generateHooksAndHashtagsForTopic(topic, activeBrand);
    const s = pack.shortScriptOutline;
    const shots = (pack.capcutShotList || [])
      .map(
        (shot) =>
          `*${escapeMd(shot.timeRange)}* · ${escapeMd(shot.visualCut)}\n` +
          `    🅰️ ${escapeMd(shot.onScreenText)}\n` +
          `    🔊 ${escapeMd(shot.audio)}`
      )
      .join("\n");
    await ctx.reply(
      `📝 *Script* · ${escapeMd(topic)}\n` +
        `• *0–3s:* ${escapeMd(s?.hook0to3s || "")}\n` +
        `• *3–20s:* ${escapeMd(s?.valueBody3to20s || "")}\n` +
        `• *20–25s:* ${escapeMd(s?.callToAction || "")}` +
        (shots ? `\n\n🎬 *CapCut Shot List*\n${shots}` : ""),
      { parse_mode: "Markdown" }
    );
    return;
  }

  if (data === "audit_bio") {
    await ctx.answerCallbackQuery();
    await runAggregateToolFlow(ctx, [], "⏳ Optimizing bio…", async (kpis, brand) =>
      formatBioFix(kpis, await generateBioAndProfileFix(kpis, brand))
    );
    return;
  }

  if (data === "audit_7day") {
    await ctx.answerCallbackQuery();
    await runAggregateToolFlow(ctx, [], "⏳ Building 7-day plan…", async (kpis, brand) =>
      formatSevenDayPlan(kpis, await generateSevenDayGrowthPlan(kpis, brand))
    );
    return;
  }

  if (data === "audit_clone") {
    await ctx.answerCallbackQuery();
    await runAggregateToolFlow(ctx, [], "⏳ Cloning your #1 winner…", async (kpis, brand) =>
      formatWinnerClone(kpis, await generateWinnerCloneAndFlopFix(kpis, brand))
    );
    return;
  }

  if (data === "audit_dm") {
    await ctx.answerCallbackQuery();
    await runAggregateToolFlow(ctx, [], "⏳ Writing comment + DM funnel…", async (kpis, brand) =>
      formatCommentDmFunnel(kpis, await generateCommentAndDmFunnel(kpis, brand))
    );
    return;
  }

  await ctx.answerCallbackQuery();
});

// ============================================================================
// Helpers
// ============================================================================
// Resolves KPIs for a one-tap tool: scrape the passed @handle, else reuse the
// user's last audit from getLastAuditForSession.
async function resolveKpisForUser(
  ctx: any,
  args: string[]
): Promise<ComputedAccountKPIs | null> {
  const userId = ctx.from?.id || 0;
  if (args.length > 0) {
    const { platform, handle } = parsePlatformAndHandle(args);
    return fetchAndComputeSocialKPIs(platform, extractCleanHandle(handle), 12);
  }
  const last = await getLastAuditForSession(userId);
  return last?.kpis || null;
}

// Shared "⏳ → result" flow for the one-tap account growth tools.
async function runAggregateToolFlow(
  ctx: any,
  args: string[],
  loadingText: string,
  render: (kpis: ComputedAccountKPIs, brand: BrandProfile) => Promise<string>
): Promise<void> {
  const userId = ctx.from?.id || 0;
  const activeBrand = await getActiveBrandProfile(userId);

  const waitMsg = await ctx.reply(loadingText, { reply_markup: cancelKb() });
  const job = { cancelled: false, statusMsgId: waitMsg.message_id };
  activeJobs.set(userId, job);

  try {
    const result = await withTimeout(
      (async () => {
        const kpis = await resolveKpisForUser(ctx, args);
        if (!kpis) return null;
        const text = await render(kpis, activeBrand);
        return { kpis, text };
      })()
    );

    if (job.cancelled) return;

    if (!result) {
      await ctx.api.editMessageText(
        ctx.chat.id,
        waitMsg.message_id,
        "📊 Run `/audit tiktok @handle` first — or pass one: `/bio @handle`.",
        { parse_mode: "Markdown" }
      );
      return;
    }

    lastTopicByUser.set(userId, result.kpis.handle);
    await ctx.api.editMessageText(ctx.chat.id, waitMsg.message_id, result.text, {
      parse_mode: "Markdown",
    });
  } catch (err: any) {
    if (job.cancelled) return;
    await ctx.api.editMessageText(
      ctx.chat.id,
      waitMsg.message_id,
      err?.message === "TIMEOUT"
        ? "⏱ Timed out after 55s — try a smaller/public @handle."
        : `❌ Failed: ${escapeMd(err?.message || "Unknown error")}`,
      { parse_mode: "Markdown" }
    );
  } finally {
    if (activeJobs.get(userId) === job) activeJobs.delete(userId);
  }
}

function formatBioFix(kpis: ComputedAccountKPIs, data: BioAndProfileFix): string {
  const bios = (data.bios || [])
    .slice(0, 3)
    .map((b) => `*${escapeMd(b.language)}*\n${escapeMd(b.bio)}`)
    .join("\n\n");
  const pinned = (data.pinnedVideoConcepts || [])
    .slice(0, 3)
    .map(
      (p, i) =>
        `*${i + 1}. ${escapeMd(p.title)}*\n${escapeMd(p.concept)}\n` +
        `🪝 ${escapeMd(p.openingHook)}\n👉 ${escapeMd(p.cta)}`
    )
    .join("\n\n");

  return `🪪 *Fix Bio & Pinned* · @${escapeMd(kpis.handle)}\n\n${bios}\n\n📌 *Pinned Videos*\n${pinned}`;
}

function formatSevenDayPlan(kpis: ComputedAccountKPIs, data: SevenDayGrowthPlan): string {
  const days = (data.days || [])
    .slice(0, 7)
    .map(
      (d) =>
        `*Day ${d.day}* · ${escapeMd(d.postingTimeUTC3)} · ${escapeMd(d.pillar)}\n` +
        `🇬🇧 "${escapeMd(d.bilingualHookEn)}"\n` +
        `🇪🇹 "${escapeMd(d.bilingualHookAm)}"\n` +
        `🎬 ${escapeMd(d.visualFormat)}`
    )
    .join("\n\n");

  return `📅 *7-Day Plan* · @${escapeMd(kpis.handle)}\n\n${days}`;
}

function formatWinnerClone(kpis: ComputedAccountKPIs, data: WinnerCloneAndFlopFix): string {
  const sequels = (data.sequelIdeas || [])
    .slice(0, 3)
    .map(
      (s, i) =>
        `*${i + 1}. ${escapeMd(s.title)}*\n` +
        `🇬🇧 "${escapeMd(s.hookEn)}"\n` +
        `🇪🇹 "${escapeMd(s.hookAm)}"\n` +
        `• ${escapeMd(s.whyItWorks)}`
    )
    .join("\n\n");
  const steps = (data.reshootFix?.exactReshootSteps || [])
    .map((step, i) => `${i + 1}. ${escapeMd(step)}`)
    .join("\n");

  return (
    `🧬 *Clone #1 Winner* · @${escapeMd(kpis.handle)}\n` +
    `🏆 ${escapeMd(data.winningPattern)}\n\n${sequels}\n\n` +
    `🚑 *Flop Fix*\n${escapeMd(data.flopDiagnosis)}\n${steps}\n` +
    `🇬🇧 "${escapeMd(data.reshootFix?.newHookEn || "")}"\n` +
    `🇪🇹 "${escapeMd(data.reshootFix?.newHookAm || "")}"`
  );
}

function formatCommentDmFunnel(kpis: ComputedAccountKPIs, data: CommentAndDmFunnel): string {
  const comments = (data.pinnedComments || [])
    .slice(0, 3)
    .map((c, i) => `*${i + 1}. ${escapeMd(c.trigger)}*\n📌 ${escapeMd(c.comment)}`)
    .join("\n\n");
  const dm = (data.dmClosingScript || [])
    .slice(0, 3)
    .map(
      (s) =>
        `*${s.step}. ${escapeMd(s.label)}*\n` +
        `🇬🇧 ${escapeMd(s.english)}\n` +
        `🇪🇹 ${escapeMd(s.amharic)}`
    )
    .join("\n\n");

  return (
    `💬 *Comment & DM Funnel* · @${escapeMd(kpis.handle)}\n\n` +
    `📌 *Pinned Comments*\n${comments}\n\n` +
    `📥 *DM Closing Script*\n${dm}`
  );
}

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
