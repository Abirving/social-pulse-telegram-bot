import { GoogleGenAI } from "@google/genai";
import {
  AuditAIResponse,
  BioAndProfileFix,
  BrandProfile,
  CommentAndDmFunnel,
  CompetitorSpyResponse,
  ComputedAccountKPIs,
  HookAndHashtagPack,
  SevenDayGrowthPlan,
  VideoRoastAIResponse,
  WinnerCloneAndFlopFix,
} from "../types/social";

const ai = new GoogleGenAI({
  apiKey: process.env.GEMINI_API_KEY || "",
  httpOptions: { apiVersion: "v1beta" },
});
// Valid Google AI Studio model ids. The first entry is overridable via GEMINI_MODEL.
const MODEL_NAME = process.env.GEMINI_MODEL || "gemini-3.5-flash-lite";
const FALLBACK_MODELS = [
  process.env.GEMINI_MODEL || "gemini-3.5-flash-lite",
  "gemini-3.6-flash",
  "gemini-3.8-flash",
];
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

// Model id not found / retired for this API key — try the next model instead
function isUnknownModelGeminiError(err: any): boolean {
  return getErrorSignals(err).some(
    (signal) => signal.includes("404") || signal.includes("NOT_FOUND")
  );
}

/**
 * Calls Gemini, retrying once on temporary 503/UNAVAILABLE spikes and falling
 * back across models when the daily free quota (429) is exhausted or a model id
 * is not available for the current API key (404/NOT_FOUND).
 */
