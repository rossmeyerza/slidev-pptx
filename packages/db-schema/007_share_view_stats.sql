alter table share_link add column if not exists view_count integer not null default 0;
alter table share_link add column if not exists last_viewed_at timestamptz;
