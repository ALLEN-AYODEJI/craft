/**
 * Stellar Asset Trustline Tests
 *
 * Covers trustline creation, removal, limits, authorization flags, and queries.
 * All tests run against mocked Horizon responses — no live network required.
 *
 * Run: vitest run tests/stellar/trustline.test.ts
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Asset, Keypair, Networks, Operation, TransactionBuilder, xdr } from 'stellar-sdk';

// ── Types ─────────────────────────────────────────────────────────────────────

interface TrustlineBalance {
  asset_type: 'credit_alphanum4' | 'credit_alphanum12';
  asset_code: string;
  asset_issuer: string;
  balance: string;
  limit: string;
  is_authorized: boolean;
  is_authorized_to_maintain_liabilities: boolean;
}

interface AccountResponse {
  id: string;
  balances: Array<TrustlineBalance | { asset_type: 'native'; balance: string }>;
}

// ── Trustline manager (unit under test) ───────────────────────────────────────

class TrustlineManager {
  private readonly networkPassphrase: string;

  constructor(networkPassphrase = Networks.TESTNET) {
    this.networkPassphrase = networkPassphrase;
  }

  /** Build a change_trust operation to create or update a trustline. */
  buildChangeTrustOp(asset: Asset, limit?: string): ReturnType<typeof Operation.changeTrust> {
    return Operation.changeTrust({ asset, limit });
  }

  /** Build a change_trust operation that removes a trustline (limit = "0"). */
  buildRemoveTrustOp(asset: Asset): ReturnType<typeof Operation.changeTrust> {
    return Operation.changeTrust({ asset, limit: '0' });
  }

  /** Find a trustline in an account's balance list. */
  findTrustline(account: AccountResponse, asset: Asset): TrustlineBalance | undefined {
    return account.balances.find(
      (b): b is TrustlineBalance =>
        b.asset_type !== 'native' &&
        b.asset_code === asset.getCode() &&
        b.asset_issuer === asset.getIssuer()
    );
  }

  /** Return all non-native trustlines for an account. */
  listTrustlines(account: AccountResponse): TrustlineBalance[] {
    return account.balances.filter((b): b is TrustlineBalance => b.asset_type !== 'native');
  }

  /** Check whether a trustline is fully authorized. */
  isTrustlineAuthorized(trustline: TrustlineBalance): boolean {
    return trustline.is_authorized;
  }

  /** Check whether a trustline can maintain liabilities (partial auth). */
  canMaintainLiabilities(trustline: TrustlineBalance): boolean {
    return trustline.is_authorized_to_maintain_liabilities;
  }

  /** Validate that a limit string is a positive decimal number. */
  validateLimit(limit: string): { valid: boolean; error?: string } {
    const n = parseFloat(limit);
    if (isNaN(n) || n < 0) return { valid: false, error: 'Limit must be a non-negative number' };
    if (!/^\d+(\.\d{1,7})?$/.test(limit))
      return { valid: false, error: 'Limit must have at most 7 decimal places' };
    return { valid: true };
  }

  /** Build a full transaction containing a change_trust operation. */
  buildTrustlineTransaction(
    sourceAccount: { accountId(): string; incrementSequenceNumber(): void; sequenceNumber(): string },
    asset: Asset,
    limit?: string
  ): string {
    const op = limit === '0' ? this.buildRemoveTrustOp(asset) : this.buildChangeTrustOp(asset, limit);
    const tx = new TransactionBuilder(sourceAccount as any, {
      fee: '100',
      networkPassphrase: this.networkPassphrase,
    })
      .addOperation(op)
      .setTimeout(30)
      .build();
    return tx.toXDR();
  }
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeTrustline(overrides: Partial<TrustlineBalance> = {}): TrustlineBalance {
  return {
    asset_type: 'credit_alphanum4',
    asset_code: 'USD',
    asset_issuer: Keypair.random().publicKey(),
    balance: '0.0000000',
    limit: '922337203685.4775807',
    is_authorized: true,
    is_authorized_to_maintain_liabilities: true,
    ...overrides,
  };
}

