// @ts-check
import { createAuthClient } from 'better-auth/client';
import { magicLinkClient } from 'better-auth/client/plugins';

export const betterAuthClient = createAuthClient({
  basePath: '/api/better-auth',
  plugins: [magicLinkClient()],
});

export async function getBetterAuthSession() {
  const result = await betterAuthClient.getSession();
  return result?.data ?? result ?? null;
}

export async function requestBetterAuthMagicLink(email) {
  const result = await betterAuthClient.signIn.magicLink({
    email,
    callbackURL: '/',
    errorCallbackURL: '/',
  });
  if (result?.error) throw new Error(result.error.message ?? 'Sign-in failed.');
  return { sent: true, betterAuth: true };
}

export async function betterAuthSignOut() {
  await betterAuthClient.signOut().catch(() => null);
}
