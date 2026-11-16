import { bot } from "../lib/bot";

async function startLocalPolling() {
  console.log("🚀 Starting SocialPulse AI Bot in local long-polling mode...");
  await bot.api.deleteWebhook();
  await bot.start({
    onStart: (botInfo) => {
      console.log(`✅ Bot @${botInfo.username} is live and listening for commands!`);
    },
  });
}

startLocalPolling().catch((err) => {
  console.error("Failed to start bot:", err);
  process.exit(1);
});
