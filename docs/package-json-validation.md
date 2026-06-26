# Package.json Validation Rules

This document describes the validation rules enforced by the PackageJsonValidator service and provides guidance on fixing validation errors.

## Validation Rules Reference

| Rule | Field | Condition | Error Message |
|------|-------|-----------|---------------|
| Required Fields | name, version, scripts, dependencies | Must be present and non-null | "Required field {field} is missing" |
| Package Name Format | name | Must match npm naming rules (lowercase, no spaces, no uppercase) | "Package name does not conform to npm naming rules" |
| Semver Version | version | Must be MAJOR.MINOR.PATCH format (e.g., 1.0.0) | "Version is not a valid semver string (expected MAJOR.MINOR.PATCH)" |
| Required Scripts | scripts.dev, scripts.build, scripts.start, scripts.lint | All four scripts must be present | "Required script {script} is missing" |
| Private Flag | private | Must be exactly true (boolean) | "The private field must be set to true to prevent accidental npm publishes" |
| Dependency Versions | dependencies.*, devDependencies.* | Must be valid semver ranges (^, ~, >=, >, <=, <, or exact) | "Version for {pkg} is not a valid semver range" |
| No Duplicate Deps | dependencies, devDependencies | Package cannot appear in both groups | "{pkg} is declared in both dependencies and devDependencies" |

## Actionable Error Messages

All error messages are designed to be actionable and tell the user how to fix the issue:

### Invalid Semver Version

**Error**: "Version 'latest' is not a valid semver string (expected MAJOR.MINOR.PATCH)"

**Fix**: Use semantic versioning format: `MAJOR.MINOR.PATCH`

**Examples**:
- ✅ `"1.0.0"` - Exact version
- ✅ `"2.3.4"` - Exact version
- ❌ `"latest"` - npm tag, not semver
- ❌ `"1.0"` - Missing patch version
- ❌ `"v1.0.0"` - Leading 'v' not allowed

### Invalid Package Name

**Error**: "Package name 'MyApp' does not conform to npm naming rules"

**Fix**: Use lowercase letters, numbers, hyphens, and underscores. Scoped packages use `@scope/name` format.

**Examples**:
- ✅ `"my-app"` - Lowercase with hyphen
- ✅ `"my_app"` - Lowercase with underscore
- ✅ `"@scope/my-app"` - Scoped package
- ❌ `"MyApp"` - Uppercase not allowed
- ❌ `"my app"` - Spaces not allowed
- ❌ `"-myapp"` - Cannot start with hyphen

### Missing Required Field

**Error**: "Required field 'name' is missing"

**Fix**: Add the required field to package.json

**Required Fields**:
- `name` - Package name
- `version` - Semantic version
- `scripts` - Build scripts object
- `dependencies` - Production dependencies object

**Example**:
```json
{
  "name": "my-app",
  "version": "1.0.0",
  "scripts": { ... },
  "dependencies": { ... }
}
```

### Missing Required Script

**Error**: "Required script 'build' is missing"

**Fix**: Add the required script to the scripts object

**Required Scripts**:
- `dev` - Development server
- `build` - Production build
- `start` - Start production server
- `lint` - Code linting

**Example**:
```json
{
  "scripts": {
    "dev": "next dev",
    "build": "next build",
    "start": "next start",
    "lint": "next lint"
  }
}
```

### Invalid Private Flag

**Error**: "The 'private' field must be set to true to prevent accidental npm publishes"

**Fix**: Set `private: true` to prevent accidental publication to npm registry

**Example**:
```json
{
  "private": true
}
```

**Why**: Generated applications should not be published to npm. Setting `private: true` prevents accidental publication.

### Invalid Dependency Version

**Error**: "Version 'latest' for 'react' is not a valid semver range"

**Fix**: Use valid semver ranges

**Valid Semver Ranges**:
- `"1.0.0"` - Exact version
- `"^1.0.0"` - Compatible with version (allows minor/patch updates)
- `"~1.0.0"` - Approximately version (allows patch updates only)
- `">=1.0.0"` - Greater than or equal
- `">1.0.0"` - Greater than
- `"<=1.0.0"` - Less than or equal
- `"<1.0.0"` - Less than

**Invalid Ranges**:
- ❌ `"latest"` - npm tag, not semver
- ❌ `"next"` - npm tag, not semver
- ❌ `"1.0"` - Missing patch version
- ❌ `"*"` - Wildcard, not semver

### Duplicate Dependency

**Error**: "'react' is declared in both dependencies and devDependencies"

**Fix**: Remove the package from one of the dependency groups

**Explanation**:
- `dependencies` - Packages needed in production
- `devDependencies` - Packages needed only for development

A package should only appear in one group.

**Example**:
```json
{
  "dependencies": {
    "react": "^18.0.0"
  },
  "devDependencies": {
    "typescript": "^5.0.0"
  }
}
```

## Validation Error Paths

### Error Field Naming

Error messages use dot notation to identify the exact field with the error:

- `name` - Package name field
- `version` - Version field
- `scripts` - Scripts object
- `scripts.dev` - Specific script
- `dependencies/react` - Specific dependency
- `devDependencies/typescript` - Specific dev dependency
- `content` - JSON parsing error

### Example Error Response

```json
{
  "valid": false,
  "errors": [
    {
      "field": "name",
      "message": "Package name 'MyApp' does not conform to npm naming rules"
    },
    {
      "field": "version",
      "message": "Version 'latest' is not a valid semver string (expected MAJOR.MINOR.PATCH)"
    },
    {
      "field": "scripts.build",
      "message": "Required script 'build' is missing"
    },
    {
      "field": "dependencies/react",
      "message": "Version 'latest' for 'react' is not a valid semver range"
    }
  ]
}
```

## Testing

Comprehensive negative assertion tests verify:
- All validation rules are enforced
- Invalid semver ranges are rejected
- Circular dependencies are detected
- Prohibited package names are rejected
- Missing required fields are detected
- Missing required scripts are detected
- Invalid private flag is detected
- Invalid JSON content is rejected
- Type mismatches are detected
- Error messages are actionable

See `services/package-json-validator.service.test.ts` for test coverage.

## Implementation Notes

- Validation runs in a single pass (all errors are collected)
- No external dependencies (regex-based validation)
- Error messages are designed to be user-friendly and actionable
- Validation is strict to ensure generated packages are production-ready
- All checks are synchronous (no async operations)
