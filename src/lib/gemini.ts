import { GoogleGenAI } from "@google/genai";
import {
  AuditAIResponse,
  BrandProfile,
  CompetitorSpyResponse,
  ComputedAccountKPIs,
  HookAndHashtagPack,
  VideoRoastAIResponse,
} from "../types/social";

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY || "" });
// gemini-3.8-flash only allows ~20 free requests/day, so default to the lite model
const MODEL_NAME = process.env.GEMINI_MODEL || "gemini-3.8-flash-lite";
const FALLBACK_MODELS = ["gemini-3.8-flash-lite", "gemini-3.8-flash", "gemini-3.0-flash"];
const RETRY_DELAY_MS = 1200;

function getErrorSignals(err: any): string[] {
  return [
    err?.status,
    err?.code,
    err?.error?.status,
    err?.error?.code,
    err?.message,
  ].map((signal) => String(signal ?? ""));
}

// Temporary spike — a single short retry on the same model is safe
function isUnavailableGeminiError(err: any): boolean {
  return getErrorSignals(err).some(
    (signal) => signal.includes("503") || signal.includes("UNAVAILABLE")
  );
}

// Daily free quota exhausted — retrying the same model is pointless
function isQuotaGeminiError(err: any): boolean {
  return getErrorSignals(err).some(
    (signal) => signal.includes("429") || signal.includes("RESOURCE_EXHAUSTED")
  );
}

/**
 * Calls Gemini, retrying once on temporary 503/UNAVAILABLE spikes and falling
 * back across models when the daily free quota (429) is exhausted.
 */
async function callGeminiWithRetry(
  params: Parameters<typeof ai.models.generateContent>[0]
) {
  const primaryModel = (params.model as string) || MODEL_NAME;
  const modelsToTry = [
    primaryModel,
    ...FALLBACK_MODELS.filter((m) => m !== primaryModel),
  ];

  let sawQuotaError = false;

  for (const model of modelsToTry) {
    // Max 1 retry per model (2 attempts total)
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        return await ai.models.generateContent({ ...params, model });
      } catch (err: any) {
        if (isQuotaGeminiError(err)) {
          // Daily quota exceeded — move to the next model immediately
          sawQuotaError = true;
          break;
        }
        if (isUnavailableGeminiError(err)) {
          // Temporary spike — retry this model once after a short delay
          if (attempt === 0) {
            await new Promise((r) => setTimeout(r, RETRY_DELAY_MS));
            continue;
          }
          break;
        }
        // Anything else (bad request, auth, etc.) is not retryable
        throw err;
      }
    }
  }

  if (sawQuotaError) {
    throw new Error(
      "Daily free Gemini quota reached across fallback models. Enable billing in Google AI Studio or try again after reset."
    );
  }
  throw new Error("Gemini request failed after retries.");
}


/**
 * 1. Analyze an uploaded draft video (MP4/MOV) for 3-second hook strength,
 * visual/audio pacing, drop-off timestamps, and bilingual hook rewrites.
 */
