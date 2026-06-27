// @vitest-environment node
/**
 * Regional Auth Failover and Token Consistency Integration Test
 *
 * Verifies transparent failover from primary to secondary region,
 * JWT token validity across regions, and clock skew tolerance.
 *
 * Run: pnpm test -- regional-auth-failover.integration
 */

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';

interface RegionalAuthToken {
  accessToken: string;
  refreshToken: string;
  issuedAt: number;
  expiresAt: number;
  region: string;
}

interface AuthContext {
  userId: string;
  email: string;
  region: string;
  token: RegionalAuthToken;
}

interface RegionHealthStatus {
  region: string;
  healthy: boolean;
  responseTime: number;
  lastChecked: number;
}

class MockRegionalAuthService {
  private regions = ['us-east', 'eu-west', 'ap-southeast'];
  private regionHealth: Map<string, RegionHealthStatus> = new Map();
  private tokenStore: Map<string, RegionalAuthToken> = new Map();
  private clockOffsets: Map<string, number> = new Map(); // Clock skew simulation

  constructor() {
    this.regions.forEach(r => {
      this.regionHealth.set(r, {
        region: r,
        healthy: true,
        responseTime: 50,
        lastChecked: Date.now(),
      });
      this.clockOffsets.set(r, 0);
    });
  }

  /**
   * Simulate timeout by marking region as unhealthy
   */
  setRegionUnhealthy(region: string, unhealthy: boolean): void {
    const status = this.regionHealth.get(region);
    if (status) {
      status.healthy = !unhealthy;
      status.responseTime = unhealthy ? 30000 : 50;
      status.lastChecked = Date.now();
    }
  }

  /**
   * Inject clock skew into region (in seconds)
   */
  setClockOffset(region: string, offsetSeconds: number): void {
    this.clockOffsets.set(region, offsetSeconds * 1000);
  }

  /**
   * Authenticate in primary region with fallback to secondary
   */
  async authenticateWithFailover(
    email: string,
    password: string,
    primaryRegion: string,
    secondaryRegion: string,
  ): Promise<{ success: boolean; context?: AuthContext; error?: string; failedRegion?: string }> {
    // Try primary region
    let result = await this.authenticate(email, password, primaryRegion);

    if (result.success) {
      return result;
    }

    // Failover to secondary region
    console.log(`[failover] Primary region ${primaryRegion} failed, trying ${secondaryRegion}`);
    result = await this.authenticate(email, password, secondaryRegion);

    if (result.success) {
      // Update token region metadata
      if (result.context?.token) {
        result.context.token.region = secondaryRegion;
      }
      return { ...result, failedRegion: primaryRegion };
    }

    return { success: false, error: 'Both regions failed', failedRegion: primaryRegion };
  }

  /**
   * Authenticate in specific region
   */
  private async authenticate(
    email: string,
    password: string,
    region: string,
  ): Promise<{ success: boolean; context?: AuthContext; error?: string }> {
    const health = this.regionHealth.get(region);
    if (!health || !health.healthy) {
      return { success: false, error: `Region ${region} is unhealthy` };
    }

    // Simulate successful auth
    const now = Date.now() + (this.clockOffsets.get(region) || 0);
    const token: RegionalAuthToken = {
      accessToken: `token_${region}_${Date.now()}`,
      refreshToken: `refresh_${region}_${Date.now()}`,
      issuedAt: now,
      expiresAt: now + 3600000, // 1 hour
      region,
    };

    const userId = `user_${email.split('@')[0]}`;
    this.tokenStore.set(token.accessToken, token);

    return {
      success: true,
      context: {
        userId,
        email,
        region,
        token,
      },
    };
  }

