import { Injectable } from '@nestjs/common';
import { createTransport } from 'nodemailer';
import { Configuration } from '../../config/environment.js';
import { ApiError } from '../../common/exceptions/api-error.js';
/** Replace in tests through dependency injection; never expose inbox/debug routes. */
@Injectable()
export class DeliveryService {
  constructor(private readonly config: Configuration) {}
  requireEmail() {
    if (this.config.values.EMAIL_PROVIDER === 'disabled')
      throw new ApiError(503, 'EMAIL_UNAVAILABLE', 'Email delivery is not configured.');
  }
  requireSms() {
    if (this.config.values.SMS_PROVIDER === 'disabled')
      throw new ApiError(
        503,
        'SMS_UNAVAILABLE',
        'SMS delivery is not configured. Choose an authenticator app.',
      );
  }
  async email(
    to: string,
    purpose: 'verify-email' | 'reset-password',
    token: string,
  ): Promise<void> {
    this.requireEmail();
    const env = this.config.values;
    const transport = createTransport({
      host: env.SMTP_HOST,
      port: env.SMTP_PORT,
      secure: env.SMTP_SECURE,
      requireTLS: this.config.secureCookies && !env.SMTP_SECURE,
      connectionTimeout: 5000,
      socketTimeout: 10000,
      auth: env.SMTP_USER ? { user: env.SMTP_USER, pass: env.SMTP_PASSWORD } : undefined,
      logger: false,
      debug: false,
    });
    try {
      await transport.sendMail({
        from: env.EMAIL_FROM,
        to,
        subject:
          purpose === 'verify-email'
            ? 'Verify your Xelen Commerce email'
            : 'Reset your Xelen Commerce password',
        text: `Continue securely: ${env.FRONTEND_URL.replace(/\/$/, '')}/${purpose}?token=${encodeURIComponent(token)}\n\nIf you did not request this, ignore this message.`,
      });
    } catch {
      throw new ApiError(503, 'EMAIL_UNAVAILABLE', 'Email delivery is temporarily unavailable.');
    } finally {
      transport.close();
    }
  }
  async sms(to: string, code: string): Promise<void> {
    this.requireSms();
    const env = this.config.values;
    const body = new URLSearchParams({
      To: to,
      From: env.TWILIO_FROM,
      Body: `Xelen Commerce verification code: ${code}. Expires in 5 minutes. Do not share this code.`,
    });
    try {
      const response = await fetch(
        `https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(env.TWILIO_ACCOUNT_SID)}/Messages.json`,
        {
          method: 'POST',
          headers: {
            Authorization: `Basic ${Buffer.from(`${env.TWILIO_ACCOUNT_SID}:${env.TWILIO_AUTH_TOKEN}`).toString('base64')}`,
            'Content-Type': 'application/x-www-form-urlencoded',
          },
          body,
          signal: AbortSignal.timeout(10000),
          redirect: 'error',
        },
      );
      if (!response.ok) throw new Error();
    } catch {
      throw new ApiError(503, 'SMS_UNAVAILABLE', 'SMS delivery is temporarily unavailable.');
    }
  }
}