export async function analyzeUploadedVideoDraft(
  localFilePath: string,
  mimeType: string,
  brand: BrandProfile,
  userNote?: string
): Promise<VideoRoastAIResponse> {
  const uploadedFile = await ai.files.upload({
    file: localFilePath,
    config: { mimeType },
  });

  // Poll until Gemini File API finishes processing the video stream
  let fileState = await ai.files.get({ name: uploadedFile.name! });
  let attempts = 0;
  while (fileState.state === "PROCESSING" && attempts < 20) {
    await new Promise((r) => setTimeout(r, 2500));
    fileState = await ai.files.get({ name: uploadedFile.name! });
    attempts++;
  }

  if (fileState.state === "FAILED") {
    throw new Error("Gemini video processing failed on this clip.");
  }

  const prompt = `
You are a senior short-form video creative director and social media performance analyst for TikTok and Instagram Reels.
Analyze this draft video frame-by-frame and audio-stream for our client brand:
- Brand Name: ${brand.brand_name}
- Niche: ${brand.niche}
- Target Audience: ${brand.target_audience}
- Primary Goal: ${brand.primary_goal}
- User Context / Note: ${userNote || "Pre-post hook and retention check"}

Evaluate:
1. The exact first 3 seconds (0:00-0:03): Is there a clear visual pattern interrupt, on-screen text hook, and spoken hook?
2. Pacing and retention risks: Identify exact timestamps (e.g., "0:04", "0:11") where viewers are likely to scroll away due to slow pauses, lack of visual change, or unclear payoff, and explain how to fix each cut.
3. Provide 3 high-converting rewritten hooks (Curiosity Gap, Contrarian/Warning, and Direct Value/Result) in BOTH natural English and natural, idiomatic Amharic (አማርኛ) suitable for Addis Ababa TikTok/Reels audiences, plus the exact opening frame visual action.
4. Provide ready-to-post English and Amharic captions, a 10-hashtag mix, and the #1 edit to make before hitting publish.

Return STRICT JSON matching this exact structure:
{
  "hookScoreOutOf10": 8,
  "pacingScoreOutOf10": 7,
  "retentionRiskLevel": "Low" | "Medium" | "High",
  "firstThreeSecondsVerdict": "...",
  "timestampedDropOffRisks": [
    { "timestamp": "0:00-0:02", "issue": "...", "fix": "..." }
  ],
  "upgradedHooks": [
    {
      "angle": "Curiosity / Pattern Interrupt",
      "spokenOrTextEn": "...",
      "spokenOrTextAm": "...",
      "firstFrameVisual": "..."
    }
  ],
  "recommendedCaptionEn": "...",
  "recommendedCaptionAm": "...",
  "hashtagPack": ["#tag1", "#tag2"],
  "nextStepBeforePosting": "..."
}`;

  const response = await callGeminiWithRetry({
    model: MODEL_NAME,
    contents: [
      {
        role: "user",
        parts: [
          {
            fileData: {
              fileUri: fileState.uri!,
              mimeType: fileState.mimeType || mimeType,
            },
          },
          { text: prompt },
        ],
      },
    ],
    config: {
      responseMimeType: "application/json",
      temperature: 0.4,
    },
  });

  // Clean up remote file after analysis
  await ai.files.delete({ name: uploadedFile.name! }).catch(() => null);

  return JSON.parse(response.text || "{}") as VideoRoastAIResponse;
}

/**
 * 2. Analyze scraped TikTok / Instagram profile KPIs and generate a next-step strategy.
 */
export async function generateAccountAuditAdvice(
  kpis: ComputedAccountKPIs,
  brand: BrandProfile
): Promise<AuditAIResponse> {
  const prompt = `
You are a data-driven TikTok & Instagram growth strategist.
Analyze the following scraped account metrics for @${kpis.handle} on ${kpis.platform.toUpperCase()}:

Client Brand Context:
- Brand: ${brand.brand_name} (${brand.niche})
- Target Audience: ${brand.target_audience}
- Primary Goal: ${brand.primary_goal}

Quantitative Account Benchmarks (Last ${kpis.postsAnalyzed} posts):
- Average Views: ${kpis.avgViews} (Median: ${kpis.medianViews})
- Average Engagement Rate: ${kpis.avgEngagementRate}%
- Average Likes: ${kpis.avgLikes} | Comments: ${kpis.avgComments} | Shares: ${kpis.avgShares}
- Optimal Video Duration from Top Posts: ${kpis.optimalDurationRange}
- Best Posting Windows (EAT / UTC+3): ${kpis.bestPostingHoursUTC3.join(", ")}
- Top Performing Hashtags Used: ${kpis.topPerformingHashtags.join(", ") || "None"}

Top 2 Outperforming Posts:
${JSON.stringify(kpis.topPosts, null, 2)}

Bottom 2 Underperforming Posts:
${JSON.stringify(kpis.bottomPosts, null, 2)}

Provide concrete, zero-fluff analytical advice on what @${kpis.handle} must do next.
Include bilingual hooks (English + natural Amharic / አማርኛ), a 3-tier hashtag strategy (Broad Niche, Mid-Volume Category, Local/High-Intent), 3 specific next videos to film, and the single highest-impact action to take today.

Return STRICT JSON matching this structure:
{
  "healthScore": 75,
  "executiveDiagnosis": "...",
  "whyTopPostsWon": "...",
  "whyBottomPostsDropped": "...",
  "hookDiagnosis": "...",
  "rewrittenHooks": [
    {
      "style": "Problem Callout / Curiosity",
      "englishHook": "...",
      "amharicHook": "...",
      "visualDirection": "..."
    }
  ],
  "hashtagStrategy": {
    "broadNiche": ["#..."],
    "midVolumeCategory": ["#..."],
    "localAndIntent": ["#..."]
  },
  "nextThreeVideosToFilm": [
    {
      "title": "...",
      "format": "Talking head + B-roll / POV / Product demo",
      "opening3Seconds": "...",
      "cta": "..."
    }
  ],
  "singleNextActionToday": "..."
}`;

  const response = await callGeminiWithRetry({
    model: MODEL_NAME,
    contents: prompt,
    config: {
      responseMimeType: "application/json",
      temperature: 0.4,
    },
  });

  return JSON.parse(response.text || "{}") as AuditAIResponse;
}

