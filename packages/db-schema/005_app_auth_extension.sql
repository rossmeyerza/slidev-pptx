create table if not exists app_user_profile (
  user_id text primary key references "user"(id) on delete cascade,
  app_role text not null check (app_role in ('admin', 'employee')),
  status text not null check (status in ('invited', 'active', 'disabled')),
  last_login_at timestamptz null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists app_user_profile_app_role_idx on app_user_profile(app_role);
create index if not exists app_user_profile_status_idx on app_user_profile(status);

create table if not exists app_auth_token (
  id uuid primary key default gen_random_uuid(),
  token_hash text not null unique,
  email text not null,
  purpose text not null check (purpose in ('login', 'invite')),
  app_role text null check (app_role in ('admin', 'employee')),
  display_name text null,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  used_at timestamptz null,
  created_by_user_id text null
);

create index if not exists app_auth_token_email_idx on app_auth_token(email);
create index if not exists app_auth_token_token_hash_idx on app_auth_token(token_hash);
