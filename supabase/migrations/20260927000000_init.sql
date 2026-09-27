-- Discoschetos: shared vinyl inventory + Instagram publishing

-- ---------- Profiles (one per auth user) ----------
create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  username text not null unique,
  display_name text not null,
  is_admin boolean not null default false,
  created_at timestamptz not null default now()
);

-- ---------- Records (one per physical vinyl) ----------
create type public.record_status as enum ('draft', 'published', 'sold');

create table public.records (
  id uuid primary key default gen_random_uuid(),
  status public.record_status not null default 'draft',
  owner_id uuid references public.profiles (id) on delete set null,
  created_by uuid references public.profiles (id) on delete set null,

  -- Discogs metadata
  discogs_url text not null,
  discogs_release_id bigint,
  title text not null,
  artists text not null default '',
  labels text not null default '',
  catno text,
  year int,
  country text,
  formats text,
  genres text,
  styles text,
  cover_path text,               -- path inside the "media" bucket
  discogs_videos jsonb not null default '[]'::jsonb,  -- [{title, url, duration}]

  -- Discogs marketplace reference prices (USD)
  ref_price_min numeric,
  ref_price_median numeric,
  ref_price_max numeric,
  ref_currency text,

  -- Sale
  price numeric,
  currency text not null default 'USD',
  media_condition text,
  sleeve_condition text,
  caption text,
  notes text,
  sold_price numeric,
  sold_at timestamptz,

  -- Instagram
  ig_state jsonb,                -- publish state machine, see src/lib/publish.ts
  ig_media_id text,
  ig_permalink text,
  published_at timestamptz,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index records_status_idx on public.records (status);
create index records_owner_idx on public.records (owner_id);

-- ---------- Tracks (one slide of the carousel each) ----------
create table public.tracks (
  id uuid primary key default gen_random_uuid(),
  record_id uuid not null references public.records (id) on delete cascade,
  sort int not null,
  position text not null default '',
  title text not null,
  artists text not null default '',
  duration text,
  selected boolean not null default true,

  -- Chosen audio. Every source ends up as a file in storage (audio_path);
  -- YouTube downloads are queued (audio_status = 'pending') for the audio worker.
  audio_source text check (audio_source in ('youtube', 'deezer', 'itunes', 'upload')),
  audio_ref text,                -- youtube url | deezer/itunes id | original filename
  audio_label text,              -- what the user picked, for display
  audio_status text not null default 'none'
    check (audio_status in ('none', 'pending', 'downloading', 'ready', 'error')),
  audio_path text,               -- file inside the "media" bucket
  audio_duration numeric,        -- seconds
  audio_error text,
  start_sec numeric,             -- clip start inside the audio; null = automatic
  candidates jsonb,              -- cached search results, see src/lib/audio-search.ts

  -- Rendered video
  video_path text,
  video_status text not null default 'none'
    check (video_status in ('none', 'rendering', 'ready', 'error')),
  video_error text,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index tracks_record_idx on public.tracks (record_id, sort);
create index tracks_audio_pending_idx on public.tracks (audio_status) where audio_status = 'pending';

-- ---------- updated_at ----------
create function public.touch_updated_at() returns trigger
language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end $$;

create trigger records_touch before update on public.records
  for each row execute function public.touch_updated_at();
create trigger tracks_touch before update on public.tracks
  for each row execute function public.touch_updated_at();

-- ---------- RLS: small trusted team, every signed-in user sees everything ----------
alter table public.profiles enable row level security;
alter table public.records enable row level security;
alter table public.tracks enable row level security;

create policy "profiles readable by team" on public.profiles
  for select to authenticated using (true);

create policy "records team access" on public.records
  for all to authenticated using (true) with check (true);

create policy "tracks team access" on public.tracks
  for all to authenticated using (true) with check (true);

-- ---------- Storage: public bucket (Instagram needs public URLs) ----------
insert into storage.buckets (id, name, public)
values ('media', 'media', true)
on conflict (id) do nothing;

create policy "team can upload media" on storage.objects
  for insert to authenticated with check (bucket_id = 'media');
create policy "team can update media" on storage.objects
  for update to authenticated using (bucket_id = 'media');
create policy "team can delete media" on storage.objects
  for delete to authenticated using (bucket_id = 'media');

-- ---------- Audio worker queue ----------
-- Atomically claims the oldest pending YouTube download. Called by the worker with the secret key.
create function public.claim_audio_job()
returns setof public.tracks
language sql
security definer
set search_path = public
as $$
  update public.tracks
     set audio_status = 'downloading', audio_error = null
   where id = (
     select id from public.tracks
      where audio_status = 'pending'
      order by updated_at
      limit 1
      for update skip locked
   )
  returning *;
$$;

revoke execute on function public.claim_audio_job() from public, anon, authenticated;