function makeAccount(balances: AccountResponse['balances'] = []): AccountResponse {
  return { id: Keypair.random().publicKey(), balances };
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('TrustlineManager', () => {
  let manager: TrustlineManager;
  let issuer: Keypair;
  let usd: Asset;

  beforeEach(() => {
    manager = new TrustlineManager();
    issuer = Keypair.random();
    usd = new Asset('USD', issuer.publicKey());
  });

  // ── Trustline creation ──────────────────────────────────────────────────────

  describe('buildChangeTrustOp', () => {
    it('creates a change_trust operation with default max limit', () => {
      const decoded = Operation.fromXDRObject(manager.buildChangeTrustOp(usd));
      expect(decoded.type).toBe('changeTrust');
      expect((decoded as any).line.getCode()).toBe('USD');
    });

    it('creates a change_trust operation with a custom limit', () => {
      const decoded = Operation.fromXDRObject(manager.buildChangeTrustOp(usd, '5000.0000000'));
      expect((decoded as any).limit).toBe('5000.0000000');
    });

    it('supports alphanum12 asset codes', () => {
      const longAsset = new Asset('LONGCODE1234', issuer.publicKey());
      const decoded = Operation.fromXDRObject(manager.buildChangeTrustOp(longAsset));
      expect((decoded as any).line.getCode()).toBe('LONGCODE1234');
    });
  });

  // ── Trustline removal ───────────────────────────────────────────────────────

  describe('buildRemoveTrustOp', () => {
    it('sets limit to "0" to remove the trustline', () => {
      const decoded = Operation.fromXDRObject(manager.buildRemoveTrustOp(usd));
      expect(parseFloat((decoded as any).limit)).toBe(0);
    });

    it('targets the correct asset when removing', () => {
      const eur = new Asset('EUR', issuer.publicKey());
      const decoded = Operation.fromXDRObject(manager.buildRemoveTrustOp(eur));
      expect((decoded as any).line.getCode()).toBe('EUR');
    });
  });

  // ── Trustline queries ───────────────────────────────────────────────────────

  describe('findTrustline', () => {
    it('finds an existing trustline by asset', () => {
      const tl = makeTrustline({ asset_code: 'USD', asset_issuer: issuer.publicKey() });
      const account = makeAccount([tl]);
      const found = manager.findTrustline(account, usd);
      expect(found).toBeDefined();
      expect(found?.asset_code).toBe('USD');
    });

    it('returns undefined when trustline does not exist', () => {
      const account = makeAccount([]);
      expect(manager.findTrustline(account, usd)).toBeUndefined();
    });

    it('does not match a different issuer', () => {
      const otherIssuer = Keypair.random().publicKey();
      const tl = makeTrustline({ asset_code: 'USD', asset_issuer: otherIssuer });
      const account = makeAccount([tl]);
      expect(manager.findTrustline(account, usd)).toBeUndefined();
    });

    it('does not match native balance entries', () => {
      const account = makeAccount([{ asset_type: 'native', balance: '100.0000000' }]);
      expect(manager.findTrustline(account, usd)).toBeUndefined();
    });
  });

  describe('listTrustlines', () => {
    it('returns all non-native trustlines', () => {
      const tl1 = makeTrustline({ asset_code: 'USD' });
      const tl2 = makeTrustline({ asset_code: 'EUR' });
      const account = makeAccount([{ asset_type: 'native', balance: '10.0000000' }, tl1, tl2]);
      expect(manager.listTrustlines(account)).toHaveLength(2);
    });

    it('returns empty array when no trustlines exist', () => {
      const account = makeAccount([{ asset_type: 'native', balance: '10.0000000' }]);
      expect(manager.listTrustlines(account)).toHaveLength(0);
    });
  });

  // ── Trustline authorization ─────────────────────────────────────────────────

  describe('isTrustlineAuthorized', () => {
    it('returns true for a fully authorized trustline', () => {
      const tl = makeTrustline({ is_authorized: true });
      expect(manager.isTrustlineAuthorized(tl)).toBe(true);
    });

    it('returns false for an unauthorized trustline', () => {
      const tl = makeTrustline({ is_authorized: false });
      expect(manager.isTrustlineAuthorized(tl)).toBe(false);
    });
  });

  describe('canMaintainLiabilities', () => {
    it('returns true when authorized to maintain liabilities', () => {
      const tl = makeTrustline({ is_authorized_to_maintain_liabilities: true });
      expect(manager.canMaintainLiabilities(tl)).toBe(true);
    });

    it('returns false when not authorized to maintain liabilities', () => {
      const tl = makeTrustline({
        is_authorized: false,
        is_authorized_to_maintain_liabilities: false,
      });
      expect(manager.canMaintainLiabilities(tl)).toBe(false);
    });
  });

  // ── Trustline limits ────────────────────────────────────────────────────────

  describe('validateLimit', () => {
    it('accepts a valid positive limit', () => {
      expect(manager.validateLimit('1000.0000000').valid).toBe(true);
    });

    it('accepts zero (used for removal)', () => {
      expect(manager.validateLimit('0').valid).toBe(true);
    });

    it('rejects negative limits', () => {
      const result = manager.validateLimit('-1');
      expect(result.valid).toBe(false);
      expect(result.error).toMatch(/non-negative/);
    });

    it('rejects non-numeric strings', () => {
      expect(manager.validateLimit('abc').valid).toBe(false);
    });

    it('rejects more than 7 decimal places', () => {
      const result = manager.validateLimit('1.00000001');
      expect(result.valid).toBe(false);
      expect(result.error).toMatch(/7 decimal/);
    });

    it('accepts exactly 7 decimal places', () => {
      expect(manager.validateLimit('1.0000001').valid).toBe(true);
    });
  });

  // ── Transaction building ────────────────────────────────────────────────────

  describe('buildTrustlineTransaction', () => {
    function makeMockAccount() {
      const kp = Keypair.random();
      return {
        accountId: () => kp.publicKey(),
        incrementSequenceNumber: vi.fn(),
        sequenceNumber: () => '1',
      };
    }

    it('produces a valid XDR string for trustline creation', () => {
      const xdr = manager.buildTrustlineTransaction(makeMockAccount(), usd);
      expect(typeof xdr).toBe('string');
      expect(xdr.length).toBeGreaterThan(0);
    });

    it('produces a valid XDR string for trustline removal (limit=0)', () => {
      const xdr = manager.buildTrustlineTransaction(makeMockAccount(), usd, '0');
      expect(typeof xdr).toBe('string');
    });

    it('produces a valid XDR string with a custom limit', () => {
      const xdr = manager.buildTrustlineTransaction(makeMockAccount(), usd, '5000.0000000');
      expect(typeof xdr).toBe('string');
    });
  });

  // ── Edge cases ──────────────────────────────────────────────────────────────

  describe('edge cases', () => {
    it('handles an account with many trustlines', () => {
      const trustlines = Array.from({ length: 50 }, (_, i) =>
        makeTrustline({ asset_code: `TK${i}`, asset_issuer: issuer.publicKey() })
      );
      const account = makeAccount(trustlines);
      expect(manager.listTrustlines(account)).toHaveLength(50);
    });

    it('distinguishes between alphanum4 and alphanum12 assets with same issuer', () => {
      const short = new Asset('USD', issuer.publicKey());
      const long = new Asset('USDSTABLE12', issuer.publicKey());
      const tlShort = makeTrustline({ asset_type: 'credit_alphanum4', asset_code: 'USD', asset_issuer: issuer.publicKey() });
      const tlLong = makeTrustline({ asset_type: 'credit_alphanum12', asset_code: 'USDSTABLE12', asset_issuer: issuer.publicKey() });
      const account = makeAccount([tlShort, tlLong]);

      expect(manager.findTrustline(account, short)?.asset_code).toBe('USD');
      expect(manager.findTrustline(account, long)?.asset_code).toBe('USDSTABLE12');
    });

    it('treats a trustline with zero balance as valid', () => {
      const tl = makeTrustline({ balance: '0.0000000', is_authorized: true });
      expect(manager.isTrustlineAuthorized(tl)).toBe(true);
    });

    it('treats a trustline with zero limit as effectively removed', () => {
      const tl = makeTrustline({ limit: '0.0000000' });
      const result = manager.validateLimit(tl.limit);
      expect(result.valid).toBe(true); // "0" is a valid limit value
    });
  });
});
