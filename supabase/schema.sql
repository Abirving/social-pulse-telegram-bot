-- ============================================================================
-- SocialPulse AI - Multi-Client Social Media Advisor Bot Schema (Supabase)
-- Run this script in your Supabase SQL Editor (https://supabase.com/)
-- ============================================================================

create extension if not exists "uuid-ossp";

-- 1. Client Brand Profiles (Manage your own accounts + multiple agency clients)
create table if not exists public.brand_profiles (
  id uuid primary key default uuid_generate_v4(),
  owner_telegram_id bigint not null,
  brand_name text not null,
  niche text not null,
  target_audience text not null default 'Addis Ababa & Diaspora shoppers',
  primary_goal text not null default 'Short-form reach, hooks & DM leads',
  preferred_language text not null default 'bilingual' check (preferred_language in ('en', 'am', 'bilingual')),
  tiktok_handle text,
  instagram_handle text,
  brand_tone text default 'Direct, energetic, and authentic',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_brand_profiles_owner on public.brand_profiles(owner_telegram_id);

-- 2. Active Telegram User Session & Context State
create table if not exists public.user_sessions (
  telegram_id bigint primary key,
  active_brand_id uuid references public.brand_profiles(id) on delete set null,
  last_audit_summary jsonb,
  last_topic text,
  updated_at timestamptz not null default now()
);

-- 3. Historical Profile & Competitor Audits (/audit and /spy logs)
create table if not exists public.post_audits (
  id uuid primary key default uuid_generate_v4(),
  telegram_id bigint not null,
  brand_id uuid references public.brand_profiles(id) on delete cascade,
  audit_type text not null check (audit_type in ('self_audit', 'competitor_spy')),
  platform text not null check (platform in ('tiktok', 'instagram')),
  handle text not null,
  posts_analyzed int not null default 0,
  avg_views numeric(12, 2) default 0,
  engagement_rate numeric(6, 2) default 0,
  metrics_snapshot jsonb not null default '{}'::jsonb,
  ai_recommendations jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists idx_post_audits_brand on public.post_audits(brand_id, created_at desc);

-- 4. Pre-Post Video & 3-Second Hook Roasts (Multimodal Gemini Video Analysis)
create table if not exists public.video_roasts (
  id uuid primary key default uuid_generate_v4(),
  telegram_id bigint not null,
  brand_id uuid references public.brand_profiles(id) on delete cascade,
  telegram_file_id text not null,
  duration_seconds int,
  hook_score int check (hook_score between 1 and 10),
  retention_risk_level text,
  ai_feedback jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
