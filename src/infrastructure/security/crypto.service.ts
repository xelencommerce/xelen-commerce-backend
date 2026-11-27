import { Injectable } from '@nestjs/common';
import {
  createCipheriv,
  createDecipheriv,
  createHmac,
  randomBytes,
  timingSafeEqual,
} from 'node:crypto';
import { Configuration } from '../../config/environment.js';
@Injectable()
export class CryptoService {
  constructor(private readonly config: Configuration) {}
  token(): string {
    return randomBytes(32).toString('base64url');
  }
  digest(domain: string, value: string): string {
    return createHmac('sha256', this.config.values.TOKEN_HASH_SECRET)
      .update(`${domain}\0${value}`)
      .digest('hex');
  }
  equal(left: string, right: string): boolean {
    const a = Buffer.from(left);
    const b = Buffer.from(right);
    return a.length === b.length && timingSafeEqual(a, b);
  }
  encrypt(value: string): string {
    const iv = randomBytes(12);
    const cipher = createCipheriv(
      'aes-256-gcm',
      Buffer.from(this.config.values.MFA_ENCRYPTION_KEY, 'base64'),
      iv,
    );
    const ciphertext = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
    return [
      'v1',
      iv.toString('base64url'),
      cipher.getAuthTag().toString('base64url'),
      ciphertext.toString('base64url'),
    ].join('.');
  }
  decrypt(value: string): string {
    const [version, iv, tag, encrypted] = value.split('.');
    if (version !== 'v1' || !iv || !tag || !encrypted)
      throw new Error('Invalid encrypted secret format.');
    const decipher = createDecipheriv(
      'aes-256-gcm',
      Buffer.from(this.config.values.MFA_ENCRYPTION_KEY, 'base64'),
      Buffer.from(iv, 'base64url'),
    );
    decipher.setAuthTag(Buffer.from(tag, 'base64url'));
    return Buffer.concat([
      decipher.update(Buffer.from(encrypted, 'base64url')),
      decipher.final(),
    ]).toString('utf8');
  }
  csrf(): string {
    const nonce = this.token();
    return `${nonce}.${this.digest('csrf', nonce)}`;
  }
  validCsrf(value: string): boolean {
    if (!/^[A-Za-z0-9_-]{43}\.[a-f0-9]{64}$/.test(value)) return false;
    const [nonce, signature] = value.split('.');
    return Boolean(nonce && signature && this.equal(signature, this.digest('csrf', nonce)));
  }
}
