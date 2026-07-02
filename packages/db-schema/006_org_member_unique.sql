create unique index if not exists "member_organizationId_userId_uidx"
  on "member" ("organizationId", "userId");
