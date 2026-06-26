/**
 * Adversarial JWT Input Corpus
 *
 * Pre-crafted malformed tokens covering known attack vectors:
 * - Algorithm confusion (RS256 vs HS256)
 * - None-algorithm attacks
 * - Expired tokens
 * - Signature stripping
 * - Header injection
 * - Payload tampering
 *
 * Reference: OWASP JWT Security Cheat Sheet
 * https://cheatsheetseries.owasp.org/cheatsheets/JSON_Web_Token_for_Java_Cheat_Sheet.html
 */

export const ADVERSARIAL_JWT_FIXTURES = {
  /**
   * Algorithm Confusion Attack: RS256 token signed with HS256
   * Attacker claims RS256 but signs with HS256 using public key as secret
   */
  algorithmConfusion: {
    token: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIiwibmFtZSI6IkpvaG4gRG9lIiwiaWF0IjoxNTE2MjM5MDIyfQ.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c',
    description: 'HS256 token claiming to be RS256',
    attackVector: 'Algorithm confusion - server may accept HS256 when expecting RS256',
  },

  /**
   * None Algorithm Attack: Token with "none" algorithm
   * Attacker removes signature and sets algorithm to "none"
   */
  noneAlgorithm: {
    token: 'eyJhbGciOiJub25lIiwidHlwIjoiSldUIn0.eyJzdWIiOiIxMjM0NTY3ODkwIiwibmFtZSI6IkpvaG4gRG9lIiwiaWF0IjoxNTE2MjM5MDIyfQ.',
    description: 'Token with "none" algorithm and no signature',
    attackVector: 'None algorithm - server may skip signature verification',
  },

  /**
   * Expired Token: Token with past expiration time
   */
  expiredToken: {
    token: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIiwibmFtZSI6IkpvaG4gRG9lIiwiZXhwIjoxNTE2MjM5MDIyfQ.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c',
    description: 'Token with exp claim in the past',
    attackVector: 'Expired token - should be rejected',
  },

  /**
   * Signature Stripping: Valid token with signature removed
   */
  signatureStripped: {
    token: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIiwibmFtZSI6IkpvaG4gRG9lIiwiaWF0IjoxNTE2MjM5MDIyfQ.',
    description: 'Token with signature removed (ends with .)',
    attackVector: 'Signature stripping - server must verify signature presence',
  },

  /**
   * Malformed Header: Invalid base64 in header
   */
  malformedHeader: {
    token: '!!!invalid!!!.eyJzdWIiOiIxMjM0NTY3ODkwIn0.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c',
    description: 'Invalid base64 in header section',
    attackVector: 'Malformed header - should fail parsing',
  },

  /**
   * Malformed Payload: Invalid base64 in payload
   */
  malformedPayload: {
    token: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.!!!invalid!!!.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c',
    description: 'Invalid base64 in payload section',
    attackVector: 'Malformed payload - should fail parsing',
  },

  /**
   * Payload Tampering: Modified payload with valid signature
   * (signature won't match but structure is valid)
   */
  payloadTampered: {
    token: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiJoYWNrZXIiLCJuYW1lIjoiRXZpbCBIYWNrZXIiLCJpYXQiOjE1MTYyMzkwMjJ9.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c',
    description: 'Payload modified but signature unchanged',
    attackVector: 'Payload tampering - signature verification should fail',
  },

  /**
   * Missing Dot Separator: Incomplete token structure
   */
  missingDotSeparator: {
    token: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9eyJzdWIiOiIxMjM0NTY3ODkwIn0SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c',
    description: 'Token missing dot separators',
    attackVector: 'Invalid structure - should fail parsing',
  },

  /**
   * Extra Dot Separator: Too many sections
   */
  extraDotSeparator: {
    token: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.extra.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c',
    description: 'Token with extra dot separator',
    attackVector: 'Invalid structure - should fail parsing',
  },

  /**
   * Empty Token: Completely empty string
   */
  emptyToken: {
    token: '',
    description: 'Empty token string',
    attackVector: 'Empty input - should fail parsing',
  },

  /**
   * Null Byte Injection: Token with null bytes
   */
  nullByteInjection: {
    token: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9\x00.eyJzdWIiOiIxMjM0NTY3ODkwIn0.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c',
    description: 'Token with null byte injection',
    attackVector: 'Null byte injection - should fail parsing',
  },

  /**
   * Unicode Normalization Attack: Token with unicode characters
   */
  unicodeNormalization: {
    token: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIiwibmFtZSI6IkpvaG4gRG9lIiwiaWF0IjoxNTE2MjM5MDIyfQ.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c™',
    description: 'Token with unicode characters appended',
    attackVector: 'Unicode normalization - should fail parsing',
  },

  /**
   * Very Long Token: Excessively long token to test buffer limits
   */
  veryLongToken: {
    token: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.' + 'A'.repeat(10000) + '.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c',
    description: 'Excessively long token payload',
    attackVector: 'Buffer overflow - should handle gracefully',
  },

  /**
   * Invalid JSON in Payload: Payload is not valid JSON
   */
  invalidJsonPayload: {
    token: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.aW52YWxpZCBqc29u.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c',
    description: 'Payload is not valid JSON',
    attackVector: 'Invalid JSON - should fail parsing',
  },

  /**
   * Whitespace in Token: Token with embedded whitespace
   */
  whitespaceInToken: {
    token: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9 . eyJzdWIiOiIxMjM0NTY3ODkwIn0 . SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c',
    description: 'Token with spaces around dots',
    attackVector: 'Whitespace - should fail parsing',
  },
};

/**
 * Helper to extract and decode JWT sections (for testing purposes only)
 * Do NOT use in production - always validate signatures
 */
export function decodeJwtUnsafe(token: string) {
  try {
    const parts = token.split('.');
    if (parts.length !== 3) {
      throw new Error('Invalid token structure');
    }

    const header = JSON.parse(Buffer.from(parts[0], 'base64').toString());
    const payload = JSON.parse(Buffer.from(parts[1], 'base64').toString());

    return { header, payload, signature: parts[2] };
  } catch (error) {
    throw new Error(`Failed to decode JWT: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }
}