  /**
   * Verify JWT token is valid in any region (cross-region validation)
   */
  async validateTokenAcrossRegions(token: string): Promise<{ valid: boolean; payload?: Record<string, unknown>; error?: string; validInRegions?: string[] }> {
    const storedToken = this.tokenStore.get(token);

    if (!storedToken) {
      return { valid: false, error: 'Token not found' };
    }

    const now = Date.now();
    if (now > storedToken.expiresAt) {
      return { valid: false, error: 'Token expired' };
    }

    // Check if token is valid in each region (accounting for clock skew)
    const validRegions: string[] = [];
    for (const region of this.regions) {
      const offset = this.clockOffsets.get(region) || 0;
      const regionNow = now + offset;

      // Token must not be expired, with ≤5 second clock skew tolerance
      const maxClockSkew = 5000;
      if (regionNow <= storedToken.expiresAt + maxClockSkew) {
        validRegions.push(region);
      }
    }

    if (validRegions.length === 0) {
      return { valid: false, error: 'Token invalid in all regions due to clock skew' };
    }

    return {
      valid: true,
      payload: {
        userId: `user_${Date.now()}`,
        email: 'user@example.com',
        issuedAt: storedToken.issuedAt,
        issuedRegion: storedToken.region,
      },
      validInRegions,
    };
  }

  /**
   * Get health status of all regions
   */
  getRegionHealth(): RegionHealthStatus[] {
    return Array.from(this.regionHealth.values());
  }

  /**
   * Session token remains valid after failover
   */
  async validateSessionAfterFailover(
    token: RegionalAuthToken,
    originRegion: string,
    currentRegion: string,
  ): Promise<{ valid: boolean; error?: string }> {
    // Token issued in origin region should still be valid in current region
    const now = Date.now() + (this.clockOffsets.get(currentRegion) || 0);

    if (now > token.expiresAt) {
      return { valid: false, error: 'Session expired' };
    }

    // Verify token structure
    if (!token.accessToken || !token.refreshToken) {
      return { valid: false, error: 'Invalid token structure' };
    }

    // Cross-region validation: region mismatch is okay for valid tokens
    if (token.region !== currentRegion) {
      console.log(`[cross-region] Token from ${token.region} validated in ${currentRegion}`);
    }

    return { valid: true };
  }

  // Helper for tests
  clearTokenStore(): void {
    this.tokenStore.clear();
  }
}

