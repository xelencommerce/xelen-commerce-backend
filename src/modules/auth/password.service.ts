import { Injectable, type OnModuleInit } from '@nestjs/common';
import { hash, verify, argon2id } from 'argon2';
import { randomBytes } from 'node:crypto';
@Injectable()
export class PasswordService implements OnModuleInit {
  private dummy = '';
  async onModuleInit() {
    this.dummy = await this.hash(randomBytes(32).toString('base64url'));
  }
  hash(value: string): Promise<string> {
    return hash(value, { type: argon2id, memoryCost: 65536, timeCost: 3, parallelism: 1 });
  }
  async verify(encoded: string | null, value: string): Promise<boolean> {
    try {
      const matches = await verify(encoded ?? this.dummy, value);
      return encoded !== null && matches;
    } catch {
      return false;
    }
  }
}
