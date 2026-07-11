import { betterAuth } from 'better-auth';
import type { BetterAuthOptions } from 'better-auth';
import { admin } from 'better-auth/plugins/admin';
import { magicLink } from 'better-auth/plugins/magic-link';
import { organization } from 'better-auth/plugins/organization';
import { PostgresDialect } from 'kysely';
import type { AppConfig } from '../core/types.js';
import type { PgPool } from '../db/db.js';
import { Mailer } from './mailer.js';

export const BETTER_AUTH_BASE_PATH = '/api/better-auth';

/**
 * Builds the future better-auth configuration for the product auth layer.
 *
 * The current v1 routes still use the compatibility AuthService in auth.ts so
 * existing smoke tests and dev magic links keep working while the better-auth
 * database schema and admin/org roles are introduced.
 */
export function createBetterAuthOptions(config: AppConfig, pool: PgPool | null): BetterAuthOptions {
  const mailer = new Mailer(config);
  return {
    appName: 'Deckhand',
    baseURL: config.auth.betterAuthUrl ?? config.publicBaseUrl,
    basePath: BETTER_AUTH_BASE_PATH,
    secret: config.auth.betterAuthSecret,
    database: pool
      ? {
          dialect: new PostgresDialect({ pool }),
          type: 'postgres',
          casing: 'camel',
          transaction: true,
        }
      : undefined,
    emailAndPassword: {
      enabled: true,
      disableSignUp: true,
      requireEmailVerification: true,
    },
    emailVerification: {
      sendOnSignUp: true,
      sendOnSignIn: true,
      expiresIn: config.auth.tokenMinutes * 60,
    },
    session: {
      expiresIn: config.auth.sessionDays * 24 * 60 * 60,
      updateAge: 24 * 60 * 60,
    },
    plugins: [
      magicLink({
        expiresIn: config.auth.tokenMinutes * 60,
        disableSignUp: true,
        storeToken: 'hashed',
        async sendMagicLink({ email, url }) {
          const result = await mailer.send({
            to: email,
            subject: 'Sign in to Deckhand',
            text: `Use this one-time link to sign in: ${url}`,
            html: `<p>Use this one-time link to sign in:</p><p><a href="${escapeHtml(url)}">${escapeHtml(url)}</a></p>`,
          });
          if (!result.sent) {
            console.info(`better-auth magic link for ${email}: ${url}`);
          }
        },
      }),
      organization({
        allowUserToCreateOrganization: false,
      }),
      admin({
        defaultRole: 'user',
        adminRoles: ['admin'],
      }),
    ],
  };
}

/**
 * Creates a better-auth instance for the production auth layer.
 */
export function createBetterAuth(config: AppConfig, pool: PgPool) {
  return betterAuth(createBetterAuthOptions(config, pool));
}

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}
