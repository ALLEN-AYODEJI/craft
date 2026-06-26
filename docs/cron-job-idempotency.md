# Cron Job Idempotency Guarantees

This document describes the idempotency contract for CRAFT's cron job routes and the testing infrastructure used to verify it.

## Idempotency Definition

A cron job is **idempotent** if:

1. **Same Input → Same Output**: Executing the same cron job with identical parameters produces identical results.
2. **No Duplicate Side Effects**: Executing the same cron job multiple times does not create duplicate database writes or trigger duplicate notifications.
3. **Order Independence**: The order of execution does not affect the final state.

## Cron Routes

### Health Check Route (`/api/cron/health-check`)

**Schedule**: Every 5 minutes (configurable in `vercel.json`)

**Behavior**:
- Checks the health status of all active deployments
- Records health metrics (response time, status code, error details)
- Updates deployment health status in the database
- Triggers alerts if deployments become unhealthy

**Idempotency Guarantee**:
- Multiple invocations at the same time produce identical health check results
- No duplicate health check records are created
- Overlapping executions do not cause race conditions

**Implementation**:
- Each invocation is independent and stateless
- Health checks are read-only operations (no state mutations during check)
- Database writes are idempotent (updates, not inserts)

### Sync Deployment Status Route (`/api/cron/sync-deployment-status`)

**Schedule**: Every 10 minutes

**Behavior**:
- Syncs deployment status from Vercel to the database
- Updates deployment URLs and status fields
- Marks stale deployments as inactive

**Idempotency Guarantee**:
- Syncing the same deployment multiple times produces the same result
- No duplicate sync records are created
- Concurrent syncs of the same deployment are safe

## Testing Infrastructure

### Time-Travel Testing with Fake Timers

The test suite uses `vi.useFakeTimers()` to control time and verify idempotency across schedule boundaries:

```typescript
vi.useFakeTimers();
vi.setSystemTime(new Date('2024-01-15T10:00:00Z'));

// Execute cron job
const response = await GET(createCronRequest());

// Advance time to next schedule window
vi.advanceTimersByTime(300000); // 5 minutes

// Execute again
const response2 = await GET(createCronRequest());

// Results should be identical
expect(response).toEqual(response2);

vi.useRealTimers();
```

### Overlapping Invocation Testing

Tests verify that concurrent executions do not cause issues:

```typescript
// Simulate two overlapping invocations
const [response1, response2] = await Promise.all([
  GET(createCronRequest()),
  GET(createCronRequest()),
]);

// Both should succeed
expect(response1.status).toBe(200);
expect(response2.status).toBe(200);

// No duplicate side effects
expect(mockService.calls).toBe(2); // Each called once
```

### Schedule Boundary Testing

Tests verify correct behavior at schedule boundaries:

- **Exactly on schedule**: Executes normally
- **Slightly before schedule**: Executes normally
- **Slightly after schedule**: Executes normally
- **Across schedule windows**: Maintains idempotency

## Implementation Guidelines

When implementing new cron routes, follow these patterns:

### 1. Stateless Execution

```typescript
export async function GET(req: NextRequest) {
  // No shared state between invocations
  const results = await service.performCheck();
  return NextResponse.json(results);
}
```

### 2. Idempotent Database Operations

Use `UPDATE` instead of `INSERT` where possible:

```typescript
// ✅ Good: Idempotent update
await db.deployments.update(id, { status: 'healthy' });

// ❌ Bad: Creates duplicate records
await db.health_checks.insert({ deploymentId: id, status: 'healthy' });
```

### 3. Deduplication for Side Effects

If side effects (emails, webhooks) must be triggered, use deduplication:

```typescript
// Only send alert if status changed
const oldStatus = await db.deployments.get(id).status;
const newStatus = await checkHealth(id);

if (oldStatus !== newStatus) {
  await sendAlert(id, newStatus);
}
```

### 4. Error Handling

Ensure errors don't leave the system in an inconsistent state:

```typescript
try {
  const results = await service.check();
  await db.updateResults(results); // Atomic operation
  return NextResponse.json({ success: true, results });
} catch (error) {
  // Rollback or ensure no partial state
  return NextResponse.json({ error: error.message }, { status: 500 });
}
```

## Verification Checklist

Before deploying a new cron route:

- [ ] Route is stateless (no shared variables between invocations)
- [ ] Database operations are idempotent (UPDATE, not INSERT)
- [ ] Concurrent executions are safe (no race conditions)
- [ ] Time-travel tests pass (fake timers verify schedule boundaries)
- [ ] Overlapping invocation tests pass (concurrent execution is safe)
- [ ] Error recovery tests pass (transient errors don't corrupt state)
- [ ] Documentation describes idempotency guarantees

## Monitoring

Monitor cron job execution in production:

1. **Execution Frequency**: Verify cron runs at expected intervals
2. **Success Rate**: Track percentage of successful executions
3. **Execution Time**: Monitor how long each cron job takes
4. **Error Rate**: Alert if error rate exceeds threshold
5. **Duplicate Detection**: Monitor for duplicate side effects

## References

- [Vercel Cron Jobs](https://vercel.com/docs/cron-jobs)
- [Idempotency in Distributed Systems](https://en.wikipedia.org/wiki/Idempotence)
- [Time-Travel Testing with Vitest](https://vitest.dev/api/vi.html#vi-usefaketimers)
