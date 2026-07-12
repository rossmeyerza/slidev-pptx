create extension if not exists pgcrypto;

create table if not exists org (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  slug text not null unique,
  created_at timestamptz not null default now()
);

create table if not exists deck (
  id text primary key,
  org_id uuid not null references org(id) on delete cascade,
  owner_user_id text not null,
  title text not null,
  slug text not null,
  scaffold_key text not null default 'commercial-html',
  visibility text not null default 'private' check (visibility in ('private', 'shared', 'published')),
  draft_url text not null,
  share_token text null,
  theme_id uuid null,
  status text not null check (status in ('draft', 'active', 'published', 'archived')),
  fs_path text not null,
  subdomain text not null unique,
  active_editor_user_id text null,
  published_build_path text null,
  publish_url text null,
  published_at timestamptz null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists deck_org_id_idx on deck(org_id);

create table if not exists deck_collaborator (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references org(id) on delete cascade,
  deck_id text not null references deck(id) on delete cascade,
  user_id text not null,
  role text not null check (role in ('editor', 'viewer')),
  created_at timestamptz not null default now(),
  unique(deck_id, user_id)
);

create index if not exists deck_collaborator_user_id_idx on deck_collaborator(user_id);

create table if not exists share_link (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references org(id) on delete cascade,
  deck_id text not null references deck(id) on delete cascade,
  token text not null unique,
  permission text not null check (permission in ('view', 'edit')),
  display_name text not null default 'Client',
  email text not null default '',
  password_hash text null,
  expires_at timestamptz null,
  created_by text not null,
  created_at timestamptz not null default now(),
  revoked_at timestamptz null
);

create index if not exists share_link_token_idx on share_link(token);

create table if not exists theme (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references org(id) on delete cascade,
  key text not null unique,
  name text not null,
  description text not null default '',
  source_path text not null,
  min_role text not null default 'member',
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

create table if not exists chat_thread (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references org(id) on delete cascade,
  deck_id text not null unique references deck(id) on delete cascade,
  langgraph_thread_id text not null,
  created_at timestamptz not null default now()
);

create table if not exists chat_message (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references org(id) on delete cascade,
  thread_id uuid not null references chat_thread(id) on delete cascade,
  role text not null check (role in ('user', 'assistant', 'tool', 'system')),
  content jsonb not null,
  author_user_id text null,
  created_at timestamptz not null default now()
);

create index if not exists chat_message_thread_created_idx on chat_message(thread_id, created_at);

create table if not exists agent_run (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references org(id) on delete cascade,
  deck_id text not null references deck(id) on delete cascade,
  thread_id uuid not null references chat_thread(id) on delete cascade,
  status text not null check (status in ('running', 'done', 'canceled', 'error')),
  model text not null,
  role_scope text not null,
  started_at timestamptz not null default now(),
  ended_at timestamptz null,
  error text null
);

create table if not exists deck_process (
  deck_id text primary key references deck(id) on delete cascade,
  pid int not null,
  port int not null,
  status text not null,
  last_activity_at timestamptz not null,
  started_at timestamptz not null default now()
);
