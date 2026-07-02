create table if not exists share_visitor (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references org(id) on delete cascade,
  share_link_id uuid not null references share_link(id) on delete cascade,
  display_name text not null,
  email text not null,
  created_at timestamptz not null default now()
);

create index if not exists share_visitor_share_link_id_idx on share_visitor(share_link_id);
create index if not exists share_visitor_email_idx on share_visitor(email);