async function callGeminiWithRetry(
  params: Parameters<typeof ai.models.generateContent>[0]
) {
  const modelsToTry = Array.from(new Set(FALLBACK_MODELS));

  let sawQuotaError = false;
  let sawUnknownModelError = false;

  for (const model of modelsToTry) {
    // Max 1 retry per model (2 attempts total)
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        return await ai.models.generateContent({ ...params, model });
      } catch (err: any) {
        if (isQuotaGeminiError(err)) {
          // Daily quota exceeded — try the next model immediately
          sawQuotaError = true;
          break;
        }
        if (isUnknownModelGeminiError(err)) {
          // Model not available for this key — try the next model immediately
          sawUnknownModelError = true;
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
  if (sawUnknownModelError) {
    throw new Error(
      `None of the configured Gemini models are available for this API key. Set GEMINI_MODEL to a supported model (e.g. gemini-3.5-flash-lite).`
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
Also provide a tight 25-second script outline, a 5-scene CapCut shot list (exact time ranges: 0-2s, 2-6s, 6-12s, 12-18s, 18-22s — each with the Visual Cut, On-Screen Text, and Audio), ready-to-paste English & Amharic captions, and a 3-tier hashtag stack.

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
  "capcutShotList": [
    {
      "timeRange": "0-2s",
      "visualCut": "...",
      "onScreenText": "...",
      "audio": "..."
    }
  ],
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

/**
 * 5. Bio & Pinned Post Optimizer — 3 high-converting bios + 3 pinned video concepts.
 */
export async function generateBioAndProfileFix(
  kpis: ComputedAccountKPIs,
  brand: BrandProfile
): Promise<BioAndProfileFix> {
  const prompt = `
You are a conversion-focused social profile strategist for TikTok & Instagram.
Account: @${kpis.handle} (${kpis.platform.toUpperCase()})
Client Brand: ${brand.brand_name} | Niche: ${brand.niche}
Target Audience: ${brand.target_audience}
Primary Goal: ${brand.primary_goal}
Top Performing Hashtags: ${kpis.topPerformingHashtags.join(", ") || "None"}
Best Posting Windows (EAT / UTC+3): ${kpis.bestPostingHoursUTC3.join(", ")}

Write 3 high-converting profile bios (one English, one Amharic / አማርኛ, one Bilingual). Each bio must state a clear value proposition and end with a direct call to action (DM, link, order).
Then propose 3 must-film "Pinned Video" concepts to sit at the top of the grid — the strongest door-openers for a first-time visitor.

Return STRICT JSON:
{
  "bios": [
    { "language": "English", "bio": "..." },
    { "language": "Amharic", "bio": "..." },
    { "language": "Bilingual", "bio": "..." }
  ],
  "pinnedVideoConcepts": [
    { "title": "...", "concept": "...", "openingHook": "...", "cta": "..." }
  ]
}`;

  const response = await callGeminiWithRetry({
    model: MODEL_NAME,
    contents: prompt,
    config: {
      responseMimeType: "application/json",
      temperature: 0.5,
    },
  });

  return JSON.parse(response.text || "{}") as BioAndProfileFix;
}

/**
 * 6. 7-Day Growth Plan — a daily content calendar rotating Viral Reach / Proof / Offer pillars.
 */
export async function generateSevenDayGrowthPlan(
  kpis: ComputedAccountKPIs,
  brand: BrandProfile
): Promise<SevenDayGrowthPlan> {
  const prompt = `
You are a social content planner. Build a 7-day posting calendar (Day 1–7) for @${kpis.handle} (${kpis.platform.toUpperCase()}).
Client Brand: ${brand.brand_name} | Niche: ${brand.niche}
Target Audience: ${brand.target_audience}
Primary Goal: ${brand.primary_goal}
Best Posting Windows (EAT / UTC+3): ${kpis.bestPostingHoursUTC3.join(", ")}
Optimal Video Length: ${kpis.optimalDurationRange}
Top Performing Hashtags: ${kpis.topPerformingHashtags.join(", ") || "None"}

Rotate the content pillar each day among exactly these three values: "Viral Reach", "Proof/Behind-the-Scenes", "Offer/CTA".
For each day give the posting time (use the EAT / UTC+3 windows above), the pillar, a bilingual hook (English + Amharic / አማርኛ), and the visual format.

Return STRICT JSON:
{
  "days": [
    {
      "day": 1,
      "postingTimeUTC3": "18:30",
      "pillar": "Viral Reach",
      "bilingualHookEn": "...",
      "bilingualHookAm": "...",
      "visualFormat": "Talking head + B-roll / POV / Product demo"
    }
  ]
}`;

  const response = await callGeminiWithRetry({
    model: MODEL_NAME,
    contents: prompt,
    config: {
      responseMimeType: "application/json",
      temperature: 0.5,
    },
  });

  return JSON.parse(response.text || "{}") as SevenDayGrowthPlan;
}

/**
 * 7. Winner Clone & Flop Fix — replicate the #1 post pattern and reshoot the worst post.
 */
export async function generateWinnerCloneAndFlopFix(
  kpis: ComputedAccountKPIs,
  brand: BrandProfile
): Promise<WinnerCloneAndFlopFix> {
  const prompt = `
You are a growth analyst studying @${kpis.handle} (${kpis.platform.toUpperCase()}).
Client Brand: ${brand.brand_name} | Niche: ${brand.niche}
Target Audience: ${brand.target_audience}
Primary Goal: ${brand.primary_goal}

#1 WINNING POST:
${JSON.stringify(kpis.topPosts?.[0] ?? null, null, 2)}

WORST-PERFORMING POST:
${JSON.stringify(kpis.bottomPosts?.[0] ?? null, null, 2)}

Lock onto the winning pattern behind the #1 post and design 3 sequels that replicate it. Then diagnose exactly why the worst post flopped and give an exact reshoot fix (step-by-step) with a new hook in English + Amharic (አማርኛ).

Return STRICT JSON:
{
  "winningPattern": "...",
  "sequelIdeas": [
    { "title": "...", "hookEn": "...", "hookAm": "...", "whyItWorks": "..." }
  ],
  "flopDiagnosis": "...",
  "reshootFix": {
    "originalPostIssue": "...",
    "exactReshootSteps": ["..."],
    "newHookEn": "...",
    "newHookAm": "..."
  }
}`;

  const response = await callGeminiWithRetry({
    model: MODEL_NAME,
    contents: prompt,
    config: {
      responseMimeType: "application/json",
      temperature: 0.4,
    },
  });

  return JSON.parse(response.text || "{}") as WinnerCloneAndFlopFix;
}

/**
 * 8. Comment & DM Funnel — algorithm-boosting pinned comments + a bilingual DM closing script.
 */
export async function generateCommentAndDmFunnel(
  kpis: ComputedAccountKPIs,
  brand: BrandProfile
): Promise<CommentAndDmFunnel> {
  const prompt = `
You are a conversion copywriter for TikTok & Instagram commerce accounts.
Account: @${kpis.handle} (${kpis.platform.toUpperCase()})
Client Brand: ${brand.brand_name} | Niche: ${brand.niche}
Target Audience: ${brand.target_audience}
Primary Goal: ${brand.primary_goal}

1. Write 3 pinned comments that boost the algorithm (for example a price reveal or a poll/vote trigger) — each with the comment text and the trigger it creates (comments, saves, or DMs).
2. Write a 3-step DM closing script in BOTH English and Amharic (አማርኛ) that converts "ዋጋ ስንት ነው? / Price?" inquiries into orders or site visits.

Return STRICT JSON:
{
  "pinnedComments": [
    { "trigger": "Drives comment replies", "comment": "..." }
  ],
  "dmClosingScript": [
    { "step": 1, "label": "Acknowledge & Qualify", "english": "...", "amharic": "..." }
  ]
}`;

  const response = await callGeminiWithRetry({
    model: MODEL_NAME,
    contents: prompt,
    config: {
      responseMimeType: "application/json",
      temperature: 0.5,
    },
  });

  return JSON.parse(response.text || "{}") as CommentAndDmFunnel;
}
