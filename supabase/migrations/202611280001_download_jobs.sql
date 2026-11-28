-- Download job audit table for the J.A.R.V.I.S. authorized media delivery worker.
-- Run this once in the Supabase SQL Editor for the existing whatsapp-bot project.

create table if not exists public.download_jobs (
  job_id uuid primary key,
  wa_jid text not null,
  requested_by text not null,
  title text not null,
  total_files integer not null check (total_files >= 1 and total_files <= 8),
  completed_files integer not null default 0 check (completed_files >= 0),
  status text not null default 'queued'
    check (status in ('queued', 'running', 'completed', 'failed')),
  error_message text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists download_jobs_created_at_idx
  on public.download_jobs (created_at desc);

create index if not exists download_jobs_wa_jid_created_at_idx
  on public.download_jobs (wa_jid, created_at desc);

alter table public.download_jobs enable row level security;

-- Intentionally no anon/authenticated policies.
-- The bot accesses this table only with the server-side Supabase service-role key.
