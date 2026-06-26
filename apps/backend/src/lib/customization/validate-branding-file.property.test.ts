// Feature: craft-platform, Property 10: File Upload Validation
import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';
import { validateBrandingFile } from './validate-branding-file';

// ── Constants (mirror the implementation) ────────────────────────────────────

const MAX_BYTES = 2 * 1024 * 1024; // 2 MB

const ALLOWED_MIME_TYPES = ['image/png', 'image/jpeg', 'image/svg+xml', 'image/webp'] as const;
type AllowedMime = (typeof ALLOWED_MIME_TYPES)[number];

// Magic byte headers for each binary format
const MAGIC: Record<string, number[]> = {
    'image/png':  [0x89, 0x50, 0x4e, 0x47],
    'image/jpeg': [0xff, 0xd8, 0xff],
    'image/webp': [0x52, 0x49, 0x46, 0x46],
};

// Canonical extension for each MIME type
const MIME_TO_EXT: Record<AllowedMime, string> = {
    'image/png':     'png',
    'image/jpeg':    'jpg',
    'image/svg+xml': 'svg',
    'image/webp':    'webp',
};

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Build a buffer with the correct magic bytes for a binary MIME type */
function magicBuffer(mime: string, extraBytes = 8): Uint8Array {
    const magic = MAGIC[mime] ?? [];
    const buf = new Uint8Array(magic.length + extraBytes);
    magic.forEach((b, i) => { buf[i] = b; });
    return buf;
}

/** Build a minimal safe SVG buffer */
function safeSvgBuffer(): Uint8Array {
    return new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg"><rect/></svg>');
}

/** Build a valid buffer for any allowed MIME type */
function validBuffer(mime: AllowedMime): Uint8Array {
    return mime === 'image/svg+xml' ? safeSvgBuffer() : magicBuffer(mime);
}

/** Build a filename with the canonical extension for a MIME type */
function validFilename(mime: AllowedMime): string {
    return `logo.${MIME_TO_EXT[mime]}`;
}

// ── Arbitraries ───────────────────────────────────────────────────────────────

const arbAllowedMime = fc.constantFrom(...ALLOWED_MIME_TYPES);

/** Disallowed MIME types — anything not in the allowlist */
const arbDisallowedMime = fc.string().filter(
    (s) => !(ALLOWED_MIME_TYPES as readonly string[]).includes(s)
);

/** File sizes within the 2 MB limit (1 byte – 2 MB inclusive) */
const arbValidSize = fc.integer({ min: 1, max: MAX_BYTES });

/** File sizes strictly over the 2 MB limit */
const arbOversizedBytes = fc.integer({ min: MAX_BYTES + 1, max: MAX_BYTES * 4 });

/** Garbage bytes that won't accidentally match any magic header */
const arbGarbage = fc.uint8Array({ minLength: 16, maxLength: 64 }).filter(
    (buf) =>
        !(buf[0] === 0x89 && buf[1] === 0x50) && // not PNG
        !(buf[0] === 0xff && buf[1] === 0xd8) &&  // not JPEG
        !(buf[0] === 0x52 && buf[1] === 0x49)     // not WEBP/RIFF
);

// ── Property 10: File Upload Validation ──────────────────────────────────────

