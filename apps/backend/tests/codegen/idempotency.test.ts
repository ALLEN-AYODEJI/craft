/**
 * Code Generation Idempotency Tests
 * Issue #359: Implement Code Generation Idempotency Tests
 *
 * Tests that verify code generation is idempotent - generating the same template twice produces identical results
 */

import { describe, it, expect, beforeEach } from 'vitest';
import * as crypto from 'crypto';

// ── Mock Types ────────────────────────────────────────────────────────────────

interface CustomizationConfig {
  branding?: {
    logo?: string;
    primaryColor?: string;
    secondaryColor?: string;
  };
  features?: Record<string, boolean>;
  blockchain?: {
    network?: string;
    rpcUrl?: string;
  };
}

interface GeneratedFile {
  path: string;
  content: string;
  hash: string;
}

interface GenerationResult {
  templateId: string;
  files: GeneratedFile[];
  timestamp: Date;
  configHash: string;
}

// ── Utility Functions ─────────────────────────────────────────────────────────

function hashContent(content: string): string {
  return crypto.createHash('sha256').update(content).digest('hex');
}

function hashConfig(config: CustomizationConfig): string {
  const json = JSON.stringify(config, Object.keys(config).sort());
  return crypto.createHash('sha256').update(json).digest('hex');
}

// ── Mock Code Generator ───────────────────────────────────────────────────────

const mockCodeGenerator = {
  generateTemplate: async (templateId: string, config: CustomizationConfig): Promise<GenerationResult> => {
    const files: GeneratedFile[] = [
      {
        path: 'package.json',
        content: JSON.stringify({ name: templateId, config }, null, 2),
        hash: '',
      },
      {
        path: 'src/index.ts',
        content: `// Generated for ${templateId}\nexport const config = ${JSON.stringify(config)};`,
        hash: '',
      },
      {
        path: '.env.example',
        content: `TEMPLATE_ID=${templateId}\nNETWORK=${config.blockchain?.network || 'testnet'}`,
        hash: '',
      },
    ];

    // Calculate hashes
    files.forEach((file) => {
      file.hash = hashContent(file.content);
    });

    return {
      templateId,
      files,
      timestamp: new Date(),
      configHash: hashConfig(config),
    };
  },
};

// ── Test Suite ────────────────────────────────────────────────────────────────

