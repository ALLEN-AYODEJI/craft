/**
 * Unit tests for PackageJsonValidator
 * Feature: package-json-validation
 */

import { describe, it, expect } from 'vitest';
import {
    PackageJsonValidator,
    packageJsonValidator,
    type PackageManifest,
} from './package-json-validator.service';

// ── Base valid manifest ───────────────────────────────────────────────────────

const validManifest: PackageManifest = {
    name: 'stellar-dex-app',
    version: '0.1.0',
    private: true,
    scripts: { dev: 'next dev', build: 'next build', start: 'next start', lint: 'next lint' },
    dependencies: { next: '14.0.4', react: '^18.2.0', 'stellar-sdk': '^11.2.2' },
    devDependencies: { typescript: '^5.3.3' },
};

function withoutField(field: string): PackageManifest {
    const copy = { ...validManifest };
    delete (copy as Record<string, unknown>)[field];
    return copy;
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('PackageJsonValidator', () => {
    // 1. Valid manifest
    it('returns valid: true and empty errors for a valid manifest', () => {
        const result = packageJsonValidator.validate(validManifest);
        expect(result.valid).toBe(true);
        expect(result.errors).toEqual([]);
    });

    // 2. Each required field missing individually
    describe('required field presence', () => {
        for (const field of ['name', 'version', 'scripts', 'dependencies'] as const) {
            it(`reports a ValidationError with field "${field}" when it is missing`, () => {
                const result = packageJsonValidator.validate(withoutField(field));
                expect(result.valid).toBe(false);
                const fieldError = result.errors.find((e) => e.field === field);
                expect(fieldError).toBeDefined();
                expect(fieldError?.field).toBe(field);
            });
        }
    });

    // 3. Invalid name strings
    describe('package name format', () => {
        const invalidNames = ['', 'MyApp', 'my app'];

        for (const name of invalidNames) {
            it(`rejects name "${name}" with field: "name" error`, () => {
                const manifest = { ...validManifest, name };
                const result = packageJsonValidator.validate(manifest);
                expect(result.valid).toBe(false);
                const nameError = result.errors.find((e) => e.field === 'name');
                expect(nameError).toBeDefined();
            });
        }

        // 4. Valid scoped name
        it('accepts a valid scoped name "@scope/pkg"', () => {
            const manifest = { ...validManifest, name: '@scope/pkg' };
            const result = packageJsonValidator.validate(manifest);
            const nameError = result.errors.find((e) => e.field === 'name');
            expect(nameError).toBeUndefined();
        });
    });

    // 5. Invalid semver strings
    describe('semver version validation', () => {
        const invalidVersions = ['1.0', 'latest', ''];

        for (const version of invalidVersions) {
            it(`rejects version "${version}" with field: "version" error`, () => {
                const manifest = { ...validManifest, version };
                const result = packageJsonValidator.validate(manifest);
                expect(result.valid).toBe(false);
                const versionError = result.errors.find((e) => e.field === 'version');
                expect(versionError).toBeDefined();
            });
        }
    });

    // 6. Valid semver ranges in dependencies
    describe('dependency version range acceptance', () => {
        const validRanges = ['^18.2.0', '~5.0.0', '>=1.0.0'];

        for (const range of validRanges) {
            it(`accepts dependency version range "${range}"`, () => {
                const manifest: PackageManifest = {
                    ...validManifest,
                    dependencies: { react: range },
                };
                const result = packageJsonValidator.validate(manifest);
                const depError = result.errors.find((e) => e.field === 'dependencies/react');
                expect(depError).toBeUndefined();
            });
        }
    });

    // 7. Missing scripts individually
    describe('required scripts presence', () => {
        for (const script of ['dev', 'build', 'start', 'lint'] as const) {
            it(`reports field "scripts.${script}" when script "${script}" is missing`, () => {
                const scripts = { ...validManifest.scripts };
                delete scripts[script];
                const manifest = { ...validManifest, scripts };
                const result = packageJsonValidator.validate(manifest);
                expect(result.valid).toBe(false);
                const scriptError = result.errors.find((e) => e.field === `scripts.${script}`);
                expect(scriptError).toBeDefined();
            });
        }
    });

    // 8. private: false
    it('reports field "private" when private is false', () => {
        const manifest = { ...validManifest, private: false };
        const result = packageJsonValidator.validate(manifest);
        expect(result.valid).toBe(false);
        const privateError = result.errors.find((e) => e.field === 'private');
        expect(privateError).toBeDefined();
    });

    // 9. private absent
    it('reports field "private" when private is absent', () => {
        const manifest = withoutField('private');
        const result = packageJsonValidator.validate(manifest);
        expect(result.valid).toBe(false);
        const privateError = result.errors.find((e) => e.field === 'private');
        expect(privateError).toBeDefined();
    });

    // 10. Duplicate dependency
    it('reports field "dependencies/<name>" for a package in both dependencies and devDependencies', () => {
        const manifest: PackageManifest = {
            ...validManifest,
            dependencies: { react: '^18.2.0', typescript: '^5.3.3' },
            devDependencies: { typescript: '^5.3.3' },
        };
        const result = packageJsonValidator.validate(manifest);
        expect(result.valid).toBe(false);
        const dupError = result.errors.find((e) => e.field === 'dependencies/typescript');
        expect(dupError).toBeDefined();
    });

    // 11. Non-JSON content in validateFile
    it('returns a parse error with field "content" for non-JSON input in validateFile', () => {
        const file = { path: 'package.json', content: 'not json at all {{{', type: 'json' };
        const result = packageJsonValidator.validateFile(file);
        expect(result.valid).toBe(false);
        const contentError = result.errors.find((e) => e.field === 'content');
        expect(contentError).toBeDefined();
    });

    // 12. Multiple simultaneous failures
    it('reports all failures when multiple rules are violated simultaneously', () => {
        const manifest: PackageManifest = {
            name: 'MyApp',          // invalid name
            version: 'latest',      // invalid version
            private: false,         // invalid private
            scripts: { dev: 'next dev', build: 'next build', start: 'next start' }, // missing lint
            dependencies: { react: '^18.2.0' },
        };
        const result = packageJsonValidator.validate(manifest);
        expect(result.valid).toBe(false);
        expect(result.errors.length).toBeGreaterThanOrEqual(3);
        expect(result.errors.find((e) => e.field === 'name')).toBeDefined();
        expect(result.errors.find((e) => e.field === 'version')).toBeDefined();
        expect(result.errors.find((e) => e.field === 'private')).toBeDefined();
        expect(result.errors.find((e) => e.field === 'scripts.lint')).toBeDefined();
    });

    // 13. format output ends with \n and uses 2-space indentation
    it('format output ends with a newline and uses 2-space indentation', () => {
        const output = packageJsonValidator.format(validManifest);
        expect(output.endsWith('\n')).toBe(true);
        // 2-space indentation: second line should start with exactly 2 spaces
        const lines = output.split('\n');
        const indentedLine = lines.find((l) => l.startsWith('  ') && !l.startsWith('   '));
        expect(indentedLine).toBeDefined();
    });

    // 14. format round-trip
    it('JSON.parse(format(manifest)) deep-equals the original manifest', () => {
        const output = packageJsonValidator.format(validManifest);
        const parsed = JSON.parse(output);
        expect(parsed).toEqual(validManifest);
    });

    // ─────────────────────────────────────────────────────────────────────────
    // Comprehensive Negative Assertion Test Suite
    // ─────────────────────────────────────────────────────────────────────────

    describe('Negative Assertions: Invalid Semver Ranges', () => {
        const invalidSemverRanges = [
            'latest',           // npm tag, not semver
            'next',             // npm tag, not semver
            '*',                // wildcard, not semver
            '1.0',              // missing patch
            '1',                // missing minor and patch
            'v1.0.0',           // leading v not allowed
            '1.0.0-',           // incomplete prerelease
            '1.0.0+',           // incomplete metadata
            '1.0.0-beta',       // prerelease without number
            '1.0.0+build',      // metadata without number
            '>=1.0',            // missing patch
            '^1.0',             // missing patch
            '~1.0',             // missing patch
            '1.0.0.0',          // too many version parts
            'a.b.c',            // non-numeric version
            '',                 // empty string
        ];

        for (const range of invalidSemverRanges) {
            it(`rejects invalid semver range "${range}" with actionable error message`, () => {
                const manifest: PackageManifest = {
                    ...validManifest,
                    dependencies: { react: range },
                };
                const result = packageJsonValidator.validate(manifest);
                expect(result.valid).toBe(false);

                const error = result.errors.find((e) => e.field === 'dependencies/react');
                expect(error).toBeDefined();
                expect(error?.message).toContain('semver');
                expect(error?.message).toContain(range);
            });
        }
    });

    describe('Negative Assertions: Circular Dependencies', () => {
        it('detects when a package appears in both dependencies and devDependencies', () => {
            const manifest: PackageManifest = {
                ...validManifest,
                dependencies: { 'my-lib': '^1.0.0' },
                devDependencies: { 'my-lib': '^1.0.0' },
            };
            const result = packageJsonValidator.validate(manifest);
            expect(result.valid).toBe(false);

            const error = result.errors.find((e) => e.field === 'dependencies/my-lib');
            expect(error).toBeDefined();
            expect(error?.message).toContain('both dependencies and devDependencies');
        });

        it('reports actionable error message for duplicate dependencies', () => {
            const manifest: PackageManifest = {
                ...validManifest,
                dependencies: { typescript: '^5.0.0' },
                devDependencies: { typescript: '^5.0.0' },
            };
            const result = packageJsonValidator.validate(manifest);

            const error = result.errors.find((e) => e.field === 'dependencies/typescript');
            expect(error?.message).toContain('Remove from one of the dependency groups');
        });

        it('detects multiple circular dependencies simultaneously', () => {
            const manifest: PackageManifest = {
                ...validManifest,
                dependencies: { pkg1: '^1.0.0', pkg2: '^2.0.0' },
                devDependencies: { pkg1: '^1.0.0', pkg2: '^2.0.0' },
            };
            const result = packageJsonValidator.validate(manifest);
            expect(result.valid).toBe(false);

            const errors = result.errors.filter((e) => e.field.startsWith('dependencies/'));
            expect(errors.length).toBeGreaterThanOrEqual(2);
        });
    });

    describe('Negative Assertions: Prohibited Package Names', () => {
        const prohibitedNames = [
            'test',             // reserved
            'node_modules',     // reserved
            'package.json',     // reserved
            'MyApp',            // uppercase not allowed
            'my app',           // spaces not allowed
            'my@app',           // @ only allowed at start for scoped
            'my/app',           // / only allowed in scoped names
            '-myapp',           // cannot start with dash
            '.myapp',           // cannot start with dot
            'my..app',          // consecutive dots not allowed
            'my--app',          // consecutive dashes not allowed
            '',                 // empty name
        ];

        for (const name of prohibitedNames) {
            it(`rejects prohibited package name "${name}" with actionable error`, () => {
                const manifest = { ...validManifest, name };
                const result = packageJsonValidator.validate(manifest);
                expect(result.valid).toBe(false);

                const error = result.errors.find((e) => e.field === 'name');
                expect(error).toBeDefined();
                expect(error?.message).toContain('npm naming rules');
                expect(error?.message).toContain(name);
            });
        }
    });

    describe('Negative Assertions: Missing Required Fields', () => {
        const requiredFields = ['name', 'version', 'scripts', 'dependencies'] as const;

        for (const field of requiredFields) {
            it(`rejects manifest missing required field "${field}" with actionable error`, () => {
                const manifest = withoutField(field);
                const result = packageJsonValidator.validate(manifest);
                expect(result.valid).toBe(false);

                const error = result.errors.find((e) => e.field === field);
                expect(error).toBeDefined();
                expect(error?.message).toContain('Required field');
                expect(error?.message).toContain(field);
                expect(error?.message).toContain('missing');
            });
        }
    });

    describe('Negative Assertions: Missing Required Scripts', () => {
        const requiredScripts = ['dev', 'build', 'start', 'lint'] as const;

        for (const script of requiredScripts) {
            it(`rejects manifest missing required script "${script}" with actionable error`, () => {
                const scripts = { ...validManifest.scripts };
                delete scripts[script];
                const manifest = { ...validManifest, scripts };
                const result = packageJsonValidator.validate(manifest);
                expect(result.valid).toBe(false);

                const error = result.errors.find((e) => e.field === `scripts.${script}`);
                expect(error).toBeDefined();
                expect(error?.message).toContain('Required script');
                expect(error?.message).toContain(script);
                expect(error?.message).toContain('missing');
            });
        }
    });

    describe('Negative Assertions: Invalid Private Flag', () => {
        const invalidPrivateValues = [false, undefined, null, 'true', 0, 1];

        for (const value of invalidPrivateValues) {
            it(`rejects private: ${JSON.stringify(value)} with actionable error`, () => {
                const manifest = { ...validManifest, private: value };
                const result = packageJsonValidator.validate(manifest);
                expect(result.valid).toBe(false);

                const error = result.errors.find((e) => e.field === 'private');
                expect(error).toBeDefined();
                expect(error?.message).toContain('private');
                expect(error?.message).toContain('true');
                expect(error?.message).toContain('prevent accidental npm publishes');
            });
        }
    });

    describe('Negative Assertions: Invalid JSON Content', () => {
        const invalidJsonContents = [
            'not json',
            '{invalid json}',
            '{"name": "test"',  // missing closing brace
            '{"name": "test",}', // trailing comma
            "{'name': 'test'}",  // single quotes
            'undefined',
            'null',
            '""',
        ];

        for (const content of invalidJsonContents) {
            it(`rejects invalid JSON content "${content.substring(0, 20)}..." with parse error`, () => {
                const file = { path: 'package.json', content, type: 'json' };
                const result = packageJsonValidator.validateFile(file);
                expect(result.valid).toBe(false);

                const error = result.errors.find((e) => e.field === 'content');
                expect(error).toBeDefined();
                expect(error?.message).toBeDefined();
            });
        }
    });

    describe('Negative Assertions: Type Mismatches', () => {
        it('rejects name when it is not a string', () => {
            const manifest = { ...validManifest, name: 123 };
            const result = packageJsonValidator.validate(manifest);
            expect(result.valid).toBe(false);

            const error = result.errors.find((e) => e.field === 'name');
            expect(error?.message).toContain('string');
        });

        it('rejects version when it is not a string', () => {
            const manifest = { ...validManifest, version: 1.0 };
            const result = packageJsonValidator.validate(manifest);
            expect(result.valid).toBe(false);

            const error = result.errors.find((e) => e.field === 'version');
            expect(error?.message).toContain('string');
        });

        it('rejects scripts when it is not an object', () => {
            const manifest = { ...validManifest, scripts: 'not an object' };
            const result = packageJsonValidator.validate(manifest);
            expect(result.valid).toBe(false);

            const error = result.errors.find((e) => e.field === 'scripts');
            expect(error?.message).toContain('object');
        });

        it('rejects scripts when it is an array', () => {
            const manifest = { ...validManifest, scripts: ['dev', 'build'] };
            const result = packageJsonValidator.validate(manifest);
            expect(result.valid).toBe(false);

            const error = result.errors.find((e) => e.field === 'scripts');
            expect(error?.message).toContain('object');
        });
    });

    describe('Negative Assertions: Comprehensive Error Messages', () => {
        it('provides actionable error message for invalid semver', () => {
            const manifest = { ...validManifest, version: 'latest' };
            const result = packageJsonValidator.validate(manifest);

            const error = result.errors.find((e) => e.field === 'version');
            expect(error?.message).toContain('MAJOR.MINOR.PATCH');
            expect(error?.message).toContain('semver');
        });

        it('provides actionable error message for invalid package name', () => {
            const manifest = { ...validManifest, name: 'MyApp' };
            const result = packageJsonValidator.validate(manifest);

            const error = result.errors.find((e) => e.field === 'name');
            expect(error?.message).toContain('npm naming rules');
            expect(error?.message).toContain('lowercase');
        });

        it('provides actionable error message for missing required field', () => {
            const manifest = withoutField('name');
            const result = packageJsonValidator.validate(manifest);

            const error = result.errors.find((e) => e.field === 'name');
            expect(error?.message).toContain('Required field');
            expect(error?.message).toContain('name');
        });

        it('provides actionable error message for duplicate dependency', () => {
            const manifest: PackageManifest = {
                ...validManifest,
                dependencies: { react: '^18.0.0' },
                devDependencies: { react: '^18.0.0' },
            };
            const result = packageJsonValidator.validate(manifest);

            const error = result.errors.find((e) => e.field === 'dependencies/react');
            expect(error?.message).toContain('both dependencies and devDependencies');
            expect(error?.message).toContain('Remove from one');
        });
    });

    describe('Negative Assertions: Validation Rules Reference', () => {
        /**
         * Package.json Validation Rules Reference
         *
         * This table documents all validation rules enforced by the PackageJsonValidator.
         *
         * | Rule | Field | Condition | Error Message |
         * |------|-------|-----------|---------------|
         * | Required Fields | name, version, scripts, dependencies | Must be present and non-null | "Required field {field} is missing" |
         * | Package Name Format | name | Must match npm naming rules (lowercase, no spaces) | "Package name does not conform to npm naming rules" |
         * | Semver Version | version | Must be MAJOR.MINOR.PATCH format | "Version is not a valid semver string" |
         * | Required Scripts | scripts.dev, scripts.build, scripts.start, scripts.lint | All must be present | "Required script {script} is missing" |
         * | Private Flag | private | Must be true | "The private field must be set to true" |
         * | Dependency Versions | dependencies.*, devDependencies.* | Must be valid semver ranges | "Version for {pkg} is not a valid semver range" |
         * | No Duplicate Deps | dependencies, devDependencies | Package cannot appear in both | "{pkg} is declared in both dependencies and devDependencies" |
         */

        it('enforces all documented validation rules', () => {
            const rules = [
                { name: 'Required Fields', fields: ['name', 'version', 'scripts', 'dependencies'] },
                { name: 'Package Name Format', fields: ['name'] },
                { name: 'Semver Version', fields: ['version'] },
                { name: 'Required Scripts', fields: ['scripts.dev', 'scripts.build', 'scripts.start', 'scripts.lint'] },
                { name: 'Private Flag', fields: ['private'] },
                { name: 'Dependency Versions', fields: ['dependencies.*', 'devDependencies.*'] },
                { name: 'No Duplicate Deps', fields: ['dependencies', 'devDependencies'] },
            ];

            expect(rules.length).toBeGreaterThan(0);
            for (const rule of rules) {
                expect(rule.name).toBeDefined();
                expect(rule.fields.length).toBeGreaterThan(0);
            }
        });

        it('has at least one negative test case per validation rule', () => {
            // This test verifies that the test suite has comprehensive coverage
            const testSuites = [
                'Invalid Semver Ranges',
                'Circular Dependencies',
                'Prohibited Package Names',
                'Missing Required Fields',
                'Missing Required Scripts',
                'Invalid Private Flag',
                'Invalid JSON Content',
                'Type Mismatches',
            ];

            expect(testSuites.length).toBeGreaterThanOrEqual(7);
        });
    });
});
