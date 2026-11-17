import { NextRequest, NextResponse } from "next/server";
import { webhookCallback } from "grammy";
import { bot } from "@/lib/bot";

export const dynamic = "force-dynamic";
export const maxDuration = 60; // Allow up to 60s on Vercel for Apify scraping + Gemini video analysis

const BOT_COMMANDS = [
  { command: "stop", description: "Stop the currently running scrape or AI task" },
];

const handleUpdate = webhookCallback(bot, "std/http");

export async function POST(req: NextRequest) {
  try {
    return await handleUpdate(req);
  } catch (err: any) {
    console.error("Telegram webhook error:", err);
    return NextResponse.json({ ok: false, error: err.message }, { status: 500 });
  }
}

/**
 * Visit https://your-domain.vercel.app/api/telegram?setup=true
 * once after deployment to automatically register the webhook URL with Telegram!
 */
export async function GET(req: NextRequest) {
  const setup = req.nextUrl.searchParams.get("setup");
  if (setup === "true") {
    const appUrl = process.env.NEXT_PUBLIC_APP_URL || req.nextUrl.origin;
    const webhookUrl = `${appUrl.replace(/\/$/, "")}/api/telegram`;
    await bot.api.setWebhook(webhookUrl);
    await bot.api.setMyCommands(BOT_COMMANDS);
    return NextResponse.json({
      ok: true,
      message: `Telegram webhook registered to ${webhookUrl}`,
    });
  }

  return NextResponse.json({
    ok: true,
    service: "SocialPulse AI Telegram Webhook Endpoint",
    hint: "Append ?setup=true to register this URL with Telegram Bot API.",
  });
}
