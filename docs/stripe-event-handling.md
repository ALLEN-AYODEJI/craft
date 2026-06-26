# Stripe Payment Service Event Handling

This document describes the Stripe webhook events handled by the CRAFT payment service and the corresponding database state updates.

## Stripe Event Handler Reference

| Event Type | Handler Action | DB State Update | Idempotent |
|---|---|---|---|
| `checkout.session.completed` | subscription_activated | Create subscription, set status=active | Yes |
| `customer.subscription.updated` | subscription_updated | Update subscription status field | Yes |
| `customer.subscription.deleted` | subscription_canceled | Set subscription status=canceled | Yes |
| `invoice.payment_failed` | subscription_past_due | Set subscription status=past_due | Yes |
| `invoice.payment_succeeded` | payment_recorded | Record payment, update period_end | Yes |
| `charge.refunded` | refund_processed | Record refund, update balance | Yes |
| `customer.created` | customer_registered | Create customer record | Yes |
| `customer.updated` | customer_info_synced | Update customer metadata | Yes |

## Event Handling Details

### checkout.session.completed

**Trigger**: User completes checkout and payment is authorized.

**Action**: Activate subscription for the user.

**Database Updates**:
- Create new `subscriptions` record
- Set `status = 'active'`
- Set `current_period_end` to 30 days from now
- Set `cancel_at_period_end = false`

**Idempotency**: Safe to replay. Subsequent events for the same session are ignored (session status is already 'complete').

### customer.subscription.updated

**Trigger**: Subscription status changes (e.g., from active to past_due).

**Action**: Update subscription status in database.

**Database Updates**:
- Update `subscriptions.status` to new status
- Update `subscriptions.updated_at` timestamp

**Possible Status Values**:
- `active`: Subscription is active and in good standing
- `past_due`: Payment failed; subscription is in grace period
- `trialing`: Subscription is in trial period
- `incomplete`: Subscription creation incomplete
- `canceled`: Subscription has been canceled

**Idempotency**: Safe to replay. Multiple updates with the same status are idempotent.

### customer.subscription.deleted

**Trigger**: Subscription is canceled and period end is reached.

**Action**: Mark subscription as canceled.

**Database Updates**:
- Set `subscriptions.status = 'canceled'`
- Set `subscriptions.canceled_at` timestamp

**Idempotency**: Safe to replay. Subscription is already canceled after first event.

### invoice.payment_failed

**Trigger**: Payment attempt fails (card declined, insufficient funds, etc.).

**Action**: Transition subscription to past_due state.

**Database Updates**:
- Set `subscriptions.status = 'past_due'`
- Record failed payment attempt in `payment_attempts` table
- Increment `failed_payment_count`

**Failure Reasons**:
- `card_declined`: Card was declined by issuer
- `insufficient_funds`: Account has insufficient funds
- `lost_card`: Card was reported lost
- `stolen_card`: Card was reported stolen
- `expired_card`: Card has expired
- `processing_error`: Stripe processing error

**Idempotency**: Safe to replay. Multiple failures for the same invoice are recorded separately but subscription status remains `past_due`.

### invoice.payment_succeeded

**Trigger**: Payment is successfully processed.

**Action**: Record payment and update subscription period.

**Database Updates**:
- Create `payments` record with amount, currency, timestamp
- Update `subscriptions.current_period_end` to 30 days from now
- Set `subscriptions.status = 'active'` (if was past_due)
- Increment `successful_payment_count`

**Idempotency**: Safe to replay. Duplicate payments are detected by invoice ID and not recorded twice.

### charge.refunded

**Trigger**: Payment is refunded (full or partial).

**Action**: Record refund and update customer balance.

**Database Updates**:
- Create `refunds` record with amount, reason, timestamp
- Update `payments.refunded_amount`
- Update customer account balance

**Refund Reasons**:
- `requested_by_customer`: Customer requested refund
- `duplicate`: Duplicate charge
- `fraudulent`: Fraudulent charge
- `general`: General refund

**Idempotency**: Safe to replay. Duplicate refunds are detected by refund ID.

## Edge Cases

### Card Decline

**Scenario**: User's card is declined during payment.

**Flow**:
1. `invoice.payment_failed` webhook received
2. Subscription status set to `past_due`
3. User is notified of payment failure
4. User can retry with different card or update payment method
5. On successful retry, `invoice.payment_succeeded` webhook received
6. Subscription status restored to `active`

**Database State**:
- Subscription remains in `past_due` until payment succeeds
- Failed payment attempt is recorded
- User cannot create new deployments while in `past_due`

### Insufficient Funds

**Scenario**: User's account has insufficient funds.

**Flow**:
1. `invoice.payment_failed` webhook received with reason `insufficient_funds`
2. Subscription status set to `past_due`
3. Automatic retry scheduled (Stripe retries for 3-4 days)
4. User is notified to add funds
5. On successful retry, subscription restored to `active`

**Database State**:
- Multiple `invoice.payment_failed` events may be received (one per retry)
- Subscription remains `past_due` until successful payment
- Each failed attempt is recorded

### 3D Secure Challenge

**Scenario**: Payment requires 3D Secure verification.

**Flow**:
1. Checkout session created with 3DS enabled
2. User redirected to 3DS verification page
3. User completes verification
4. `checkout.session.completed` webhook received
5. Subscription activated

**Database State**:
- Subscription status remains `incomplete` during 3DS challenge
- Once verified, status changes to `active`
- If verification fails, subscription remains `incomplete`

### Subscription Cancellation and Reactivation

**Scenario**: User cancels subscription but wants to reactivate later.

**Flow**:
1. User cancels subscription (sets `cancel_at_period_end = true`)
2. Subscription remains `active` until period end
3. At period end, `customer.subscription.deleted` webhook received
4. Subscription status set to `canceled`
5. User can create new subscription to reactivate

**Database State**:
- Canceled subscription is archived (not deleted)
- User can view cancellation history
- New subscription is created for reactivation (different subscription ID)

## Webhook Signature Verification

All webhooks must be verified using Stripe's signature:

```typescript
const signature = req.headers.get('stripe-signature');
const event = stripe.webhooks.constructEvent(
  body,
  signature,
  process.env.STRIPE_WEBHOOK_SECRET
);
```

**Never trust webhook data without signature verification.**

## Retry Logic

Stripe automatically retries failed webhooks:
- Initial attempt: Immediately
- Retry 1: 5 minutes later
- Retry 2: 30 minutes later
- Retry 3: 2 hours later
- Retry 4: 5 hours later
- Retry 5: 10 hours later

**Ensure all webhook handlers are idempotent** to safely handle retries.

## Testing

Comprehensive behavioral contract tests verify:
- All event types are handled correctly
- Database state is updated correctly
- Edge cases (card decline, insufficient funds, 3DS) are handled
- Subscription lifecycle (activation, cancellation, reactivation) works
- Webhook signature verification works
- Idempotency is maintained across retries

See `tests/payments/stripe-flow.test.ts` for test coverage.
