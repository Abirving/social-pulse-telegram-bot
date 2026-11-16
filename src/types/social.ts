export type SocialPlatform = "tiktok" | "instagram";
export type LanguageMode = "en" | "am" | "bilingual";

export interface BrandProfile {
  id: string;
  owner_telegram_id: number;
  brand_name: string;
  niche: string;
  target_audience: string;
  primary_goal: string;
  preferred_language: LanguageMode;
  tiktok_handle?: string | null;
  instagram_handle?: string | null;
  brand_tone?: string | null;
}

export interface NormalizedSocialPost {
  id: string;
  platform: SocialPlatform;
  url: string;
  caption: string;
  hashtags: string[];
  views: number;
  likes: number;
  comments: number;
  shares: number;
  durationSeconds: number;
  publishedAt: string;
  engagementRate: number;
}

export interface ComputedAccountKPIs {
  platform: SocialPlatform;
  handle: string;
  postsAnalyzed: number;
  avgViews: number;
  medianViews: number;
  avgLikes: number;
  avgComments: number;
  avgShares: number;
  avgEngagementRate: number;
  avgCaptionLength: number;
  avgHashtagCount: number;
  optimalDurationRange: string;
  bestPostingHoursUTC3: string[];
  topPosts: NormalizedSocialPost[];
  bottomPosts: NormalizedSocialPost[];
  topPerformingHashtags: string[];
}

export interface AuditAIResponse {
  healthScore: number;
  executiveDiagnosis: string;
  whyTopPostsWon: string;
  whyBottomPostsDropped: string;
  hookDiagnosis: string;
  rewrittenHooks: {
    style: string;
    englishHook: string;
    amharicHook: string;
    visualDirection: string;
  }[];
  hashtagStrategy: {
    broadNiche: string[];
    midVolumeCategory: string[];
    localAndIntent: string[];
  };
  nextThreeVideosToFilm: {
    title: string;
    format: string;
    opening3Seconds: string;
    cta: string;
  }[];
  singleNextActionToday: string;
}

export interface VideoRoastAIResponse {
  hookScoreOutOf10: number;
  pacingScoreOutOf10: number;
  retentionRiskLevel: "Low" | "Medium" | "High";
  firstThreeSecondsVerdict: string;
  timestampedDropOffRisks: {
    timestamp: string;
    issue: string;
    fix: string;
  }[];
  upgradedHooks: {
    angle: string;
    spokenOrTextEn: string;
    spokenOrTextAm: string;
    firstFrameVisual: string;
  }[];
  recommendedCaptionEn: string;
  recommendedCaptionAm: string;
  hashtagPack: string[];
  nextStepBeforePosting: string;
}

export interface HookAndHashtagPack {
  topic: string;
  hooks: {
    framework: string;
    hookEn: string;
    hookAm: string;
    visualAction: string;
  }[];
  shortScriptOutline: {
    hook0to3s: string;
    valueBody3to20s: string;
    callToAction: string;
  };
  captionEn: string;
  captionAm: string;
  hashtags: {
    broad: string[];
    niche: string[];
    local: string[];
  };
}

export interface CompetitorSpyResponse {
  competitorHandle: string;
  winningPatternSummary: string;
  hookFormulasTheyUse: string[];
  contentGapsTheyMissed: string[];
  stealableVideoIdeas: {
    conceptTitle: string;
    openingHookEn: string;
    openingHookAm: string;
    whyItBeatsCompetitor: string;
  }[];
}
