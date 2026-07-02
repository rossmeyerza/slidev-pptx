alter table share_link
  add column if not exists display_name text not null default 'Client',
  add column if not exists email text not null default '';
