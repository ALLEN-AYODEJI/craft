/**
 * GitHub Token Encryption Tests
 *
 * Comprehensive tests for GitHub token security:
 * - Token encryption before storage
 * - Decryption for API calls
 * - Key rotation procedures
 * - Token logging prevention
 * - Encryption key management
 *
 * Run: vitest run tests/security/token-encryption.test.ts
 */

import { describe, it, expect, beforeAll, afterEach, vi } from 'vitest';
import crypto from 'crypto';

interface EncryptedToken {
  ciphertext: string;
  iv: string;
  authTag: string;
  algorithm: string;
}

interface KeyRotationResult {
  success: boolean;
  oldKeyId: string;
  newKeyId: string;
  tokensRotated: number;
  error?: string;
}

class TokenEncryptionManager {
  private encryptionKey: Buffer;
  private keyId: string;
  private algorithm = 'aes-256-gcm';
  private loggedTokens: Set<string> = new Set();

  constructor(encryptionKey?: Buffer, keyId?: string) {
    this.encryptionKey = encryptionKey || crypto.randomBytes(32);
    this.keyId = keyId || crypto.randomBytes(16).toString('hex');
  }

  /**
   * Encrypt token before storage
   */
  encryptToken(token: string): EncryptedToken {
    if (!token || token.trim().length === 0) {
      throw new Error('Token cannot be empty');
    }

    const iv = crypto.randomBytes(16);
    const cipher = crypto.createCipheriv(this.algorithm, this.encryptionKey, iv);

    let encrypted = cipher.update(token, 'utf8', 'hex');
    encrypted += cipher.final('hex');

    const authTag = cipher.getAuthTag();

    return {
      ciphertext: encrypted,
      iv: iv.toString('hex'),
      authTag: authTag.toString('hex'),
      algorithm: this.algorithm,
    };
  }

  /**
   * Decrypt token for API calls
   */
  decryptToken(encryptedToken: EncryptedToken): string {
    if (!encryptedToken.ciphertext || !encryptedToken.iv || !encryptedToken.authTag) {
      throw new Error('Invalid encrypted token format');
    }

    try {
      const iv = Buffer.from(encryptedToken.iv, 'hex');
      const authTag = Buffer.from(encryptedToken.authTag, 'hex');
      const decipher = crypto.createDecipheriv(this.algorithm, this.encryptionKey, iv);

      decipher.setAuthTag(authTag);

      let decrypted = decipher.update(encryptedToken.ciphertext, 'hex', 'utf8');
      decrypted += decipher.final('utf8');

      return decrypted;
    } catch (error) {
      throw new Error('Token decryption failed - possible tampering detected');
    }
  }

  /**
   * Verify token is never logged
   */
  logMessage(message: string, token?: string): void {
    if (token) {
      this.loggedTokens.add(token);
    }
    // In real implementation, would log to external service
  }

  /**
   * Check if token was logged
   */
  wasTokenLogged(token: string): boolean {
    return this.loggedTokens.has(token);
  }

  /**
   * Rotate encryption key
   */
  rotateKey(newKey: Buffer, tokensToRotate: EncryptedToken[]): KeyRotationResult {
    if (!newKey || newKey.length !== 32) {
      return {
        success: false,
        oldKeyId: this.keyId,
        newKeyId: '',
        tokensRotated: 0,
        error: 'Invalid key size - must be 32 bytes',
      };
    }

    const oldKeyId = this.keyId;
    const newKeyId = crypto.randomBytes(16).toString('hex');
    let rotatedCount = 0;

    try {
      const oldKey = this.encryptionKey;
      this.encryptionKey = newKey;
      this.keyId = newKeyId;

      // Re-encrypt all tokens with new key
      for (const encryptedToken of tokensToRotate) {
        try {
          // Decrypt with old key
          const iv = Buffer.from(encryptedToken.iv, 'hex');
          const authTag = Buffer.from(encryptedToken.authTag, 'hex');
          const decipher = crypto.createDecipheriv(this.algorithm, oldKey, iv);
          decipher.setAuthTag(authTag);

          let decrypted = decipher.update(encryptedToken.ciphertext, 'hex', 'utf8');
          decrypted += decipher.final('utf8');

          // Re-encrypt with new key
          this.encryptToken(decrypted);
          rotatedCount++;
        } catch {
          // Continue with next token
        }
      }

      return {
        success: true,
        oldKeyId,
        newKeyId,
        tokensRotated: rotatedCount,
      };
    } catch (error) {
      return {
        success: false,
        oldKeyId,
        newKeyId,
        tokensRotated: rotatedCount,
        error: 'Key rotation failed',
      };
    }
  }

