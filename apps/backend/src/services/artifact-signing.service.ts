/**
 * ArtifactSigningService
 *
 * Signs and verifies deployment artifacts using SHA-256 + HMAC-SHA256.
 * The signing secret is read from process.env.ARTIFACT_SIGNING_SECRET.
 *
 * Issue: #496
 */

import { createHash, createHmac, timingSafeEqual } from 'crypto';
import { posix as path } from 'path';

export class ArtifactSigningService {
    private get secret(): string {
        const s = process.env.ARTIFACT_SIGNING_SECRET;
        if (!s) throw new Error('ARTIFACT_SIGNING_SECRET environment variable is not set');
        return s;
    }

    signArtifact(artifact: Buffer | string): { checksum: string; signature: string } {
        const buf = Buffer.isBuffer(artifact) ? artifact : Buffer.from(artifact, 'utf8');
        const checksum = 'sha256:' + createHash('sha256').update(buf).digest('hex');
        const signature = createHmac('sha256', this.secret).update(checksum).digest('hex');
        return { checksum, signature };
    }

    /**
     * Validate a storage path against per-user namespace requirements.
     *
     * The path must start with `{userId}/` after normalization. This prevents
     * path traversal attacks (e.g. `../../other-user/deploy/artifact.zip`)
     * where a malicious user could read or overwrite another user's artifacts.
     *
     * Normalization resolves `.` and `..` segments, so a path like
     * `user-1/../../other-user/deploy/artifact.zip` becomes
     * `other-user/deploy/artifact.zip` and is rejected because the first
     * component does not match `userId`.
     *
     * @param userId  The authenticated user's ID.
     * @param storagePath  The proposed storage path (e.g. `user-1/deploy-abc/artifact.zip`).
     * @returns `true` if the path is valid for this user, `false` otherwise.
     */
    validateStoragePath(userId: string, storagePath: string): boolean {
        if (!userId || !storagePath) return false;

        const normalized = path.normalize(storagePath);
        const expectedPrefix = userId + '/';

        return normalized.startsWith(expectedPrefix);
    }

    verifyArtifact(artifact: Buffer | string, checksum: string, signature: string): boolean {
        try {
            const buf = Buffer.isBuffer(artifact) ? artifact : Buffer.from(artifact, 'utf8');
            const expectedChecksum = 'sha256:' + createHash('sha256').update(buf).digest('hex');
            const expectedSignature = createHmac('sha256', this.secret).update(expectedChecksum).digest('hex');

            const checksumMatch = timingSafeEqual(
                Buffer.from(checksum),
                Buffer.from(expectedChecksum),
            );
            const signatureMatch = timingSafeEqual(
                Buffer.from(signature),
                Buffer.from(expectedSignature),
            );
            return checksumMatch && signatureMatch;
        } catch {
            return false;
        }
    }
}

export const artifactSigningService = new ArtifactSigningService();
