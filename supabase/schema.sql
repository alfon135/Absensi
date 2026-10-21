create table if not exists public.face_users (
  id text primary key,
  name text not null,
  code text not null,
  role text not null,
  samples jsonb not null default '[]'::jsonb,
  photo text not null default '',
  updated_at timestamptz not null default now()
);

create table if not exists public.attendance_logs (
  id text primary key,
  user_id text not null,
  name text not null,
  code text not null,
  role text not null,
  attendance_date date not null,
  time text not null,
  status text not null default 'Hadir',
  image text not null default '',
  created_at timestamptz not null default now()
);

create index if not exists attendance_logs_date_idx
  on public.attendance_logs (attendance_date desc);
create unique index if not exists attendance_logs_one_per_user_day_idx
  on public.attendance_logs (user_id, attendance_date);

create table if not exists public.app_admins (
  user_id uuid primary key references auth.users (id) on delete cascade,
  created_at timestamptz not null default now()
);

alter table public.app_admins enable row level security;
alter table public.face_users enable row level security;
alter table public.attendance_logs enable row level security;

grant select on public.app_admins to authenticated;
grant select, insert, update, delete on public.face_users to authenticated;
grant select, insert, update, delete on public.attendance_logs to authenticated;

drop policy if exists "Admins can verify their own access" on public.app_admins;
create policy "Admins can verify their own access"
  on public.app_admins for select to authenticated
  using (user_id = (select auth.uid()));

drop policy if exists "Authenticated users manage face users" on public.face_users;
create policy "Authenticated users manage face users"
  on public.face_users for all to authenticated
  using (exists (select 1 from public.app_admins where user_id = (select auth.uid())))
  with check (exists (select 1 from public.app_admins where user_id = (select auth.uid())));

drop policy if exists "Authenticated users manage attendance logs" on public.attendance_logs;
create policy "Authenticated users manage attendance logs"
  on public.attendance_logs for all to authenticated
  using (exists (select 1 from public.app_admins where user_id = (select auth.uid())))
  with check (exists (select 1 from public.app_admins where user_id = (select auth.uid())));