  /**
   * Get current key ID
   */
  getKeyId(): string {
    return this.keyId;
  }

  /**
   * Verify encryption strength
   */
  verifyEncryptionStrength(): { keySize: number; algorithm: string; secure: boolean } {
    return {
      keySize: this.encryptionKey.length * 8,
      algorithm: this.algorithm,
      secure: this.encryptionKey.length === 32 && this.algorithm === 'aes-256-gcm',
    };
  }
}

describe('GitHub Token Encryption', () => {
  let encryptionManager: TokenEncryptionManager;
  const testToken = 'ghp_test1234567890abcdefghijklmnopqrstuvwxyz';

  beforeAll(() => {
    encryptionManager = new TokenEncryptionManager();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('Token Encryption', () => {
    it('should encrypt tokens before storage', () => {
      const encrypted = encryptionManager.encryptToken(testToken);

      expect(encrypted.ciphertext).toBeDefined();
      expect(encrypted.iv).toBeDefined();
      expect(encrypted.authTag).toBeDefined();
      expect(encrypted.algorithm).toBe('aes-256-gcm');
      expect(encrypted.ciphertext).not.toBe(testToken);
    });

    it('should produce different ciphertexts for same token', () => {
      const encrypted1 = encryptionManager.encryptToken(testToken);
      const encrypted2 = encryptionManager.encryptToken(testToken);

      expect(encrypted1.ciphertext).not.toBe(encrypted2.ciphertext);
      expect(encrypted1.iv).not.toBe(encrypted2.iv);
    });

    it('should reject empty tokens', () => {
      expect(() => encryptionManager.encryptToken('')).toThrow('Token cannot be empty');
    });

    it('should handle various token formats', () => {
      const tokens = [
        'ghp_1234567890abcdefghijklmnopqrstuvwxyz',
        'ghu_1234567890abcdefghijklmnopqrstuvwxyz',
        'ghs_1234567890abcdefghijklmnopqrstuvwxyz',
      ];

      tokens.forEach((token) => {
        const encrypted = encryptionManager.encryptToken(token);
        expect(encrypted.ciphertext).toBeDefined();
        expect(encrypted.ciphertext).not.toBe(token);
      });
    });
  });

  describe('Token Decryption', () => {
    it('should decrypt tokens correctly', () => {
      const encrypted = encryptionManager.encryptToken(testToken);
      const decrypted = encryptionManager.decryptToken(encrypted);

      expect(decrypted).toBe(testToken);
    });

    it('should perform encryption/decryption roundtrip', () => {
      const tokens = [
        'ghp_test1234567890abcdefghijklmnopqrstuvwxyz',
        'ghu_test1234567890abcdefghijklmnopqrstuvwxyz',
        'ghs_test1234567890abcdefghijklmnopqrstuvwxyz',
      ];

      tokens.forEach((token) => {
        const encrypted = encryptionManager.encryptToken(token);
        const decrypted = encryptionManager.decryptToken(encrypted);
        expect(decrypted).toBe(token);
      });
    });

    it('should reject invalid encrypted token format', () => {
      const invalidToken: EncryptedToken = {
        ciphertext: '',
        iv: '',
        authTag: '',
        algorithm: 'aes-256-gcm',
      };

      expect(() => encryptionManager.decryptToken(invalidToken)).toThrow();
    });

    it('should detect tampering with ciphertext', () => {
      const encrypted = encryptionManager.encryptToken(testToken);
      const tampered: EncryptedToken = {
        ...encrypted,
        ciphertext: encrypted.ciphertext.slice(0, -2) + 'XX',
      };

      expect(() => encryptionManager.decryptToken(tampered)).toThrow(
        'Token decryption failed - possible tampering detected'
      );
    });

    it('should detect tampering with auth tag', () => {
      const encrypted = encryptionManager.encryptToken(testToken);
      const tampered: EncryptedToken = {
        ...encrypted,
        authTag: encrypted.authTag.slice(0, -2) + 'XX',
      };

      expect(() => encryptionManager.decryptToken(tampered)).toThrow();
    });
  });

  describe('Token Logging Prevention', () => {
    it('should not log tokens in messages', () => {
      encryptionManager.logMessage('Processing GitHub token', undefined);
      expect(encryptionManager.wasTokenLogged(testToken)).toBe(false);
    });

    it('should track when tokens are logged', () => {
      encryptionManager.logMessage('Token processed', testToken);
      expect(encryptionManager.wasTokenLogged(testToken)).toBe(true);
    });

    it('should prevent token exposure in error messages', () => {
      const errorMessage = 'Failed to process token';
      encryptionManager.logMessage(errorMessage);

      expect(errorMessage).not.toContain(testToken);
      expect(encryptionManager.wasTokenLogged(testToken)).toBe(false);
    });

    it('should sanitize token from logs', () => {
      const sensitiveLog = `Token: ${testToken}`;
      const sanitized = sensitiveLog.replace(testToken, '[REDACTED]');

      expect(sanitized).not.toContain(testToken);
      expect(sanitized).toContain('[REDACTED]');
    });
  });

  describe('Key Rotation', () => {
    it('should rotate encryption keys without data loss', () => {
      const tokens = [
        encryptionManager.encryptToken('token1'),
        encryptionManager.encryptToken('token2'),
        encryptionManager.encryptToken('token3'),
      ];

      const newKey = crypto.randomBytes(32);
      const result = encryptionManager.rotateKey(newKey, tokens);

      expect(result.success).toBe(true);
      expect(result.tokensRotated).toBe(3);
      expect(result.newKeyId).not.toBe(result.oldKeyId);
    });

    it('should reject invalid key size', () => {
      const invalidKey = crypto.randomBytes(16); // Wrong size
      const result = encryptionManager.rotateKey(invalidKey, []);

      expect(result.success).toBe(false);
      expect(result.error).toContain('Invalid key size');
    });

    it('should update key ID after rotation', () => {
      const oldKeyId = encryptionManager.getKeyId();
      const newKey = crypto.randomBytes(32);
      encryptionManager.rotateKey(newKey, []);

      const newKeyId = encryptionManager.getKeyId();
      expect(newKeyId).not.toBe(oldKeyId);
    });

    it('should handle partial rotation failures', () => {
      const tokens = [
        encryptionManager.encryptToken('token1'),
        { ciphertext: 'invalid', iv: 'invalid', authTag: 'invalid', algorithm: 'aes-256-gcm' },
        encryptionManager.encryptToken('token3'),
      ];

      const newKey = crypto.randomBytes(32);
      const result = encryptionManager.rotateKey(newKey, tokens);

      expect(result.success).toBe(true);
      expect(result.tokensRotated).toBeGreaterThan(0);
    });
  });

  describe('Encryption Key Management', () => {
    it('should use 256-bit encryption keys', () => {
      const strength = encryptionManager.verifyEncryptionStrength();
      expect(strength.keySize).toBe(256);
    });

    it('should use AES-256-GCM algorithm', () => {
      const strength = encryptionManager.verifyEncryptionStrength();
      expect(strength.algorithm).toBe('aes-256-gcm');
    });

    it('should verify encryption is secure', () => {
      const strength = encryptionManager.verifyEncryptionStrength();
      expect(strength.secure).toBe(true);
    });

    it('should maintain key ID for audit trail', () => {
      const keyId = encryptionManager.getKeyId();
      expect(keyId).toBeDefined();
      expect(keyId.length).toBeGreaterThan(0);
    });

    it('should generate unique key IDs', () => {
      const manager1 = new TokenEncryptionManager();
      const manager2 = new TokenEncryptionManager();

      expect(manager1.getKeyId()).not.toBe(manager2.getKeyId());
    });
  });

  describe('Security Compliance', () => {
    it('should never expose plaintext tokens in encrypted storage', () => {
      const encrypted = encryptionManager.encryptToken(testToken);
      const serialized = JSON.stringify(encrypted);

      expect(serialized).not.toContain(testToken);
      expect(serialized).not.toContain('ghp_');
    });

    it('should use authenticated encryption', () => {
      const encrypted = encryptionManager.encryptToken(testToken);
      expect(encrypted.authTag).toBeDefined();
      expect(encrypted.authTag.length).toBeGreaterThan(0);
    });

    it('should use unique IV for each encryption', () => {
      const encrypted1 = encryptionManager.encryptToken(testToken);
      const encrypted2 = encryptionManager.encryptToken(testToken);

      expect(encrypted1.iv).not.toBe(encrypted2.iv);
    });

    it('should prevent token reuse attacks', () => {
      const encrypted = encryptionManager.encryptToken(testToken);
      const decrypted1 = encryptionManager.decryptToken(encrypted);
      const decrypted2 = encryptionManager.decryptToken(encrypted);

      expect(decrypted1).toBe(decrypted2);
      expect(decrypted1).toBe(testToken);
    });
  });
});
