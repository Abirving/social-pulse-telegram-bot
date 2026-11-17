import { NextRequest, NextResponse, after } from "next/server";
import { bot } from "@/lib/bot";

export const dynamic = "force-dynamic";
export const maxDuration = 60; // Allow up to 60s on Vercel for Apify scraping + Gemini video analysis

const BOT_COMMANDS = [
  { command: "stop", description: "Stop the currently running scrape or AI task" },
];

// Dedupe Telegram webhook retries so Apify/Gemini only run once per update
const seenUpdates = new Set<number>();

export async function POST(req: NextRequest) {
  let update: any;
  try {
    update = await req.json();
  } catch {
    return NextResponse.json({ ok: true });
  }

  // Ignore duplicate deliveries of the same update (Telegram retries on timeout)
  if (typeof update?.update_id === "number") {
    if (seenUpdates.has(update.update_id)) {
      return NextResponse.json({ ok: true });
    }
    seenUpdates.add(update.update_id);
    if (seenUpdates.size > 500) {
      const oldest = seenUpdates.values().next().value;
      if (oldest !== undefined) seenUpdates.delete(oldest);
    }
  }

  // Ack Telegram immediately, then process the update in the background
  try {
    await bot.init();
    after(async () => {
      await bot.handleUpdate(update);
    });
  } catch (err: any) {
    console.error("Telegram webhook error:", err);
  }

  return NextResponse.json({ ok: true });
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
