/** Encrypts stored calendar passwords with AES-256-GCM. The key comes from SECRET_KEY
 *  (base64, 32 bytes) or is generated once into the data folder as secret.key. */

import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

export class Secrets {
  private readonly key: Buffer;

  constructor(key: Buffer) {
    if (key.length !== 32) throw new Error('The secret key must be 32 bytes.');
    this.key = key;
  }

  static fromDataDir(dataDir: string): Secrets {
    if (process.env.SECRET_KEY) return new Secrets(Buffer.from(process.env.SECRET_KEY, 'base64'));
    const file = join(dataDir, 'secret.key');
    if (!existsSync(file)) writeFileSync(file, randomBytes(32).toString('base64'), { mode: 0o600 });
    return new Secrets(Buffer.from(readFileSync(file, 'utf8').trim(), 'base64'));
  }

  encrypt(plain: string): string {
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', this.key, iv);
    const data = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
    return `v1:${Buffer.concat([iv, cipher.getAuthTag(), data]).toString('base64')}`;
  }

  decrypt(stored: string): string {
    if (!stored.startsWith('v1:')) throw new Error('Unknown secret format.');
    const raw = Buffer.from(stored.slice(3), 'base64');
    const decipher = createDecipheriv('aes-256-gcm', this.key, raw.subarray(0, 12));
    decipher.setAuthTag(raw.subarray(12, 28));
    return Buffer.concat([decipher.update(raw.subarray(28)), decipher.final()]).toString('utf8');
  }
}
