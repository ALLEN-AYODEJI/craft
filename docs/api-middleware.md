# API Middleware Documentation

This document provides comprehensive guidance on CRAFT's API middleware components, including authentication, rate limiting, validation, and error handling.

## Table of Contents

- [Middleware Execution Order](#middleware-execution-order)
- [Authentication Middleware](#authentication-middleware)
- [Rate Limiting Middleware](#rate-limiting-middleware)
- [Validation Middleware](#validation-middleware)
- [Error Handling](#error-handling)
- [Troubleshooting](#troubleshooting)

## Middleware Execution Order

Middleware is applied in a specific order to ensure proper request handling:

```
Request
  ↓
1. Rate Limiting (withRateLimit)
  ↓
2. Validation (withValidation, withQueryValidation, withParamsValidation)
  ↓
3. Authentication (withAuth, withDeploymentAuth, withDomainTierCheck)
  ↓
4. Route Handler
  ↓
Response
```

**Key Points:**
- Rate limiting is checked first to prevent abuse before processing
- Validation occurs before authentication to fail fast on malformed requests
- Authentication is verified before accessing protected resources
- Each middleware layer can short-circuit the request with an error response

## Authentication Middleware

### Overview

Authentication middleware verifies user identity and manages authorization checks. CRAFT uses Supabase JWT tokens for stateless authentication.

### withAuth

Wraps a route handler with Supabase session authentication.

**Behavior:**
- Extracts JWT token from request headers
- Verifies token validity with Supabase
- Returns 401 if user is not authenticated
- Attaches user, supabase client, correlation ID, and logger to context

**Usage:**

```typescript
import { withAuth, type AuthedRouteContext } from '@/lib/api/with-auth';
import { NextRequest, NextResponse } from 'next/server';

const handler = async (req: NextRequest, ctx: AuthedRouteContext) => {
  const { user, supabase, log } = ctx;
  
  log.info('User accessed endpoint', { userId: user.id });
  
  return NextResponse.json({ userId: user.id });
};

export const GET = withAuth(handler);
```

**Response on Failure:**
```json
{
  "error": "Unauthorized"
}
```
Status: 401

### withDeploymentAuth

Extends `withAuth` with deployment ownership verification.

**Behavior:**
- Verifies user is authenticated
- Checks that the deployment belongs to the authenticated user
- Returns 403 if deployment doesn't belong to user
- Requires `params.id` to be the deployment ID

**Usage:**

```typescript
import { withDeploymentAuth } from '@/lib/api/with-auth';

const handler = async (req: NextRequest, ctx) => {
  const { params } = ctx;
  // Deployment with params.id is guaranteed to belong to user
  return NextResponse.json({ deploymentId: params.id });
};

export const GET = withDeploymentAuth(handler);
```

**Response on Failure:**
```json
{
  "error": "Forbidden"
}
```
Status: 403

### withDomainTierCheck

Extends `withDeploymentAuth` with subscription tier verification for custom domains.

**Behavior:**
- Verifies user is authenticated and owns deployment
- Checks subscription tier supports custom domains
- Returns 403 with upgrade prompt if tier is insufficient
- Free tier users cannot configure custom domains

**Usage:**

```typescript
import { withDomainTierCheck } from '@/lib/api/with-auth';

const handler = async (req: NextRequest, ctx) => {
  // User has Pro or Enterprise subscription
  return NextResponse.json({ customDomainConfigured: true });
};

export const POST = withDomainTierCheck(handler);
```

**Response on Failure:**
```json
{
  "error": "Custom domains require a Pro or Enterprise subscription.",
  "upgradeUrl": "/pricing"
}
```
Status: 403

## Rate Limiting Middleware

### Overview

Rate limiting prevents API abuse by restricting request frequency. CRAFT uses a sliding-window algorithm with in-memory storage.

### Configuration

```typescript
interface RateLimitConfig {
  limit: number;      // Max requests allowed
  window: number;     // Time window in milliseconds
}
```

### withRateLimit

Wraps a route handler with sliding-window rate limiting.

**Behavior:**
- Tracks requests per user/IP using a sliding window
- Returns 429 if limit exceeded
- Attaches rate limit headers to all responses
- Can be disabled via `RATE_LIMIT_DISABLED=true` for development

**Usage:**

```typescript
import { withRateLimit } from '@/lib/api/with-rate-limit';

const AUTH_RATE_LIMIT = { limit: 5, window: 60000 }; // 5 requests per minute

const handler = async (req: NextRequest, ctx) => {
  return NextResponse.json({ success: true });
};

export const POST = withRateLimit('auth:signin', AUTH_RATE_LIMIT)(handler);
```

**Rate Limit Headers:**
```
X-RateLimit-Limit: 5
X-RateLimit-Remaining: 2
X-RateLimit-Reset: 1640000000
Retry-After: 45
```

**Response on Failure:**
```json
{
  "error": "Too many requests. Please try again later.",
  "retryAfterMs": 45000,
  "resetAt": 1640000045000
}
```
Status: 429

### Common Rate Limit Configurations

```typescript
// Authentication endpoints
export const AUTH_RATE_LIMIT = { limit: 5, window: 60000 };

// API endpoints
export const API_RATE_LIMIT = { limit: 100, window: 60000 };

// Deployment endpoints
export const DEPLOYMENT_RATE_LIMIT = { limit: 10, window: 60000 };

// Payment endpoints
export const PAYMENT_RATE_LIMIT = { limit: 20, window: 60000 };
```

## Validation Middleware

### Overview

Validation middleware ensures request data conforms to expected schemas using Zod. Validation occurs before authentication to fail fast on malformed requests.

### withValidation

Validates JSON request body against a Zod schema.

**Behavior:**
- Parses request JSON body
- Validates against provided Zod schema
- Returns 400 with field-level errors if validation fails
- Attaches `validatedBody` to request for handler use

**Usage:**

```typescript
import { withValidation } from '@/lib/api/with-validation';
import { z } from 'zod';

const CreateDeploymentSchema = z.object({
  templateId: z.string().uuid(),
  name: z.string().min(1).max(100),
  customization: z.record(z.unknown()).optional(),
});

const handler = async (req, ctx) => {
  const { validatedBody } = req;
  // validatedBody is type-safe: { templateId: string; name: string; ... }
  return NextResponse.json({ created: true });
};

export const POST = withValidation(CreateDeploymentSchema)(handler);
```

**Response on Failure:**
```json
{
  "error": "Validation failed",
  "details": {
    "name": ["String must contain at least 1 character(s)"],
    "templateId": ["Invalid uuid"]
  }
}
```
Status: 400

### withQueryValidation

Validates URL search parameters against a Zod schema.

**Behavior:**
- Extracts query parameters from URL
- Validates against provided Zod schema
- Returns 400 with field-level errors if validation fails
- Attaches `validatedQuery` to request for handler use

**Usage:**

```typescript
import { withQueryValidation } from '@/lib/api/with-validation';
import { z } from 'zod';

const ListDeploymentsQuery = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(10),
  offset: z.coerce.number().int().min(0).default(0),
  status: z.enum(['pending', 'building', 'completed', 'failed']).optional(),
});

const handler = async (req, ctx) => {
  const { validatedQuery } = req;
  // validatedQuery is type-safe
  return NextResponse.json({ deployments: [] });
};

export const GET = withQueryValidation(ListDeploymentsQuery)(handler);
```

### withParamsValidation

Validates route parameters against a Zod schema.

**Behavior:**
- Validates route params (e.g., `[id]`)
- Returns 400 with field-level errors if validation fails
- Ensures type-safe params in handler

**Usage:**

```typescript
import { withParamsValidation } from '@/lib/api/with-validation';
import { z } from 'zod';

const DeploymentParamsSchema = z.object({
  id: z.string().uuid(),
});

const handler = async (req, ctx) => {
  const { params } = ctx;
  // params.id is guaranteed to be a valid UUID
  return NextResponse.json({ deploymentId: params.id });
};

export const GET = withParamsValidation(DeploymentParamsSchema)(handler);
```

## Composing Middleware

Middleware can be composed to create powerful request pipelines:

```typescript
import { withRateLimit } from '@/lib/api/with-rate-limit';
import { withValidation } from '@/lib/api/with-validation';
import { withAuth } from '@/lib/api/with-auth';
import { z } from 'zod';

const CreateDeploymentSchema = z.object({
  templateId: z.string().uuid(),
  name: z.string().min(1).max(100),
});

const DEPLOYMENT_RATE_LIMIT = { limit: 10, window: 60000 };

const handler = async (req, ctx) => {
  const { user, validatedBody } = req;
  // Request is rate-limited, validated, and authenticated
  return NextResponse.json({ created: true });
};

// Apply middleware in order: rate limit → validate → authenticate
export const POST = withRateLimit('deployments:create', DEPLOYMENT_RATE_LIMIT)(
  withValidation(CreateDeploymentSchema)(
    withAuth(handler)
  )
);
```

## Error Handling

### Error Response Format

All API errors follow a consistent format:

```json
{
  "error": "Human-readable error message",
  "details": {
    "field": ["Specific error for field"]
  },
  "correlationId": "uuid-for-tracking"
}
```

### Common HTTP Status Codes

| Status | Meaning | Middleware |
|--------|---------|------------|
| 400 | Bad Request | Validation |
| 401 | Unauthorized | Authentication |
| 403 | Forbidden | Authorization |
| 429 | Too Many Requests | Rate Limiting |
| 500 | Internal Server Error | Handler |

### Correlation IDs

Every request includes a correlation ID for tracking:

```typescript
const handler = async (req, ctx) => {
  const { correlationId, log } = ctx;
  
  log.info('Processing request', { correlationId });
  
  const response = NextResponse.json({ success: true });
  response.headers.set('X-Correlation-ID', correlationId);
  return response;
};
```

## Troubleshooting

### Issue: "Unauthorized" Error

**Symptoms:**
- All authenticated endpoints return 401
- User is logged in but cannot access protected routes

**Solutions:**
1. Verify JWT token is being sent in Authorization header:
   ```
   Authorization: Bearer <token>
   ```
2. Check token expiration:
   ```typescript
   const { data: { user } } = await supabase.auth.getUser();
   console.log(user?.aud); // Should be 'authenticated'
   ```
3. Verify Supabase credentials in environment variables
4. Check browser console for token errors

### Issue: "Forbidden" Error

**Symptoms:**
- Authenticated user gets 403 on deployment endpoints
- Custom domain configuration returns 403

**Solutions:**
1. For deployment ownership:
   - Verify deployment ID matches user's deployment
   - Check deployment exists in database
   
2. For custom domain tier:
   - Check user's subscription tier: `SELECT subscription_tier FROM profiles WHERE id = user_id`
   - Verify tier is 'pro' or 'enterprise'
   - Check Stripe subscription status

### Issue: "Too Many Requests" (429)

**Symptoms:**
- Requests fail with 429 status
- Retry-After header indicates wait time

**Solutions:**
1. Check rate limit configuration for endpoint
2. Implement exponential backoff in client:
   ```typescript
   const retryAfter = parseInt(response.headers.get('Retry-After') || '60');
   await new Promise(resolve => setTimeout(resolve, retryAfter * 1000));
   ```
3. For development, disable rate limiting:
   ```env
   RATE_LIMIT_DISABLED=true
   ```
4. Batch requests to reduce frequency

### Issue: "Validation Failed" (400)

**Symptoms:**
- Request returns 400 with validation errors
- Details show field-level errors

**Solutions:**
1. Check error details for specific field issues:
   ```json
   {
     "error": "Validation failed",
     "details": {
       "name": ["String must contain at least 1 character(s)"]
     }
   }
   ```
2. Verify request body matches schema:
   - Required fields are present
   - Data types are correct
   - String lengths are within limits
3. Use TypeScript types to catch errors early:
   ```typescript
   type CreateDeployment = z.infer<typeof CreateDeploymentSchema>;
   ```

### Issue: Middleware Not Applied

**Symptoms:**
- Middleware logic doesn't execute
- Requests bypass rate limiting or validation

**Solutions:**
1. Verify middleware is composed correctly:
   ```typescript
   // ✓ Correct
   export const POST = withRateLimit('key', config)(
     withValidation(schema)(handler)
   );
   
   // ✗ Wrong - middleware not applied
   export const POST = handler;
   ```
2. Check middleware order - rate limit should be outermost
3. Verify handler signature matches middleware expectations

### Issue: Correlation ID Not Tracking

**Symptoms:**
- Correlation ID changes between requests
- Cannot trace request through logs

**Solutions:**
1. Verify correlation ID is passed in request:
   ```typescript
   const correlationId = req.headers.get('X-Correlation-ID');
   ```
2. Check logger is using correlation ID:
   ```typescript
   const { log } = ctx;
   log.info('message', { correlationId });
   ```
3. Ensure response includes correlation ID header:
   ```typescript
   response.headers.set('X-Correlation-ID', correlationId);
   ```

## Best Practices

1. **Always compose middleware in correct order**: Rate limit → Validate → Authenticate
2. **Use type-safe validation**: Leverage Zod for compile-time and runtime safety
3. **Log with correlation IDs**: Track requests through the system
4. **Handle rate limits gracefully**: Implement exponential backoff in clients
5. **Test middleware independently**: Unit test each middleware layer
6. **Document custom middleware**: Explain behavior and configuration
7. **Monitor rate limit metrics**: Track 429 responses to identify abuse patterns
8. **Rotate secrets regularly**: Update API keys and tokens periodically

## Related Documentation

- [Authentication Guide](./authentication.md)
- [Rate Limiting Configuration](./rate-limiting.md)
- [Error Handling](./error-handling.md)
- [API Reference](../README.md#api-documentation)