/**
 * 3. Generate Bilingual (English + Amharic) Viral Hooks, Script Outline, Captions & 3-Tier Hashtags
 */
export async function generateHooksAndHashtagsForTopic(
  topic: string,
  brand: BrandProfile
): Promise<HookAndHashtagPack> {
  const prompt = `
Generate a high-converting TikTok & Instagram Reels content pack for the topic/offer: "${topic}"

Client Brand Profile:
- Brand: ${brand.brand_name}
- Niche: ${brand.niche}
- Target Audience: ${brand.target_audience}
- Goal: ${brand.primary_goal}

Write 4 distinct hooks using proven viral frameworks (1. Curiosity Gap, 2. Contrarian / Mistake Warning, 3. Specific Numbers / Proof, 4. Relatable Local POV) in BOTH punchy English and authentic, conversational Amharic (አማርኛ) as spoken in Addis Ababa.
Also provide a tight 25-second script outline, ready-to-paste English & Amharic captions, and a 3-tier hashtag stack.

Return STRICT JSON:
{
  "topic": "${topic}",
  "hooks": [
    {
      "framework": "Curiosity Gap",
      "hookEn": "...",
      "hookAm": "...",
      "visualAction": "..."
    }
  ],
  "shortScriptOutline": {
    "hook0to3s": "...",
    "valueBody3to20s": "...",
    "callToAction": "..."
  },
  "captionEn": "...",
  "captionAm": "...",
  "hashtags": {
    "broad": ["#..."],
    "niche": ["#..."],
    "local": ["#..."]
  }
}`;

  const response = await callGeminiWithRetry({
    model: MODEL_NAME,
    contents: prompt,
    config: {
      responseMimeType: "application/json",
      temperature: 0.5,
    },
  });

  return JSON.parse(response.text || "{}") as HookAndHashtagPack;
}

/**
 * 4. Competitor Spy Analysis (/spy @competitor)
 */
export async function generateCompetitorSpyReport(
  competitorKpis: ComputedAccountKPIs,
  clientBrand: BrandProfile
): Promise<CompetitorSpyResponse> {
  const prompt = `
You are a competitive intelligence strategist for social media marketing.
We scraped our competitor @${competitorKpis.handle} on ${competitorKpis.platform.toUpperCase()}.
Compare their performance and top posts against our client brand (${clientBrand.brand_name} - ${clientBrand.niche}, targeting ${clientBrand.target_audience}).

Competitor Metrics:
- Avg Views: ${competitorKpis.avgViews} | Engagement Rate: ${competitorKpis.avgEngagementRate}%
- Optimal Video Length: ${competitorKpis.optimalDurationRange}
- Top Performing Posts: ${JSON.stringify(competitorKpis.topPosts, null, 2)}
- Lowest Performing Posts: ${JSON.stringify(competitorKpis.bottomPosts, null, 2)}

Extract their winning patterns, identify the content gaps they are missing, and give our client 3 "stealable" video concepts with both English and Amharic (አማርኛ) opening hooks that outperform the competitor's angle.

Return STRICT JSON:
{
  "competitorHandle": "@${competitorKpis.handle}",
  "winningPatternSummary": "...",
  "hookFormulasTheyUse": ["..."],
  "contentGapsTheyMissed": ["..."],
  "stealableVideoIdeas": [
    {
      "conceptTitle": "...",
      "openingHookEn": "...",
      "openingHookAm": "...",
      "whyItBeatsCompetitor": "..."
    }
  ]
}`;

  const response = await callGeminiWithRetry({
    model: MODEL_NAME,
    contents: prompt,
    config: {
      responseMimeType: "application/json",
      temperature: 0.4,
    },
  });

  return JSON.parse(response.text || "{}") as CompetitorSpyResponse;
}
