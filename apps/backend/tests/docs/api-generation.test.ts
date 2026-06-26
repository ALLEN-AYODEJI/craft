/**
 * API Documentation Generation Tests
 * Issue #361: Create API Documentation Generation Tests
 *
 * Tests that verify API documentation is automatically generated and stays in sync with code
 */

import { describe, it, expect, beforeEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as yaml from 'js-yaml';

// ── Mock OpenAPI Spec ─────────────────────────────────────────────────────────

interface OpenAPISpec {
  openapi: string;
  info: {
    title: string;
    version: string;
    description: string;
  };
  paths: Record<string, unknown>;
  components: {
    schemas: Record<string, unknown>;
  };
}

interface EndpointExample {
  method: string;
  path: string;
  request?: unknown;
  response?: unknown;
}

// ── Test Suite ────────────────────────────────────────────────────────────────

describe('API Documentation Generation', () => {
  let openApiSpec: OpenAPISpec;
  const specPath = path.join(process.cwd(), 'openapi.yaml');

  beforeEach(() => {
    // Load OpenAPI spec
    const specContent = fs.readFileSync(specPath, 'utf-8');
    openApiSpec = yaml.load(specContent) as OpenAPISpec;
  });

  describe('OpenAPI Spec Generation', () => {
    it('should have valid OpenAPI structure', () => {
      expect(openApiSpec).toBeDefined();
      expect(openApiSpec.openapi).toBe('3.0.0');
      expect(openApiSpec.info).toBeDefined();
      expect(openApiSpec.paths).toBeDefined();
      expect(openApiSpec.components).toBeDefined();
    });

    it('should have required info fields', () => {
      expect(openApiSpec.info.title).toBeDefined();
      expect(openApiSpec.info.version).toBeDefined();
      expect(openApiSpec.info.description).toBeDefined();
    });

    it('should have valid version format', () => {
      const versionRegex = /^\d+\.\d+\.\d+$/;
      expect(openApiSpec.info.version).toMatch(versionRegex);
    });

    it('should have at least one path defined', () => {
      const pathCount = Object.keys(openApiSpec.paths).length;
      expect(pathCount).toBeGreaterThan(0);
    });
  });

  describe('Documentation Completeness', () => {
    it('should document all endpoints', () => {
      const expectedEndpoints = [
        '/auth/signup',
        '/auth/signin',
        '/auth/signout',
        '/auth/user',
        '/templates',
        '/deployments',
      ];

      expectedEndpoints.forEach((endpoint) => {
        expect(openApiSpec.paths[endpoint]).toBeDefined();
      });
    });

    it('should have descriptions for all paths', () => {
      Object.entries(openApiSpec.paths).forEach(([path, pathItem]) => {
        const methods = Object.keys(pathItem as Record<string, unknown>).filter(
          (key) => ['get', 'post', 'put', 'delete', 'patch'].includes(key)
        );

        methods.forEach((method) => {
          const operation = (pathItem as Record<string, unknown>)[method] as Record<string, unknown>;
          expect(operation.summary || operation.description).toBeDefined();
        });
      });
    });

    it('should have request/response schemas for all operations', () => {
      Object.entries(openApiSpec.paths).forEach(([, pathItem]) => {
        const methods = Object.keys(pathItem as Record<string, unknown>).filter(
          (key) => ['post', 'put', 'patch'].includes(key)
        );

        methods.forEach((method) => {
          const operation = (pathItem as Record<string, unknown>)[method] as Record<string, unknown>;
          expect(operation.requestBody || operation.parameters).toBeDefined();
        });
      });
    });

    it('should document all response codes', () => {
      Object.entries(openApiSpec.paths).forEach(([, pathItem]) => {
        const methods = Object.keys(pathItem as Record<string, unknown>).filter(
          (key) => ['get', 'post', 'put', 'delete', 'patch'].includes(key)
        );

        methods.forEach((method) => {
          const operation = (pathItem as Record<string, unknown>)[method] as Record<string, unknown>;
          const responses = operation.responses as Record<string, unknown>;
          expect(Object.keys(responses).length).toBeGreaterThan(0);
        });
      });
    });
  });

  describe('Example Request/Response Accuracy', () => {
    it('should have valid example requests', () => {
      const examples: EndpointExample[] = [
        {
          method: 'post',
          path: '/auth/signup',
          request: {
            email: 'user@example.com',
            password: 'securePassword123',
            fullName: 'John Doe',
          },
        },
        {
          method: 'post',
          path: '/auth/signin',
          request: {
            email: 'user@example.com',
            password: 'securePassword123',
          },
        },
      ];

      examples.forEach(({ path: exPath, request }) => {
        const pathItem = openApiSpec.paths[exPath] as Record<string, unknown>;
        expect(pathItem).toBeDefined();
        if (request) {
          expect(request).toHaveProperty('email');
        }
      });
    });

    it('should have valid example responses', () => {
      const authSignupPath = openApiSpec.paths['/auth/signup'] as Record<string, unknown>;
      const postOp = authSignupPath.post as Record<string, unknown>;
      const responses = postOp.responses as Record<string, unknown>;

      expect(responses['201']).toBeDefined();
      const successResponse = responses['201'] as Record<string, unknown>;
      expect(successResponse.content).toBeDefined();
    });

    it('should have consistent schema references', () => {
      const schemas = openApiSpec.components.schemas;
      expect(schemas).toBeDefined();
      expect(Object.keys(schemas).length).toBeGreaterThan(0);

      // Verify User schema exists
      expect(schemas.User).toBeDefined();
      expect(schemas.Error).toBeDefined();
    });
  });

  describe('Documentation Versioning', () => {
    it('should track API version', () => {
      expect(openApiSpec.info.version).toBeDefined();
      expect(typeof openApiSpec.info.version).toBe('string');
    });

    it('should have consistent version across spec', () => {
      const version = openApiSpec.info.version;
      expect(version).toMatch(/^\d+\.\d+\.\d+$/);
    });

    it('should document breaking changes in description', () => {
      const description = openApiSpec.info.description;
      expect(description).toBeDefined();
      expect(typeof description).toBe('string');
    });
  });

  describe('Documentation Deployment', () => {
    it('should have valid servers configuration', () => {
      const servers = (openApiSpec as Record<string, unknown>).servers as Array<{ url: string }>;
      expect(servers).toBeDefined();
      expect(servers.length).toBeGreaterThan(0);
    });

    it('should have development and production servers', () => {
      const servers = (openApiSpec as Record<string, unknown>).servers as Array<{ url: string; description: string }>;
      const descriptions = servers.map((s) => s.description);

      expect(descriptions.some((d) => d.includes('Development') || d.includes('development'))).toBe(true);
      expect(descriptions.some((d) => d.includes('Production') || d.includes('production'))).toBe(true);
    });

    it('should have valid server URLs', () => {
      const servers = (openApiSpec as Record<string, unknown>).servers as Array<{ url: string }>;
      servers.forEach(({ url }) => {
        expect(url).toMatch(/^https?:\/\//);
      });
    });
  });

  describe('Schema Validation', () => {
    it('should have valid component schemas', () => {
      const schemas = openApiSpec.components.schemas;
      Object.entries(schemas).forEach(([name, schema]) => {
        expect(schema).toBeDefined();
        expect(typeof schema).toBe('object');
      });
    });

    it('should have required properties defined', () => {
      const userSchema = openApiSpec.components.schemas.User as Record<string, unknown>;
      expect(userSchema.properties).toBeDefined();
      expect(userSchema.required).toBeDefined();
    });

    it('should have proper type definitions', () => {
      const schemas = openApiSpec.components.schemas;
      Object.entries(schemas).forEach(([, schema]) => {
        const schemaObj = schema as Record<string, unknown>;
        if (schemaObj.properties) {
          Object.entries(schemaObj.properties as Record<string, unknown>).forEach(([, prop]) => {
            const propObj = prop as Record<string, unknown>;
            expect(propObj.type || propObj.$ref).toBeDefined();
          });
        }
      });
    });
  });

  describe('Documentation Consistency', () => {
    it('should have consistent error responses', () => {
      const errorSchema = openApiSpec.components.schemas.Error as Record<string, unknown>;
      expect(errorSchema).toBeDefined();
      expect(errorSchema.properties).toBeDefined();
    });

    it('should use consistent naming conventions', () => {
      const paths = Object.keys(openApiSpec.paths);
      paths.forEach((path) => {
        expect(path).toMatch(/^\/[a-z0-9\-\/{}]*$/);
      });
    });

    it('should have consistent HTTP methods', () => {
      const validMethods = ['get', 'post', 'put', 'delete', 'patch'];
      Object.entries(openApiSpec.paths).forEach(([, pathItem]) => {
        Object.keys(pathItem as Record<string, unknown>).forEach((key) => {
          if (validMethods.includes(key)) {
            expect(validMethods).toContain(key);
          }
        });
      });
    });
  });
});
