-- Generated from better-auth 1.6.x metadata with magic-link/organization/admin plugins.

-- Run `npm run auth:schema` after changing better-auth plugins or auth schema options.

create table if not exists "user" (
  id text primary key,
  "name" text not null,
  "email" text not null unique,
  "emailVerified" boolean not null,
  "image" text,
  "createdAt" timestamptz not null default CURRENT_TIMESTAMP,
  "updatedAt" timestamptz not null default CURRENT_TIMESTAMP,
  "role" text,
  "banned" boolean,
  "banReason" text,
  "banExpires" timestamptz
);

create table if not exists "session" (
  id text primary key,
  "expiresAt" timestamptz not null,
  "token" text not null unique,
  "createdAt" timestamptz not null default CURRENT_TIMESTAMP,
  "updatedAt" timestamptz not null,
  "ipAddress" text,
  "userAgent" text,
  "userId" text not null references "user" ("id") on delete cascade,
  "activeOrganizationId" text,
  "impersonatedBy" text
);

create table if not exists "account" (
  id text primary key,
  "accountId" text not null,
  "providerId" text not null,
  "userId" text not null references "user" ("id") on delete cascade,
  "accessToken" text,
  "refreshToken" text,
  "idToken" text,
  "accessTokenExpiresAt" timestamptz,
  "refreshTokenExpiresAt" timestamptz,
  "scope" text,
  "password" text,
  "createdAt" timestamptz not null default CURRENT_TIMESTAMP,
  "updatedAt" timestamptz not null
);

create table if not exists "verification" (
  id text primary key,
  "identifier" text not null,
  "value" text not null,
  "expiresAt" timestamptz not null,
  "createdAt" timestamptz not null default CURRENT_TIMESTAMP,
  "updatedAt" timestamptz not null default CURRENT_TIMESTAMP
);

create table if not exists "organization" (
  id text primary key,
  "name" text not null,
  "slug" text not null unique,
  "logo" text,
  "createdAt" timestamptz not null,
  "metadata" text
);

create table if not exists "member" (
  id text primary key,
  "organizationId" text not null references "organization" ("id") on delete cascade,
  "userId" text not null references "user" ("id") on delete cascade,
  "role" text not null,
  "createdAt" timestamptz not null
);

create table if not exists "invitation" (
  id text primary key,
  "organizationId" text not null references "organization" ("id") on delete cascade,
  "email" text not null,
  "role" text,
  "status" text not null,
  "expiresAt" timestamptz not null,
  "createdAt" timestamptz not null default CURRENT_TIMESTAMP,
  "inviterId" text not null references "user" ("id") on delete cascade
);

create index if not exists "session_userId_idx" on "session" ("userId");

create index if not exists "account_userId_idx" on "account" ("userId");

create index if not exists "verification_identifier_idx" on "verification" ("identifier");

create unique index if not exists "organization_slug_uidx" on "organization" ("slug");

create index if not exists "member_organizationId_idx" on "member" ("organizationId");

create index if not exists "member_userId_idx" on "member" ("userId");

create index if not exists "invitation_organizationId_idx" on "invitation" ("organizationId");

create index if not exists "invitation_email_idx" on "invitation" ("email");
