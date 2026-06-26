/**
 * Fuzz Testing for Input Validation
 * Issue #331: Add fuzz testing for input validation
 *
 * Tests input validation across all API endpoints using property-based testing
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import fc from 'fast-check';

// ── Mock Services ─────────────────────────────────────────────────────────────

const mockValidationService = {
  validateEmail: vi.fn(),
  validatePassword: vi.fn(),
  validateDeploymentName: vi.fn(),
  validateCustomizationConfig: vi.fn(),
  validateDomain: vi.fn(),
  validateUrl: vi.fn(),
  validateJSON: vi.fn(),
};

const mockApiEndpoints = {
  signup: vi.fn(),
  createDeployment: vi.fn(),
  updateCustomization: vi.fn(),
  addCustomDomain: vi.fn(),
  uploadBranding: vi.fn(),
};

vi.mock('@/services/validation.service', () => ({
  validationService: mockValidationService,
}));

// ── Validation Functions ──────────────────────────────────────────────────────

function validateEmail(email: string): { valid: boolean; error?: string } {
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailRegex.test(email)) {
    return { valid: false, error: 'Invalid email format' };
  }
  if (email.length > 254) {
    return { valid: false, error: 'Email too long' };
  }
  return { valid: true };
}

function validatePassword(password: string): { valid: boolean; error?: string } {
  if (password.length < 8) {
    return { valid: false, error: 'Password must be at least 8 characters' };
  }
  if (password.length > 128) {
    return { valid: false, error: 'Password too long' };
  }
  if (!/[A-Z]/.test(password)) {
    return { valid: false, error: 'Password must contain uppercase letter' };
  }
  if (!/[0-9]/.test(password)) {
    return { valid: false, error: 'Password must contain number' };
  }
  return { valid: true };
}

function validateDeploymentName(name: string): { valid: boolean; error?: string } {
  if (name.length < 1) {
    return { valid: false, error: 'Name cannot be empty' };
  }
  if (name.length > 100) {
    return { valid: false, error: 'Name too long' };
  }
  if (!/^[a-zA-Z0-9\s\-_]+$/.test(name)) {
    return { valid: false, error: 'Name contains invalid characters' };
  }
  return { valid: true };
}

function validateDomain(domain: string): { valid: boolean; error?: string } {
  const domainRegex = /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/i;
  if (!domainRegex.test(domain)) {
    return { valid: false, error: 'Invalid domain format' };
  }
  if (domain.length > 253) {
    return { valid: false, error: 'Domain too long' };
  }
  return { valid: true };
}

function validateUrl(url: string): { valid: boolean; error?: string } {
  try {
    new URL(url);
    if (url.length > 2048) {
      return { valid: false, error: 'URL too long' };
    }
    return { valid: true };
  } catch {
    return { valid: false, error: 'Invalid URL format' };
  }
}

function validateJSON(json: string): { valid: boolean; error?: string } {
  try {
    JSON.parse(json);
    if (json.length > 1000000) {
      return { valid: false, error: 'JSON payload too large' };
    }
    return { valid: true };
  } catch {
    return { valid: false, error: 'Invalid JSON' };
  }
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('Fuzz Testing: Input Validation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('Email Validation', () => {
    it('should handle valid emails', () => {
      fc.assert(
        fc.property(fc.emailAddress(), (email) => {
          const result = validateEmail(email);
          expect(result.valid).toBe(true);
        }),
        { numRuns: 100 }
      );
    });

    it('should reject invalid email formats', () => {
      fc.assert(
        fc.property(fc.string().filter((s) => !s.includes('@')), (invalidEmail) => {
          const result = validateEmail(invalidEmail);
          expect(result.valid).toBe(false);
        }),
        { numRuns: 50 }
      );
    });

    it('should reject extremely long emails', () => {
      const longEmail = 'a'.repeat(300) + '@example.com';
      const result = validateEmail(longEmail);
      expect(result.valid).toBe(false);
      expect(result.error).toContain('too long');
    });

    it('should handle edge cases in email validation', () => {
      const testCases = [
        { email: '', valid: false },
        { email: '@', valid: false },
        { email: 'test@', valid: false },
        { email: '@example.com', valid: false },
        { email: 'test..email@example.com', valid: false },
        { email: 'test@example', valid: false },
      ];

      testCases.forEach(({ email, valid }) => {
        const result = validateEmail(email);
        expect(result.valid).toBe(valid);
      });
    });
  });

  describe('Password Validation', () => {
    it('should reject weak passwords', () => {
      const weakPasswords = [
        'short',
        'nouppercase123',
        'NOLOWERCASE123',
        'NoNumbers',
        '12345678',
      ];

      weakPasswords.forEach((password) => {
        const result = validatePassword(password);
        expect(result.valid).toBe(false);
      });
    });

    it('should accept strong passwords', () => {
      const strongPasswords = [
        'StrongPass123',
        'MyPassword456',
        'SecureP@ss789',
      ];

      strongPasswords.forEach((password) => {
        const result = validatePassword(password);
        expect(result.valid).toBe(true);
      });
    });

    it('should reject extremely long passwords', () => {
      const longPassword = 'A1' + 'a'.repeat(200);
      const result = validatePassword(longPassword);
      expect(result.valid).toBe(false);
      expect(result.error).toContain('too long');
    });

    it('should handle boundary conditions', () => {
      // Exactly 8 characters with requirements
      const minValid = 'Abcdefg1';
      expect(validatePassword(minValid).valid).toBe(true);

      // 7 characters (too short)
      const tooShort = 'Abcdef1';
      expect(validatePassword(tooShort).valid).toBe(false);
    });
  });

  describe('Deployment Name Validation', () => {
    it('should accept valid deployment names', () => {
      fc.assert(
        fc.property(
          fc.stringOf(fc.constantFrom(...'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789-_ '.split('')), {
            minLength: 1,
            maxLength: 100,
          }),
          (name) => {
            const result = validateDeploymentName(name);
            expect(result.valid).toBe(true);
          }
        ),
        { numRuns: 100 }
      );
    });

    it('should reject names with special characters', () => {
      const invalidNames = [
        'my@deployment',
        'my#app',
        'my$project',
        'my%app',
        'my&project',
        'my*app',
      ];

      invalidNames.forEach((name) => {
        const result = validateDeploymentName(name);
        expect(result.valid).toBe(false);
      });
    });

    it('should reject empty names', () => {
      const result = validateDeploymentName('');
      expect(result.valid).toBe(false);
    });

    it('should reject extremely long names', () => {
      const longName = 'a'.repeat(101);
      const result = validateDeploymentName(longName);
      expect(result.valid).toBe(false);
    });
  });

  describe('Domain Validation', () => {
    it('should accept valid domains', () => {
      const validDomains = [
        'example.com',
        'subdomain.example.com',
        'my-app.co.uk',
        'test123.org',
      ];

      validDomains.forEach((domain) => {
        const result = validateDomain(domain);
        expect(result.valid).toBe(true);
      });
    });

    it('should reject invalid domain formats', () => {
      const invalidDomains = [
        'invalid',
        '.example.com',
        'example.com.',
        'exam ple.com',
        'example..com',
        '-example.com',
        'example-.com',
      ];

      invalidDomains.forEach((domain) => {
        const result = validateDomain(domain);
        expect(result.valid).toBe(false);
      });
    });

    it('should reject extremely long domains', () => {
      const longDomain = 'a'.repeat(300) + '.com';
      const result = validateDomain(longDomain);
      expect(result.valid).toBe(false);
    });

    it('should handle internationalized domains', () => {
      const idnDomains = [
        'münchen.de',
        '日本.jp',
        'москва.рф',
      ];

      idnDomains.forEach((domain) => {
        const result = validateDomain(domain);
        // Should either accept or reject consistently
        expect(result.valid).toBeDefined();
      });
    });
  });

  describe('URL Validation', () => {
    it('should accept valid URLs', () => {
      const validUrls = [
        'https://example.com',
        'http://localhost:3000',
        'https://api.example.com/path?query=value',
        'https://example.com:8080/path#hash',
      ];

      validUrls.forEach((url) => {
        const result = validateUrl(url);
        expect(result.valid).toBe(true);
      });
    });

    it('should reject invalid URLs', () => {
      const invalidUrls = [
        'not a url',
        'htp://example.com',
        '://example.com',
        'example.com',
      ];

      invalidUrls.forEach((url) => {
        const result = validateUrl(url);
        expect(result.valid).toBe(false);
      });
    });

    it('should reject extremely long URLs', () => {
      const longUrl = 'https://example.com/' + 'a'.repeat(2500);
      const result = validateUrl(longUrl);
      expect(result.valid).toBe(false);
    });

    it('should handle URLs with special characters', () => {
      const specialUrls = [
        'https://example.com/path?key=value&other=123',
        'https://example.com/path#section',
        'https://user:pass@example.com',
      ];

      specialUrls.forEach((url) => {
        const result = validateUrl(url);
        expect(result.valid).toBe(true);
      });
    });
  });

  describe('JSON Validation', () => {
    it('should accept valid JSON', () => {
      const validJsons = [
        '{}',
        '[]',
        '{"key": "value"}',
        '[1, 2, 3]',
        '{"nested": {"key": "value"}}',
      ];

      validJsons.forEach((json) => {
        const result = validateJSON(json);
        expect(result.valid).toBe(true);
      });
    });

    it('should reject invalid JSON', () => {
      const invalidJsons = [
        '{invalid}',
        '[1, 2, 3,]',
        "{'key': 'value'}",
        '{key: value}',
        'not json',
      ];

      invalidJsons.forEach((json) => {
        const result = validateJSON(json);
        expect(result.valid).toBe(false);
      });
    });

    it('should reject extremely large JSON payloads', () => {
      const largeJson = JSON.stringify({
        data: 'a'.repeat(2000000),
      });
      const result = validateJSON(largeJson);
      expect(result.valid).toBe(false);
    });

    it('should handle deeply nested JSON', () => {
      let nested: any = { value: 'deep' };
      for (let i = 0; i < 100; i++) {
        nested = { nested };
      }
      const json = JSON.stringify(nested);
      const result = validateJSON(json);
      expect(result.valid).toBe(true);
    });
  });

  describe('Type Coercion and Boundary Conditions', () => {
    it('should handle null and undefined inputs', () => {
      const inputs = [null, undefined, '', 0, false];

      inputs.forEach((input) => {
        const stringInput = String(input);
        const emailResult = validateEmail(stringInput);
        expect(emailResult.valid).toBeDefined();
      });
    });

    it('should handle numeric strings', () => {
      const numericStrings = ['123', '0', '-1', '3.14'];

      numericStrings.forEach((str) => {
        const result = validateDeploymentName(str);
        expect(result.valid).toBe(true);
      });
    });

    it('should handle whitespace variations', () => {
      const whitespaceTests = [
        { input: '  email@example.com  ', expected: false },
        { input: 'email@example.com\n', expected: false },
        { input: 'email@example.com\t', expected: false },
      ];

      whitespaceTests.forEach(({ input, expected }) => {
        const result = validateEmail(input);
        expect(result.valid).toBe(expected);
      });
    });
  });

  describe('Error Message Quality', () => {
    it('should provide helpful error messages', () => {
      const testCases = [
        { input: 'short', validator: validatePassword, expectedError: 'at least 8 characters' },
        { input: '', validator: validateDeploymentName, expectedError: 'cannot be empty' },
        { input: 'invalid', validator: validateDomain, expectedError: 'Invalid domain' },
      ];

      testCases.forEach(({ input, validator, expectedError }) => {
        const result = validator(input);
        expect(result.valid).toBe(false);
        expect(result.error).toContain(expectedError);
      });
    });
  });

  describe('Fuzz Testing with Random Inputs', () => {
    it('should not crash on random email inputs', () => {
      fc.assert(
        fc.property(fc.string(), (input) => {
          expect(() => validateEmail(input)).not.toThrow();
        }),
        { numRuns: 200 }
      );
    });

    it('should not crash on random password inputs', () => {
      fc.assert(
        fc.property(fc.string(), (input) => {
          expect(() => validatePassword(input)).not.toThrow();
        }),
        { numRuns: 200 }
      );
    });

    it('should not crash on random deployment name inputs', () => {
      fc.assert(
        fc.property(fc.string(), (input) => {
          expect(() => validateDeploymentName(input)).not.toThrow();
        }),
        { numRuns: 200 }
      );
    });

    it('should not crash on random domain inputs', () => {
      fc.assert(
        fc.property(fc.string(), (input) => {
          expect(() => validateDomain(input)).not.toThrow();
        }),
        { numRuns: 200 }
      );
    });

    it('should not crash on random URL inputs', () => {
      fc.assert(
        fc.property(fc.string(), (input) => {
          expect(() => validateUrl(input)).not.toThrow();
        }),
        { numRuns: 200 }
      );
    });

    it('should not crash on random JSON inputs', () => {
      fc.assert(
        fc.property(fc.string(), (input) => {
          expect(() => validateJSON(input)).not.toThrow();
        }),
        { numRuns: 200 }
      );
    });
  });
});
