# SocialPulse AI — Agency Social Media Strategist Telegram Bot

Complete Next.js (TypeScript) + [grammY](https://grammy.dev/) codebase for your internal multi-client social media analytics and content strategy bot across TikTok and Instagram.

## 1. Project Folder Structure

All source files are packaged inside `social_pulse_telegram_bot.zip` with the following layout:

- `package.json` & `tsconfig.json` — Next.js 15 App Router, [grammY](https://grammy.dev/), [Gemini API SDK](https://aistudio.google.com/docs), [Apify Client](https://apify.com/), and [Supabase JS Client](https://supabase.com/) dependencies.
- `.env.example` — Environment variable template for your keys.
- `supabase/schema.sql` — PostgreSQL schema for `brand_profiles`, `user_sessions`, `post_audits`, and `video_roasts`.
- `src/types/social.ts` — TypeScript interfaces for normalized TikTok/Instagram posts, KPI benchmarks, and structured AI JSON outputs.
- `src/lib/supabase.ts` — Multi-client brand profile switcher and audit logger (includes automatic in-memory fallback so you can test the bot locally before configuring [Supabase](https://supabase.com/)).
- `src/lib/scraper.ts` — Calls the [Apify TikTok Scraper](https://apify.com/clockworks/tiktok-scraper) and [Apify Instagram Scraper](https://apify.com/apify/instagram-scraper) and calculates average/median views, engagement rate, optimal video length, best East Africa Time (`UTC+3`) posting hours, and top vs. bottom post comparisons.
- `src/lib/gemini.ts` — Uses [Gemini API Video Understanding](https://aistudio.google.com/docs/video-understanding) to inspect uploaded draft videos (0–3s hook score, pacing drop-offs, frame-level fixes) and generate bilingual (English + Amharic / አማርኛ) hooks, scripts, captions, and 3-tier hashtag stacks.
- `src/lib/bot.ts` — Full [Telegram Bot API](https://core.telegram.org/bots/api) command and callback handlers (`/start`, `/addclient`, `/clients`, `/audit`, `/hooks`, `/spy`, and direct `.mp4`/`.mov` video uploads).
- `src/app/api/telegram/route.ts` — Production Vercel webhook route with a `GET ?setup=true` auto-registration helper.
- `src/scripts/poll.ts` — Local long-polling runner (`npm run bot:poll`) for testing on your laptop without needing a public URL.

## 2. API Keys & Setup Checklist

| Service | Where to Get It | Environment Variable |
| :--- | :--- | :--- |
| **Telegram Bot Token** | Message `@BotFather` on Telegram ([BotFather Tutorial](https://core.telegram.org/bots/tutorial)) and run `/newbot` | `TELEGRAM_BOT_TOKEN` |
| **Google Gemini API Key** | Create a free or paid key in [Google AI Studio](https://aistudio.google.com/docs/get-started) ([Gemini API Pricing](https://ai.google.dev/gemini-api/docs/pricing)) | `GEMINI_API_KEY` |
| **Apify API Token** | Sign up at [Apify](https://apify.com/) (`Settings -> Integrations -> API Tokens`) | `APIFY_API_TOKEN` |
| **Supabase URL & Key** | Create a project at [Supabase](https://supabase.com/) (`Project Settings -> API`) | `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` |

## 3. Step-by-Step Local Run & Vercel Deployment

### Step 1: Unzip and Install Dependencies

```bash
unzip social_pulse_telegram_bot.zip -d social-pulse-bot
cd social-pulse-bot
cp .env.example .env.local
npm install
```

### Step 2: Initialize Your Supabase Database

1. Open your project in [Supabase](https://supabase.com/) and navigate to the **SQL Editor**.
2. Paste the contents of `supabase/schema.sql` and click **Run** to create the `brand_profiles`, `user_sessions`, `post_audits`, and `video_roasts` tables.
3. Copy your Project URL and `service_role` secret key into `.env.local`. (If you skip this step initially, `src/lib/supabase.ts` automatically falls back to in-memory storage so you can still test every command right away.)

### Step 3: Test Locally in 1 Command (Long Polling)

Before deploying to a server, test your bot locally from your terminal:

```bash
npm run bot:poll
```

Open your bot in Telegram and test these commands:

- `/start` — Opens the agency dashboard and displays your active client workspace.
- `/addclient Bole Luxe Fashion | Women's Boutique & E-Commerce | Addis Ababa shoppers 18-35` — Creates and activates a client profile so all hooks and audits match their brand.
- `/clients` — Displays inline buttons to switch between your own accounts and your marketing clients in one tap.
- `/hooks New leather handbag collection in Bole` — Generates 4 bilingual hooks (English + Amharic), a 25-second script outline, bilingual captions, and a 3-tier hashtag stack.
- `/audit tiktok @handle` or `/audit ig @handle` — Scrapes the last 12 posts via the [Apify TikTok Scraper](https://apify.com/clockworks/tiktok-scraper) or [Apify Instagram Scraper](https://apify.com/apify/instagram-scraper), computes KPIs, diagnoses why top posts won vs. why bottom posts flopped, and attaches 1-tap buttons (`[🎯 Copy 3-Tier Hashtags]`, `[📝 Write Full Script #1]`, `[🔄 Generate 4 More Hooks]`).
- `/spy tiktok @competitor` — Scrapes a competitor's top posts, identifies content gaps they missed, and writes 3 stealable video concepts with English and Amharic hooks.
- **Upload any `.mp4` or `.mov` video draft (<20 MB)** — Sends the video to [Gemini API Video Understanding](https://aistudio.google.com/docs/video-understanding) to score the first 3 seconds (`0:00–0:03`), flag exact drop-off timestamps, and write 3 upgraded hooks.

### Step 4: Deploy to Vercel & Register Webhook

1. Push the folder to GitHub and import it into Vercel (see [Supabase for Vercel](https://vercel.com/marketplace/supabase)), adding your environment variables (`TELEGRAM_BOT_TOKEN`, `GEMINI_API_KEY`, `APIFY_API_TOKEN`, `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, and `NEXT_PUBLIC_APP_URL`).
2. Once deployed, open `https://your-project-name.vercel.app/api/telegram?setup=true` in your browser once. That endpoint calls `bot.api.setWebhook(...)` on the [Telegram Bot API](https://core.telegram.org/bots/api) and connects your live bot to Vercel.
