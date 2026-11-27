import { Injectable } from '@nestjs/common';
import { z } from 'zod';
const secret = z.string().min(64);
const boolean = z.enum(['true', 'false']).transform((value) => value === 'true');
const schema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'staging', 'production']).default('development'),
    HOST: z.enum(['127.0.0.1', '0.0.0.0']).default('127.0.0.1'),
    PORT: z.coerce.number().int().min(1).max(65535).default(4000),
    API_PREFIX: z.literal('api/v1').default('api/v1'),
    DATABASE_URL: z
      .string()
      .url()
      .refine((value) => /^postgres(?:ql)?:\/\//.test(value)),
    DB_POOL_MAX: z.coerce.number().int().min(1).max(50).default(10),
    REDIS_URL: z.preprocess(
      (value) => (value === '' ? undefined : value),
      z.string().url().optional(),
    ),
    JWT_ACCESS_SECRET: secret,
    JWT_REFRESH_SECRET: secret,
    TOKEN_HASH_SECRET: secret,
    JWT_ACCESS_TTL: z.coerce.number().int().min(60).max(900).default(900),
    JWT_REFRESH_TTL: z.coerce.number().int().min(3600).max(604800).default(604800),
    JWT_REMEMBER_TTL: z.coerce.number().int().min(3600).max(2592000).default(2592000),
    JWT_ISSUER: z.string().min(1).default('xelen-commerce'),
    JWT_AUDIENCE: z.string().min(1).default('xelen-api'),
    MFA_ENCRYPTION_KEY: z
      .string()
      .refine(
        (value) => /^[A-Za-z0-9+/]{43}=$/.test(value) && Buffer.from(value, 'base64').length === 32,
        'Use a base64-encoded 32-byte key.',
      ),
    FRONTEND_URL: z.string().url().default('http://localhost:5173'),
    CORS_ORIGINS: z.string().min(1).default('http://localhost:5173'),
    COOKIE_SAME_SITE: z.enum(['strict', 'lax', 'none']).default('lax'),
    TRUST_PROXY_HOPS: z.coerce.number().int().min(0).max(2).default(0),
    DOCS_ENABLED: boolean.default(true),
    EMAIL_PROVIDER: z.enum(['disabled', 'smtp']).default('disabled'),
    EMAIL_FROM: z.email().default('security@localhost.test'),
    SMTP_HOST: z.string().default('127.0.0.1'),
    SMTP_PORT: z.coerce.number().int().min(1).max(65535).default(51025),
    SMTP_USER: z.string().default(''),
    SMTP_PASSWORD: z.string().default(''),
    SMTP_SECURE: boolean.default(false),
    SMS_PROVIDER: z.enum(['disabled', 'twilio']).default('disabled'),
    TWILIO_ACCOUNT_SID: z.string().default(''),
    TWILIO_AUTH_TOKEN: z.string().default(''),
    TWILIO_FROM: z.string().default(''),
  })
  .superRefine((env, context) => {
    const production = env.NODE_ENV === 'production' || env.NODE_ENV === 'staging';
    if (new Set([env.JWT_ACCESS_SECRET, env.JWT_REFRESH_SECRET, env.TOKEN_HASH_SECRET]).size !== 3)
      context.addIssue({
        code: 'custom',
        path: ['JWT_ACCESS_SECRET'],
        message: 'Use distinct secrets.',
      });
    for (const origin of env.CORS_ORIGINS.split(',').map((value) => value.trim())) {
      try {
        const url = new URL(origin);
        if (
          url.origin !== origin ||
          !['http:', 'https:'].includes(url.protocol) ||
          (production && url.protocol !== 'https:')
        )
          throw new Error();
      } catch {
        context.addIssue({
          code: 'custom',
          path: ['CORS_ORIGINS'],
          message: 'Use exact HTTP(S) origins; HTTPS is required outside local development.',
        });
      }
    }
    try {
      const url = new URL(env.FRONTEND_URL);
      if (url.origin !== env.FRONTEND_URL || !['http:', 'https:'].includes(url.protocol))
        throw new Error();
    } catch {
      context.addIssue({
        code: 'custom',
        path: ['FRONTEND_URL'],
        message: 'Use an exact frontend HTTP(S) origin without a path.',
      });
    }
    if (production && new URL(env.DATABASE_URL).searchParams.get('sslmode') !== 'verify-full')
      context.addIssue({
        code: 'custom',
        path: ['DATABASE_URL'],
        message: 'Staging/production require sslmode=verify-full with a trusted database CA.',
      });
    if (
      production &&
      (env.DOCS_ENABLED ||
        env.EMAIL_PROVIDER === 'disabled' ||
        !env.FRONTEND_URL.startsWith('https://'))
    )
      context.addIssue({
        code: 'custom',
        path: ['NODE_ENV'],
        message:
          'Staging/production require HTTPS, an email provider, and disabled public Swagger.',
      });
    if (env.COOKIE_SAME_SITE === 'none' && !production)
      context.addIssue({
        code: 'custom',
        path: ['COOKIE_SAME_SITE'],
        message: 'SameSite=None requires secure deployment.',
      });
    if (
      env.SMS_PROVIDER === 'twilio' &&
      (!env.TWILIO_ACCOUNT_SID || !env.TWILIO_AUTH_TOKEN || !env.TWILIO_FROM)
    )
      context.addIssue({
        code: 'custom',
        path: ['SMS_PROVIDER'],
        message: 'Configure all Twilio credentials before enabling SMS.',
      });
  });
export type Environment = z.infer<typeof schema>;
export function parseEnvironment(input: Record<string, unknown>): Environment {
  const parsed = schema.safeParse(input);
  if (!parsed.success)
    throw new Error(
      `Invalid environment: ${parsed.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`).join('; ')}`,
    );
  return parsed.data;
}
@Injectable()
export class Configuration {
  readonly values = parseEnvironment(process.env);
  get secureCookies(): boolean {
    return ['production', 'staging'].includes(this.values.NODE_ENV);
  }
  get corsOrigins(): string[] {
    return this.values.CORS_ORIGINS.split(',').map((value) => value.trim());
  }
  get refreshCookie(): string {
    return this.secureCookies ? '__Host-xelen_refresh' : 'xelen_refresh';
  }
  get csrfCookie(): string {
    return this.secureCookies ? '__Host-xelen_csrf' : 'xelen_csrf';
  }
}