describe('File Upload Validation — Property 10', () => {
    // ── Valid files always pass ───────────────────────────────────────────────

    describe('valid files always pass', () => {
        it('accepts any allowed MIME type with correct extension, size ≤ 2 MB, and valid content', () => {
            fc.assert(
                fc.property(arbAllowedMime, arbValidSize, (mime, size) => {
                    const buf = validBuffer(mime);
                    const result = validateBrandingFile(validFilename(mime), mime, size, buf);

                    expect(result.valid).toBe(true);
                    expect(result.code).toBeUndefined();
                    expect(result.error).toBeUndefined();
                }),
                { numRuns: 100 }
            );
        });

        it('accepts PNG at any size up to the 2 MB boundary', () => {
            fc.assert(
                fc.property(arbValidSize, (size) => {
                    const result = validateBrandingFile('logo.png', 'image/png', size, magicBuffer('image/png'));
                    expect(result.valid).toBe(true);
                }),
                { numRuns: 100 }
            );
        });

        it('accepts JPEG at any size up to the 2 MB boundary', () => {
            fc.assert(
                fc.property(arbValidSize, (size) => {
                    const result = validateBrandingFile('logo.jpg', 'image/jpeg', size, magicBuffer('image/jpeg'));
                    expect(result.valid).toBe(true);
                }),
                { numRuns: 100 }
            );
        });

        it('accepts WebP at any size up to the 2 MB boundary', () => {
            fc.assert(
                fc.property(arbValidSize, (size) => {
                    const result = validateBrandingFile('logo.webp', 'image/webp', size, magicBuffer('image/webp'));
                    expect(result.valid).toBe(true);
                }),
                { numRuns: 100 }
            );
        });

        it('accepts safe SVG at any size up to the 2 MB boundary', () => {
            fc.assert(
                fc.property(arbValidSize, (size) => {
                    const result = validateBrandingFile('logo.svg', 'image/svg+xml', size, safeSvgBuffer());
                    expect(result.valid).toBe(true);
                }),
                { numRuns: 100 }
            );
        });
    });

    // ── Disallowed MIME types always fail ─────────────────────────────────────

    describe('disallowed MIME types always fail with INVALID_MIME_TYPE', () => {
        it('rejects any MIME type outside the allowlist', () => {
            fc.assert(
                fc.property(arbDisallowedMime, arbValidSize, arbGarbage, (mime, size, buf) => {
                    const result = validateBrandingFile('logo.png', mime, size, buf);

                    expect(result.valid).toBe(false);
                    expect(result.code).toBe('INVALID_MIME_TYPE');
                }),
                { numRuns: 100 }
            );
        });
    });

    // ── Oversized files always fail ───────────────────────────────────────────

    describe('oversized files always fail with FILE_TOO_LARGE', () => {
        it('rejects any file over 2 MB regardless of type', () => {
            fc.assert(
                fc.property(arbAllowedMime, arbOversizedBytes, (mime, size) => {
                    const buf = validBuffer(mime);
                    const result = validateBrandingFile(validFilename(mime), mime, size, buf);

                    expect(result.valid).toBe(false);
                    expect(result.code).toBe('FILE_TOO_LARGE');
                }),
                { numRuns: 100 }
            );
        });

        it('size boundary: exactly 2 MB always passes, 2 MB + 1 always fails', () => {
            fc.assert(
                fc.property(arbAllowedMime, (mime) => {
                    const buf = validBuffer(mime);

                    const atLimit = validateBrandingFile(validFilename(mime), mime, MAX_BYTES, buf);
                    expect(atLimit.valid).toBe(true);

                    const overLimit = validateBrandingFile(validFilename(mime), mime, MAX_BYTES + 1, buf);
                    expect(overLimit.valid).toBe(false);
                    expect(overLimit.code).toBe('FILE_TOO_LARGE');
                }),
                { numRuns: 100 }
            );
        });
    });

    // ── Magic bytes mismatch always fails ─────────────────────────────────────

    describe('magic bytes mismatch always fails with MAGIC_BYTES_MISMATCH', () => {
        it('rejects PNG with non-PNG content', () => {
            fc.assert(
                fc.property(arbValidSize, arbGarbage, (size, buf) => {
                    const result = validateBrandingFile('logo.png', 'image/png', size, buf);
                    expect(result.valid).toBe(false);
                    expect(result.code).toBe('MAGIC_BYTES_MISMATCH');
                }),
                { numRuns: 100 }
            );
        });

        it('rejects JPEG with non-JPEG content', () => {
            fc.assert(
                fc.property(arbValidSize, arbGarbage, (size, buf) => {
                    const result = validateBrandingFile('logo.jpg', 'image/jpeg', size, buf);
                    expect(result.valid).toBe(false);
                    expect(result.code).toBe('MAGIC_BYTES_MISMATCH');
                }),
                { numRuns: 100 }
            );
        });

        it('rejects WebP with non-WebP content', () => {
            fc.assert(
                fc.property(arbValidSize, arbGarbage, (size, buf) => {
                    const result = validateBrandingFile('logo.webp', 'image/webp', size, buf);
                    expect(result.valid).toBe(false);
                    expect(result.code).toBe('MAGIC_BYTES_MISMATCH');
                }),
                { numRuns: 100 }
            );
        });
    });

    // ── Unsafe SVG always fails ───────────────────────────────────────────────

    describe('unsafe SVG content always fails with UNSAFE_SVG', () => {
        it('rejects SVG containing <script> tags', () => {
            fc.assert(
                fc.property(
                    fc.string({ minLength: 0, maxLength: 200 }),
                    (payload) => {
                        const svg = `<svg><script>${payload}</script></svg>`;
                        const buf = new TextEncoder().encode(svg);
                        const result = validateBrandingFile('logo.svg', 'image/svg+xml', buf.length, buf);
                        expect(result.valid).toBe(false);
                        expect(result.code).toBe('UNSAFE_SVG');
                    }
                ),
                { numRuns: 100 }
            );
        });

        it('rejects SVG containing inline event handlers (on*=)', () => {
            fc.assert(
                fc.property(
                    fc.string({ minLength: 1, maxLength: 20 }).filter((s) => /^[a-z]+$/i.test(s)),
                    fc.string({ minLength: 0, maxLength: 100 }),
                    (eventName, handler) => {
                        const svg = `<svg on${eventName}="${handler}"><rect/></svg>`;
                        const buf = new TextEncoder().encode(svg);
                        const result = validateBrandingFile('logo.svg', 'image/svg+xml', buf.length, buf);
                        expect(result.valid).toBe(false);
                        expect(result.code).toBe('UNSAFE_SVG');
                    }
                ),
                { numRuns: 100 }
            );
        });

        it('rejects non-SVG content declared as image/svg+xml', () => {
            fc.assert(
                fc.property(arbGarbage, (buf) => {
                    const result = validateBrandingFile('logo.svg', 'image/svg+xml', buf.length, buf);
                    expect(result.valid).toBe(false);
                    expect(result.code).toBe('UNSAFE_SVG');
                }),
                { numRuns: 100 }
            );
        });
    });

    // ── Structural invariants ─────────────────────────────────────────────────

    describe('structural invariants', () => {
        it('result.valid=true always means no error and no code', () => {
            fc.assert(
                fc.property(arbAllowedMime, arbValidSize, (mime, size) => {
                    const buf = validBuffer(mime);
                    const result = validateBrandingFile(validFilename(mime), mime, size, buf);

                    if (result.valid) {
                        expect(result.error).toBeUndefined();
                        expect(result.code).toBeUndefined();
                    }
                }),
                { numRuns: 100 }
            );
        });

        it('result.valid=false always means a non-empty error string and a code', () => {
            fc.assert(
                fc.property(arbAllowedMime, arbOversizedBytes, (mime, size) => {
                    const buf = validBuffer(mime);
                    // Oversized always fails — use as a reliable invalid path
                    const result = validateBrandingFile(validFilename(mime), mime, size, buf);

                    expect(result.valid).toBe(false);
                    expect(typeof result.error).toBe('string');
                    expect((result.error as string).length).toBeGreaterThan(0);
                    expect(typeof result.code).toBe('string');
                    expect((result.code as string).length).toBeGreaterThan(0);
                }),
                { numRuns: 100 }
            );
        });

        it('only supported MIME types can ever produce valid=true', () => {
            fc.assert(
                fc.property(arbDisallowedMime, arbValidSize, arbGarbage, (mime, size, buf) => {
                    const result = validateBrandingFile('logo.png', mime, size, buf);
                    // Invariant: no disallowed MIME type can ever pass
                    expect(result.valid).toBe(false);
                }),
                { numRuns: 100 }
            );
        });
    });
});