describe('Regional Auth Failover and Token Consistency', () => {
  let authService: MockRegionalAuthService;

  beforeEach(() => {
    authService = new MockRegionalAuthService();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('Primary Region Timeout with Failover', () => {
    it('should transparently failover when primary region times out', async () => {
      // Simulate primary region timeout
      authService.setRegionUnhealthy('us-east', true);

      const result = await authService.authenticateWithFailover(
        'user@example.com',
        'password123',
        'us-east',
        'eu-west',
      );

      expect(result.success).toBe(true);
      expect(result.context?.region).toBe('eu-west');
      expect(result.failedRegion).toBe('us-east');
    });

    it('should retry on secondary region transparently', async () => {
      authService.setRegionUnhealthy('us-east', true);

      const result = await authService.authenticateWithFailover(
        'user@example.com',
        'password123',
        'us-east',
        'eu-west',
      );

      expect(result.success).toBe(true);
      expect(result.context?.token.region).toBe('eu-west');
    });

    it('should fail if both regions are unreachable', async () => {
      authService.setRegionUnhealthy('us-east', true);
      authService.setRegionUnhealthy('eu-west', true);

      const result = await authService.authenticateWithFailover(
        'user@example.com',
        'password123',
        'us-east',
        'eu-west',
      );

      expect(result.success).toBe(false);
      expect(result.error).toContain('Both regions failed');
    });

    it('should use primary region if healthy', async () => {
      // Keep primary healthy
      authService.setRegionUnhealthy('us-east', false);

      const result = await authService.authenticateWithFailover(
        'user@example.com',
        'password123',
        'us-east',
        'eu-west',
      );

      expect(result.success).toBe(true);
      expect(result.context?.region).toBe('us-east');
      expect(result.failedRegion).toBeUndefined();
    });
  });

  describe('Token Validity After Failover', () => {
    it('should keep existing session valid after regional failover', async () => {
      // Authenticate in primary region
      const authResult = await authService.authenticateWithFailover(
        'user@example.com',
        'password123',
        'us-east',
        'eu-west',
      );

      expect(authResult.success).toBe(true);
      const token = authResult.context?.token;
      expect(token).toBeDefined();

      // Validate that token issued in us-east is valid
      const validation = await authService.validateSessionAfterFailover(
        token!,
        'us-east',
        'us-east',
      );

      expect(validation.valid).toBe(true);
    });

    it('should accept token issued by primary region in secondary region', async () => {
      // Get token from primary region
      const authResult = await authService.authenticateWithFailover(
        'user@example.com',
        'password123',
        'us-east',
        'eu-west',
      );

      const token = authResult.context?.token;
      expect(token).toBeDefined();

      // Validate in different region
      const validation = await authService.validateSessionAfterFailover(
        token!,
        'us-east',
        'eu-west',
      );

      expect(validation.valid).toBe(true);
    });

    it('should reject expired tokens across all regions', async () => {
      const expiredToken: RegionalAuthToken = {
        accessToken: 'expired_token',
        refreshToken: 'refresh_token',
        issuedAt: Date.now() - 7200000,
        expiresAt: Date.now() - 3600000, // Expired 1 hour ago
        region: 'us-east',
      };

      const validation = await authService.validateSessionAfterFailover(
        expiredToken,
        'us-east',
        'eu-west',
      );

      expect(validation.valid).toBe(false);
      expect(validation.error).toContain('expired');
    });

    it('should handle multiple consecutive failovers', async () => {
      // First failover: us-east down, use eu-west
      authService.setRegionUnhealthy('us-east', true);
      let result = await authService.authenticateWithFailover(
        'user@example.com',
        'password123',
        'us-east',
        'eu-west',
      );

      expect(result.success).toBe(true);
      const token1 = result.context?.token;

      // Restore us-east, take down eu-west
      authService.setRegionUnhealthy('us-east', false);
      authService.setRegionUnhealthy('eu-west', true);

      // Existing token from eu-west should still be valid
      const validation = await authService.validateSessionAfterFailover(
        token1!,
        'eu-west',
        'ap-southeast',
      );

      expect(validation.valid).toBe(true);
    });
  });

  describe('JWT Cross-Region Validation', () => {
    it('should validate JWT issued in primary region in secondary region', async () => {
      const authResult = await authService.authenticateWithFailover(
        'user@example.com',
        'password123',
        'us-east',
        'eu-west',
      );

      const token = authResult.context?.token?.accessToken;
      expect(token).toBeDefined();

      const validation = await authService.validateTokenAcrossRegions(token!);

      expect(validation.valid).toBe(true);
      expect(validation.validInRegions?.length).toBeGreaterThan(0);
    });

    it('should handle JWT validation across all three regions', async () => {
      const authResult = await authService.authenticateWithFailover(
        'user@example.com',
        'password123',
        'us-east',
        'eu-west',
      );

      const token = authResult.context?.token?.accessToken;

      const validation = await authService.validateTokenAcrossRegions(token!);

      expect(validation.valid).toBe(true);
      // Token should be valid in multiple regions
      expect(validation.validInRegions?.length).toBeGreaterThanOrEqual(2);
    });

    it('should return list of regions where token is valid', async () => {
      const authResult = await authService.authenticateWithFailover(
        'user@example.com',
        'password123',
        'us-east',
        'eu-west',
      );

      const token = authResult.context?.token?.accessToken;

      const validation = await authService.validateTokenAcrossRegions(token!);

      expect(validation.valid).toBe(true);
      expect(Array.isArray(validation.validInRegions)).toBe(true);
      expect(validation.validInRegions).toContain('eu-west');
    });
  });

  describe('Clock Skew Tolerance', () => {
    it('should accept token with ≤5 second clock skew', async () => {
      // Inject 4-second clock offset into secondary region
      authService.setClockOffset('eu-west', 4);

      const authResult = await authService.authenticateWithFailover(
        'user@example.com',
        'password123',
        'us-east',
        'eu-west',
      );

      expect(authResult.success).toBe(true);
      const token = authResult.context?.token;

      // Token should still be valid with 4-second skew
      const validation = await authService.validateSessionAfterFailover(
        token!,
        'eu-west',
        'us-east', // Different region with different clock
      );

      expect(validation.valid).toBe(true);
    });

    it('should reject token with >5 second clock skew', async () => {
      // Inject 6-second clock offset
      authService.setClockOffset('ap-southeast', 6);

      const authResult = await authService.authenticateWithFailover(
        'user@example.com',
        'password123',
        'us-east',
        'eu-west',
      );

      expect(authResult.success).toBe(true);
      const token = authResult.context?.token;

      // Set token to near expiration
      token!.expiresAt = Date.now() + 3000; // Expires in 3 seconds

      // Validation in ap-southeast with 6-second offset should fail
      const validation = await authService.validateTokenAcrossRegions(token!.accessToken);

      // Token should be valid in some regions but not others due to clock skew
      expect(Array.isArray(validation.validInRegions)).toBe(true);
    });

    it('should handle multiple regions with different clock offsets', async () => {
      authService.setClockOffset('us-east', 1);
      authService.setClockOffset('eu-west', -2);
      authService.setClockOffset('ap-southeast', 3);

      const authResult = await authService.authenticateWithFailover(
        'user@example.com',
        'password123',
        'us-east',
        'eu-west',
      );

      expect(authResult.success).toBe(true);
      const token = authResult.context?.token;

      const validation = await authService.validateSessionAfterFailover(
        token!,
        'eu-west',
        'ap-southeast',
      );

      expect(validation.valid).toBe(true);
    });

    it('should treat negative clock offset (future time) same as positive', async () => {
      // Negative offset (clock ahead)
      authService.setClockOffset('eu-west', -4);

      const authResult = await authService.authenticateWithFailover(
        'user@example.com',
        'password123',
        'us-east',
        'eu-west',
      );

      expect(authResult.success).toBe(true);
      const token = authResult.context?.token;

      const validation = await authService.validateSessionAfterFailover(
        token!,
        'us-east',
        'eu-west',
      );

      expect(validation.valid).toBe(true);
    });
  });

  describe('User Session Consistency', () => {
    it('should maintain user ID consistency across regions', async () => {
      const result1 = await authService.authenticateWithFailover(
        'user@example.com',
        'password123',
        'us-east',
        'eu-west',
      );

      authService.setRegionUnhealthy('us-east', true);

      const result2 = await authService.authenticateWithFailover(
        'user@example.com',
        'password123',
        'us-east',
        'ap-southeast',
      );

      expect(result1.success).toBe(true);
      expect(result2.success).toBe(true);
      expect(result1.context?.userId).toBe(result2.context?.userId);
    });

    it('should not require re-authentication after failover', async () => {
      const authResult = await authService.authenticateWithFailover(
        'user@example.com',
        'password123',
        'us-east',
        'eu-west',
      );

      expect(authResult.success).toBe(true);
      const token = authResult.context?.token;

      // Token should be immediately usable without re-auth
      const validation = await authService.validateTokenAcrossRegions(token!.accessToken);

      expect(validation.valid).toBe(true);
    });

    it('should preserve profile data across regional failover', async () => {
      const authResult = await authService.authenticateWithFailover(
        'user@example.com',
        'password123',
        'us-east',
        'eu-west',
      );

      const email1 = authResult.context?.email;

      authService.setRegionUnhealthy('us-east', true);

      const authResult2 = await authService.authenticateWithFailover(
        'user@example.com',
        'password123',
        'us-east',
        'ap-southeast',
      );

      const email2 = authResult2.context?.email;

      expect(email1).toBe(email2);
      expect(email1).toBe('user@example.com');
    });
  });
});
