import { createClient, SupabaseClient } from "@supabase/supabase-js";
import { BrandProfile, ComputedAccountKPIs, AuditAIResponse, VideoRoastAIResponse } from "../types/social";

const supabaseUrl = process.env.SUPABASE_URL || "";
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || "";

const supabase: SupabaseClient | null =
  supabaseUrl && supabaseKey ? createClient(supabaseUrl, supabaseKey) : null;

// In-memory fallback so you can test the bot before setting up Supabase
const memoryProfiles = new Map<number, BrandProfile[]>();
const memoryActiveBrand = new Map<number, BrandProfile>();
const memoryLastAudit = new Map<number, { kpis: ComputedAccountKPIs; ai: AuditAIResponse }>();

const DEFAULT_BRAND = (telegramId: number): BrandProfile => ({
  id: "default-agency-brand",
  owner_telegram_id: telegramId,
  brand_name: "Default Agency Client",
  niche: "E-Commerce, Retail & Digital Services",
  target_audience: "Addis Ababa & urban youth / shoppers (18-38)",
  primary_goal: "High 3-second hook retention, shares & DM inquiries",
  preferred_language: "bilingual",
  brand_tone: "Direct, energetic, culturally relevant (English + Amharic)",
});

export async function getActiveBrandProfile(telegramId: number): Promise<BrandProfile> {
  if (!supabase) {
    return memoryActiveBrand.get(telegramId) || DEFAULT_BRAND(telegramId);
  }

  const { data: session } = await supabase
    .from("user_sessions")
    .select("active_brand_id")
    .eq("telegram_id", telegramId)
    .single();

  if (session?.active_brand_id) {
    const { data: brand } = await supabase
      .from("brand_profiles")
      .select("*")
      .eq("id", session.active_brand_id)
      .single();
    if (brand) return brand as BrandProfile;
  }

  const { data: firstBrand } = await supabase
    .from("brand_profiles")
    .select("*")
    .eq("owner_telegram_id", telegramId)
    .order("created_at", { ascending: false })
    .limit(1)
    .single();

  return (firstBrand as BrandProfile) || DEFAULT_BRAND(telegramId);
}

export async function listClientBrands(telegramId: number): Promise<BrandProfile[]> {
  if (!supabase) {
    return memoryProfiles.get(telegramId) || [DEFAULT_BRAND(telegramId)];
  }

  const { data } = await supabase
    .from("brand_profiles")
    .select("*")
    .eq("owner_telegram_id", telegramId)
    .order("created_at", { ascending: false });

  return (data as BrandProfile[]) || [];
}

export async function createClientBrand(
  telegramId: number,
  brandName: string,
  niche: string,
  targetAudience: string,
  preferredLanguage: "en" | "am" | "bilingual" = "bilingual"
): Promise<BrandProfile> {
  const newBrand: BrandProfile = {
    id: `brand_${Date.now()}`,
    owner_telegram_id: telegramId,
    brand_name: brandName,
    niche,
    target_audience: targetAudience,
    primary_goal: "Short-form video reach, watch-time & DM conversions",
    preferred_language: preferredLanguage,
  };

  if (!supabase) {
    const existing = memoryProfiles.get(telegramId) || [];
    memoryProfiles.set(telegramId, [newBrand, ...existing]);
    memoryActiveBrand.set(telegramId, newBrand);
    return newBrand;
  }

  const { data, error } = await supabase
    .from("brand_profiles")
    .insert({
      owner_telegram_id: telegramId,
      brand_name: brandName,
      niche,
      target_audience: targetAudience,
      preferred_language: preferredLanguage,
    })
    .select("*")
    .single();

  if (error || !data) {
    return newBrand;
  }

  await supabase.from("user_sessions").upsert({
    telegram_id: telegramId,
    active_brand_id: data.id,
    updated_at: new Date().toISOString(),
  });

  return data as BrandProfile;
}

export async function switchActiveClientBrand(
  telegramId: number,
  brandId: string
): Promise<BrandProfile | null> {
  if (!supabase) {
    const list = memoryProfiles.get(telegramId) || [];
    const found = list.find((b) => b.id === brandId) || null;
    if (found) memoryActiveBrand.set(telegramId, found);
    return found;
  }

  const { data: brand } = await supabase
    .from("brand_profiles")
    .select("*")
    .eq("id", brandId)
    .eq("owner_telegram_id", telegramId)
    .single();

  if (!brand) return null;

  await supabase.from("user_sessions").upsert({
    telegram_id: telegramId,
    active_brand_id: brand.id,
    updated_at: new Date().toISOString(),
  });

  return brand as BrandProfile;
}

export async function saveAuditResult(
  telegramId: number,
  brandId: string,
  auditType: "self_audit" | "competitor_spy",
  kpis: ComputedAccountKPIs,
  aiRecommendations: AuditAIResponse | Record<string, unknown>
): Promise<void> {
  if (auditType === "self_audit" && "healthScore" in aiRecommendations) {
    memoryLastAudit.set(telegramId, {
      kpis,
      ai: aiRecommendations as AuditAIResponse,
    });
  }

  if (!supabase || brandId === "default-agency-brand") return;

  await supabase.from("post_audits").insert({
    telegram_id: telegramId,
    brand_id: brandId,
    audit_type: auditType,
    platform: kpis.platform,
    handle: kpis.handle,
    posts_analyzed: kpis.postsAnalyzed,
    avg_views: kpis.avgViews,
    engagement_rate: kpis.avgEngagementRate,
    metrics_snapshot: kpis,
    ai_recommendations: aiRecommendations,
  });

  await supabase.from("user_sessions").upsert({
    telegram_id: telegramId,
    last_audit_summary: { kpis, aiRecommendations },
    updated_at: new Date().toISOString(),
  });
}

export async function getLastAuditForSession(
  telegramId: number
): Promise<{ kpis: ComputedAccountKPIs; ai: AuditAIResponse } | null> {
  if (memoryLastAudit.has(telegramId)) {
    return memoryLastAudit.get(telegramId) || null;
  }
  if (!supabase) return null;

  const { data } = await supabase
    .from("user_sessions")
    .select("last_audit_summary")
    .eq("telegram_id", telegramId)
    .single();

  if (data?.last_audit_summary?.kpis && data?.last_audit_summary?.aiRecommendations) {
    return {
      kpis: data.last_audit_summary.kpis as ComputedAccountKPIs,
      ai: data.last_audit_summary.aiRecommendations as AuditAIResponse,
    };
  }
  return null;
}

export async function saveVideoRoastResult(
  telegramId: number,
  brandId: string,
  fileId: string,
  durationSeconds: number,
  roast: VideoRoastAIResponse
): Promise<void> {
  if (!supabase || brandId === "default-agency-brand") return;

  await supabase.from("video_roasts").insert({
    telegram_id: telegramId,
    brand_id: brandId,
    telegram_file_id: fileId,
    duration_seconds: durationSeconds,
    hook_score: roast.hookScoreOutOf10,
    retention_risk_level: roast.retentionRiskLevel,
    ai_feedback: roast,
  });
}