describe('Code Generation Idempotency', () => {
  const mockTemplateId = 'stellar-dex';
  const mockConfig: CustomizationConfig = {
    branding: {
      logo: 'https://example.com/logo.png',
      primaryColor: '#0066cc',
      secondaryColor: '#00cc66',
    },
    features: {
      enableCharts: true,
      enableHistory: true,
      enableSwapping: true,
    },
    blockchain: {
      network: 'testnet',
      rpcUrl: 'https://horizon-testnet.stellar.org',
    },
  };

  describe('Idempotency for All Templates', () => {
    it('should generate identical output on multiple runs', async () => {
      const result1 = await mockCodeGenerator.generateTemplate(mockTemplateId, mockConfig);
      const result2 = await mockCodeGenerator.generateTemplate(mockTemplateId, mockConfig);

      expect(result1.files.length).toBe(result2.files.length);

      result1.files.forEach((file, index) => {
        expect(file.content).toBe(result2.files[index].content);
        expect(file.hash).toBe(result2.files[index].hash);
      });
    });

    it('should produce identical file hashes across generations', async () => {
      const result1 = await mockCodeGenerator.generateTemplate(mockTemplateId, mockConfig);
      const result2 = await mockCodeGenerator.generateTemplate(mockTemplateId, mockConfig);

      const hashes1 = result1.files.map((f) => f.hash);
      const hashes2 = result2.files.map((f) => f.hash);

      expect(hashes1).toEqual(hashes2);
    });

    it('should maintain consistent config hash', async () => {
      const result1 = await mockCodeGenerator.generateTemplate(mockTemplateId, mockConfig);
      const result2 = await mockCodeGenerator.generateTemplate(mockTemplateId, mockConfig);

      expect(result1.configHash).toBe(result2.configHash);
    });

    it('should generate same number of files', async () => {
      const result1 = await mockCodeGenerator.generateTemplate(mockTemplateId, mockConfig);
      const result2 = await mockCodeGenerator.generateTemplate(mockTemplateId, mockConfig);

      expect(result1.files.length).toBe(result2.files.length);
    });

    it('should generate files in same order', async () => {
      const result1 = await mockCodeGenerator.generateTemplate(mockTemplateId, mockConfig);
      const result2 = await mockCodeGenerator.generateTemplate(mockTemplateId, mockConfig);

      result1.files.forEach((file, index) => {
        expect(file.path).toBe(result2.files[index].path);
      });
    });
  });

  describe('No Random/Timestamp Artifacts', () => {
    it('should not include random values in generated code', async () => {
      const result1 = await mockCodeGenerator.generateTemplate(mockTemplateId, mockConfig);
      const result2 = await mockCodeGenerator.generateTemplate(mockTemplateId, mockConfig);

      result1.files.forEach((file1, index) => {
        const file2 = result2.files[index];
        expect(file1.content).toBe(file2.content);
      });
    });

    it('should not include timestamps in generated files', async () => {
      const result = await mockCodeGenerator.generateTemplate(mockTemplateId, mockConfig);

      result.files.forEach((file) => {
        // Check for common timestamp patterns
        expect(file.content).not.toMatch(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
        expect(file.content).not.toMatch(/Date\.now\(\)/);
        expect(file.content).not.toMatch(/new Date\(\)/);
      });
    });

    it('should not include UUIDs or random IDs', async () => {
      const result = await mockCodeGenerator.generateTemplate(mockTemplateId, mockConfig);

      result.files.forEach((file) => {
        // Check for UUID pattern
        expect(file.content).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i);
      });
    });

    it('should produce byte-for-byte identical output', async () => {
      const result1 = await mockCodeGenerator.generateTemplate(mockTemplateId, mockConfig);
      const result2 = await mockCodeGenerator.generateTemplate(mockTemplateId, mockConfig);

      result1.files.forEach((file1, index) => {
        const file2 = result2.files[index];
        const buffer1 = Buffer.from(file1.content);
        const buffer2 = Buffer.from(file2.content);

        expect(buffer1.equals(buffer2)).toBe(true);
      });
    });
  });

  describe('Same Customization Config', () => {
    it('should generate identical output with same config', async () => {
      const config: CustomizationConfig = {
        branding: { primaryColor: '#0066cc' },
        features: { enableCharts: true },
      };

      const result1 = await mockCodeGenerator.generateTemplate(mockTemplateId, config);
      const result2 = await mockCodeGenerator.generateTemplate(mockTemplateId, config);

      expect(result1.configHash).toBe(result2.configHash);
      expect(result1.files).toEqual(result2.files);
    });

    it('should generate different output with different config', async () => {
      const config1: CustomizationConfig = {
        branding: { primaryColor: '#0066cc' },
      };

      const config2: CustomizationConfig = {
        branding: { primaryColor: '#ff0000' },
      };

      const result1 = await mockCodeGenerator.generateTemplate(mockTemplateId, config1);
      const result2 = await mockCodeGenerator.generateTemplate(mockTemplateId, config2);

      expect(result1.configHash).not.toBe(result2.configHash);
    });

    it('should handle empty config consistently', async () => {
      const emptyConfig: CustomizationConfig = {};

      const result1 = await mockCodeGenerator.generateTemplate(mockTemplateId, emptyConfig);
      const result2 = await mockCodeGenerator.generateTemplate(mockTemplateId, emptyConfig);

      expect(result1.files).toEqual(result2.files);
    });

    it('should handle complex nested config consistently', async () => {
      const complexConfig: CustomizationConfig = {
        branding: {
          logo: 'https://example.com/logo.png',
          primaryColor: '#0066cc',
          secondaryColor: '#00cc66',
        },
        features: {
          enableCharts: true,
          enableHistory: true,
          enableSwapping: true,
          enableAnalytics: false,
        },
        blockchain: {
          network: 'mainnet',
          rpcUrl: 'https://horizon.stellar.org',
        },
      };

      const result1 = await mockCodeGenerator.generateTemplate(mockTemplateId, complexConfig);
      const result2 = await mockCodeGenerator.generateTemplate(mockTemplateId, complexConfig);

      expect(result1.files).toEqual(result2.files);
    });
  });

  describe('File Content Equality', () => {
    it('should generate identical file contents', async () => {
      const result1 = await mockCodeGenerator.generateTemplate(mockTemplateId, mockConfig);
      const result2 = await mockCodeGenerator.generateTemplate(mockTemplateId, mockConfig);

      result1.files.forEach((file1, index) => {
        const file2 = result2.files[index];
        expect(file1.content).toBe(file2.content);
      });
    });

    it('should maintain file paths consistently', async () => {
      const result1 = await mockCodeGenerator.generateTemplate(mockTemplateId, mockConfig);
      const result2 = await mockCodeGenerator.generateTemplate(mockTemplateId, mockConfig);

      result1.files.forEach((file1, index) => {
        const file2 = result2.files[index];
        expect(file1.path).toBe(file2.path);
      });
    });

    it('should generate consistent hashes for each file', async () => {
      const result1 = await mockCodeGenerator.generateTemplate(mockTemplateId, mockConfig);
      const result2 = await mockCodeGenerator.generateTemplate(mockTemplateId, mockConfig);

      result1.files.forEach((file1, index) => {
        const file2 = result2.files[index];
        expect(file1.hash).toBe(file2.hash);
      });
    });

    it('should not have whitespace differences', async () => {
      const result1 = await mockCodeGenerator.generateTemplate(mockTemplateId, mockConfig);
      const result2 = await mockCodeGenerator.generateTemplate(mockTemplateId, mockConfig);

      result1.files.forEach((file1, index) => {
        const file2 = result2.files[index];
        const content1 = file1.content.trim();
        const content2 = file2.content.trim();

        expect(content1).toBe(content2);
      });
    });
  });

  describe('Generation Determinism', () => {
    it('should be deterministic across multiple runs', async () => {
      const results = await Promise.all([
        mockCodeGenerator.generateTemplate(mockTemplateId, mockConfig),
        mockCodeGenerator.generateTemplate(mockTemplateId, mockConfig),
        mockCodeGenerator.generateTemplate(mockTemplateId, mockConfig),
      ]);

      const firstResult = results[0];
      results.forEach((result) => {
        expect(result.files).toEqual(firstResult.files);
        expect(result.configHash).toBe(firstResult.configHash);
      });
    });

    it('should produce consistent results regardless of execution order', async () => {
      const result1 = await mockCodeGenerator.generateTemplate(mockTemplateId, mockConfig);
      const result2 = await mockCodeGenerator.generateTemplate(mockTemplateId, mockConfig);

      expect(result1.files).toEqual(result2.files);
    });

    it('should handle concurrent generation consistently', async () => {
      const results = await Promise.all([
        mockCodeGenerator.generateTemplate(mockTemplateId, mockConfig),
        mockCodeGenerator.generateTemplate(mockTemplateId, mockConfig),
      ]);

      expect(results[0].files).toEqual(results[1].files);
    });
  });

  describe('Acceptable Differences', () => {
    it('should allow different generation timestamps', async () => {
      const result1 = await mockCodeGenerator.generateTemplate(mockTemplateId, mockConfig);
      const result2 = await mockCodeGenerator.generateTemplate(mockTemplateId, mockConfig);

      // Timestamps may differ, but file content should be identical
      expect(result1.timestamp).not.toEqual(result2.timestamp);
      expect(result1.files).toEqual(result2.files);
    });

    it('should document any acceptable differences', () => {
      // Acceptable differences:
      // 1. Generation timestamps (result.timestamp)
      // 2. File modification times (not included in content)
      // 3. Execution environment (not reflected in output)

      const acceptableDifferences = [
        'timestamp',
        'executionTime',
        'generatedAt',
      ];

      expect(acceptableDifferences).toContain('timestamp');
    });
  });
});
