/**
 * GitHubCredentialService
 *
 * Validates, decrypts, and rotates GitHub credentials.
 *
 * Encryption:
 *   Tokens are stored encrypted via AES-256-GCM (see lib/github/token-encryption).
 *   The plaintext token is NEVER persisted; only the encrypted blob is written to
 *   `profiles.github_token_encrypted`.  Decryption happens in-process, server-side
 *   only, and the plaintext is never logged.
 *
 * Strategy:
 *   1. Read the stored encrypted token + expiry metadata from the profiles row.
 *   2. If the token is absent → throw GitHubCredentialError('NOT_CONNECTED').
 *   3. If a known expiry exists and is within EXPIRY_BUFFER_MS → treat as
 *      expired and throw GitHubCredentialError('TOKEN_EXPIRED').
 *   4. Decrypt the stored blob to recover the plaintext token.
 *   5. Probe the GitHub API (/user) to confirm the token is still accepted.
 *      - 200 → update github_token_refreshed_at atomically and return the plaintext token.
 *      - 401 → throw GitHubCredentialError('TOKEN_INVALID').
 *      - network/other → throw GitHubCredentialError('VALIDATION_FAILED').
 *
 * Token rotation (rotateToken):
 *   Accepts a new plaintext token, encrypts it, and atomically replaces the
 *   stored encrypted value in a single UPDATE.  The old token is immediately
 *   invalidated — any concurrent request that decrypted the old value will
 *   receive a 401 from GitHub on its next probe.
 *
 * Assumptions / follow-up work:
 *   - Key rotation (re-encrypting all rows with a new key) is out of scope.
 *     Implement key versioning (prefix stored value with key ID) when needed.
 *   - HSM / KMS integration is out of scope; the key is read from the
 *     GITHUB_TOKEN_ENCRYPTION_KEY environment variable.
 *   - OAuth refresh flow (obtaining a new token from GitHub) is the caller's
 *     responsibility; this service only stores and validates what it is given.
 *
 * Atomic update:
 *   github_token_refreshed_at and github_token_encrypted are written in single
 *   UPDATE statements so concurrent requests converge on consistent row state.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import { encryptToken, decryptToken } from '@/lib/github/token-encryption';

const GITHUB_API_BASE = 'https://api.github.com';

/** How many milliseconds before the stated expiry we treat the token as expired. */
const EXPIRY_BUFFER_MS = 5 * 60 * 1000; // 5 minutes

export type GitHubCredentialErrorCode =
    | 'NOT_CONNECTED'
    | 'TOKEN_EXPIRED'
    | 'TOKEN_INVALID'
    | 'VALIDATION_FAILED';

export class GitHubCredentialError extends Error {
    constructor(
        message: string,
        public readonly code: GitHubCredentialErrorCode,
    ) {
        super(message);
        this.name = 'GitHubCredentialError';
    }
}

interface CredentialRow {
    github_token_encrypted: string | null;
    github_token_expires_at: string | null;
}

interface FetchLike {
    (input: string, init?: RequestInit): Promise<Response>;
}

export class GitHubCredentialService {
    constructor(
        private readonly _supabase: SupabaseClient,
        private readonly _fetch: FetchLike = fetch,
    ) {}

    /**
     * Validates the stored GitHub token for `userId`.
     * On success, updates `github_token_refreshed_at` and returns the token.
     * On failure, throws a typed `GitHubCredentialError`.
     */
    async ensureValidToken(userId: string): Promise<string> {
        const token = await this._loadAndCheckExpiry(userId);
        await this._probeGitHub(token, userId);
        return token;
    }

    // ── Private ──────────────────────────────────────────────────────────────

    private async _loadAndCheckExpiry(userId: string): Promise<string> {
        const { data, error } = await this._supabase
            .from('profiles')
            .select('github_token_encrypted, github_token_expires_at')
            .eq('id', userId)
            .single<CredentialRow>();

        if (error || !data) {
            throw new GitHubCredentialError(
                'Failed to load GitHub credentials',
                'VALIDATION_FAILED',
            );
        }

        const encryptedToken = data.github_token_encrypted;
        if (!encryptedToken) {
            throw new GitHubCredentialError(
                'GitHub account is not connected',
                'NOT_CONNECTED',
            );
        }

        if (data.github_token_expires_at) {
            const expiresAt = new Date(data.github_token_expires_at).getTime();
            if (Date.now() >= expiresAt - EXPIRY_BUFFER_MS) {
                throw new GitHubCredentialError(
                    'GitHub token has expired — please reconnect your GitHub account',
                    'TOKEN_EXPIRED',
                );
            }
        }

        // Decrypt the stored ciphertext — plaintext token is never logged.
        return decryptToken(encryptedToken);
    }

    /**
     * Atomically replaces the stored GitHub token with a new one.
     * The new plaintext token is encrypted before storage; the old token is
     * immediately invalidated.  Returns the new plaintext token.
     *
     * Callers are responsible for obtaining the new token via the GitHub OAuth
     * refresh flow before calling this method.
     */
    async rotateToken(userId: string, newPlaintextToken: string, expiresAt?: Date): Promise<string> {
        const update: Record<string, unknown> = {
            github_token_encrypted: encryptToken(newPlaintextToken),
            github_token_refreshed_at: new Date().toISOString(),
        };
        if (expiresAt !== undefined) {
            update.github_token_expires_at = expiresAt.toISOString();
        }

        const { error } = await this._supabase
            .from('profiles')
            .update(update)
            .eq('id', userId);

        if (error) {
            throw new GitHubCredentialError(
                `Failed to rotate GitHub token: ${error.message}`,
                'VALIDATION_FAILED',
            );
        }

        return newPlaintextToken;
    }

    private async _probeGitHub(token: string, userId: string): Promise<void> {
        let res: Response;
        try {
            res = await this._fetch(`${GITHUB_API_BASE}/user`, {
                headers: {
                    Authorization: `Bearer ${token}`,
                    Accept: 'application/vnd.github+json',
                    'X-GitHub-Api-Version': '2022-11-28',
                },
            });
        } catch {
            throw new GitHubCredentialError(
                'Could not reach GitHub API to validate credentials',
                'VALIDATION_FAILED',
            );
        }

        if (res.status === 401) {
            throw new GitHubCredentialError(
                'GitHub token is invalid or has been revoked — please reconnect your GitHub account',
                'TOKEN_INVALID',
            );
        }

        if (!res.ok) {
            throw new GitHubCredentialError(
                `GitHub API returned unexpected status ${res.status} during credential validation`,
                'VALIDATION_FAILED',
            );
        }

        // Token is valid — record the refresh timestamp atomically.
        await this._supabase
            .from('profiles')
            .update({ github_token_refreshed_at: new Date().toISOString() })
            .eq('id', userId);
    }
}
