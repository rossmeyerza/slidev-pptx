import nodemailer from 'nodemailer';
import type { AppConfig } from '../core/types.js';

export interface MailMessage {
  to: string;
  subject: string;
  text: string;
  html?: string;
}

/**
 * Sends email through SMTP when configured. Without SMTP, it returns the message
 * details so local development can still complete auth flows.
 */
export class Mailer {
  constructor(private readonly config: AppConfig) {}

  async send(message: MailMessage): Promise<{ sent: boolean; devMessage?: MailMessage; deliveryError?: string }> {
    if (!this.config.smtp) {
      return { sent: false, devMessage: message };
    }

    const transport = nodemailer.createTransport({
      host: this.config.smtp.host,
      port: this.config.smtp.port,
      secure: this.config.smtp.secure,
      auth: this.config.smtp.user
        ? { user: this.config.smtp.user, pass: this.config.smtp.pass ?? '' }
        : undefined,
    });

    try {
      await transport.sendMail({
        from: this.config.smtp.from,
        to: message.to,
        subject: message.subject,
        text: message.text,
        html: message.html,
      });
    } catch (error) {
      return {
        sent: false,
        devMessage: message,
        deliveryError: error instanceof Error ? error.message : 'Email delivery failed',
      };
    }

    return { sent: true };
  }
}
