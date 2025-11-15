# COMPASSID Usage Limit Middleware System

## Overview
Complete usage tracking and enforcement system for COMPASSID's open-source transformation. Implements a three-tier access model: grandfathered (unlimited), institutional (partnership-based), and free tier (monthly quotas with credit overflow).

## Files Created
1. **`usageLimit.js`** (24KB) - Main middleware implementation
2. **`usageLimit.examples.md`** (11KB) - Comprehensive examples and response formats
3. **`usageLimit.README.md`** (this file) - Integration guide

## Architecture

### Database Schema (Required Migrations)
- **025_usage_tracking_system.sql** - Core usage_limits and usage_logs tables
- **026_credit_system.sql** - Credit purchases and transactions
- **027_institutional_partnerships.sql** - University/organization partnerships
- **028_update_users_for_open_source.sql** - User access_type and helper functions

### Key Database Tables
- `usage_limits` - Per-user monthly quotas and rate limits
- `usage_logs` - Complete audit trail of all AI feature usage
- `credit_transactions` - Credit purchases and deductions
- `credit_purchases` - Stripe payment records
- `institutional_partnerships` - Organization agreements
- `institutional_members` - User-to-partnership links

### Database Functions Used
- `get_effective_usage_limits(user_id)` - Returns applicable limits based on access type
- `deduct_credits_from_user(user_id, credits, usage_log_id, description)` - Atomic credit deduction
- `has_institutional_access(user_id)` - Check active institutional membership
- `get_institutional_limits(user_id)` - Get partnership-specific limits

## Features Implemented

### 1. Three-Tier Access Model

#### Grandfathered Users (Unlimited)
- All existing users before open-source launch
- Unlimited access to all AI features
- No rate limits or cooldowns applied
- Zero credit costs

#### Institutional Users (Partnership Limits)
- University/research organization members
- Custom limits per partnership (default: unlimited)
- Shared quota across all members
- No credit charges within quota

#### Free Tier Users (Monthly Quotas)
- New users get free monthly quotas:
  - AI Search: 20/month
  - AI Analysis: 5/month
  - AI Grant Writing: 3/month
  - AI Synthesis: 10/month
- Credit deduction when quota exceeded
- Quota resets monthly

### 2. Rate Limiting
- **Hourly limit**: 100 requests/hour (all features combined)
- **Daily limit**: 500 requests/day (all features combined)
- Automatic reset when window expires
- Applies to all user types (except grandfathered)

### 3. Cooldown Periods
- **AI Grant Writing**: 5 minutes between requests
- **AI Analysis**: 2 minutes between requests
- **AI Search**: No cooldown
- **AI Synthesis**: No cooldown
- Prevents system abuse and ensures fair usage

### 4. Credit System
When free quota is exceeded, credits are automatically deducted:
- AI Search: 1 credit
- AI Synthesis: 2 credits
- AI Analysis: 3 credits
- AI Grant Writing: 5 credits

### 5. Complete Audit Trail
Every request is logged to `usage_logs` with:
- User ID and feature type
- Credits used and whether it was free
- Request/response metadata
- IP address and user agent
- Status (success, failure, rate_limited, quota_exceeded)

## Implementation Guide

### Step 1: Database Setup
Ensure all migrations are applied:
```sql
-- Check if migrations are applied
SELECT * FROM pg_tables WHERE schemaname = 'public'
AND tablename IN ('usage_limits', 'usage_logs', 'credit_transactions', 'institutional_partnerships');

-- Verify database functions exist
SELECT proname FROM pg_proc WHERE proname IN (
  'get_effective_usage_limits',
  'deduct_credits_from_user',
  'has_institutional_access',
  'get_institutional_limits'
);
```

### Step 2: Import Middleware
```javascript
import { checkUsageLimit, getUsageStatus, attachUsageStatus } from './middleware/usageLimit.js';
```

### Step 3: Protect AI Endpoints
```javascript
// AI Search
router.post('/api/search/ai',
  authMiddleware,
  checkUsageLimit('ai_search'),
  searchController.aiSearch
);

// AI Analysis
router.post('/api/papers/:id/analyze',
  authMiddleware,
  checkUsageLimit('ai_analysis'),
  paperController.analyze
);

// AI Grant Writing
router.post('/api/grants/generate',
  authMiddleware,
  checkUsageLimit('ai_grant_writing'),
  grantController.generate
);

// AI Synthesis
router.post('/api/synthesis/create',
  authMiddleware,
  checkUsageLimit('ai_synthesis'),
  synthesisController.create
);
```

### Step 4: Add Usage Status Endpoint
```javascript
router.get('/api/users/me/usage', authMiddleware, async (req, res) => {
  try {
    const status = await getUsageStatus(req.user.id);
    res.json(status);
  } catch (error) {
    console.error('Failed to fetch usage status:', error);
    res.status(500).json({ error: 'Failed to fetch usage status' });
  }
});
```

### Step 5: (Optional) Attach Global Usage Status
```javascript
// In app.js or server.js
app.use(authMiddleware);
app.use(attachUsageStatus());

// Now req.usageStatus is available in all authenticated routes
```

## API Responses

### Success (Within Quota)
```
HTTP 200 OK
```
Middleware passes through to controller. No special handling needed.

### Success (Credits Deducted)
```
HTTP 200 OK
```
Credits deducted automatically. Logged to usage_logs with `was_free: false`.

### Error: Quota Exceeded
```json
HTTP 403 Forbidden
{
  "error": "Usage quota exceeded",
  "message": "You've exceeded your monthly AI search quota. Please purchase credits to continue.",
  "quotaLimit": 20,
  "quotaUsed": 20,
  "creditsNeeded": 1,
  "creditsAvailable": 0
}
```

### Error: Rate Limit Exceeded
```json
HTTP 429 Too Many Requests
{
  "error": "Rate limit exceeded",
  "message": "Hourly rate limit exceeded. You can make 100 requests per hour. Please try again in 23 minutes.",
  "retryAfter": 1380
}
```

### Error: Cooldown Active
```json
HTTP 429 Too Many Requests
{
  "error": "Cooldown period active",
  "message": "Please wait 5 minutes between grant writing requests to prevent system abuse.",
  "retryAfter": 300
}
```

### Error: Not Authenticated
```json
HTTP 401 Unauthorized
{
  "error": "Authentication required",
  "message": "You must be logged in to use AI features"
}
```

## Monitoring & Analytics

### Check User's Current Status
```javascript
const status = await getUsageStatus(userId);
console.log(status);
```

Returns:
```json
{
  "userId": "...",
  "accessType": "free|institutional|grandfathered",
  "isUnlimited": false,
  "credits": {
    "available": 45,
    "lifetimePurchased": 100
  },
  "usage": {
    "aiSearch": { "used": 12, "limit": 20, "remaining": 8 },
    "aiAnalysis": { "used": 5, "limit": 5, "remaining": 0 },
    "aiGrantWriting": { "used": 1, "limit": 3, "remaining": 2 },
    "aiSynthesis": { "used": 8, "limit": 10, "remaining": 2 }
  },
  "rateLimits": {
    "hourly": { "used": 23, "limit": 100, "resetAt": "..." },
    "daily": { "used": 156, "limit": 500, "resetAt": "..." }
  }
}
```

### SQL Analytics Queries

#### Users Approaching Quota
```sql
SELECT
  u.email,
  ul.ai_search_count,
  ul.ai_analysis_count,
  ul.available_credits,
  ul.current_period_end
FROM users u
JOIN usage_limits ul ON u.id = ul.user_id
WHERE u.access_type = 'free'
  AND (
    ul.ai_search_count >= 18
    OR ul.ai_analysis_count >= 4
    OR ul.ai_grant_writing_count >= 2
  )
  AND ul.available_credits < 10;
```

#### Daily Usage Summary
```sql
SELECT
  DATE(created_at) as date,
  feature_type,
  COUNT(*) as total_requests,
  SUM(CASE WHEN was_free THEN 1 ELSE 0 END) as free_requests,
  SUM(CASE WHEN was_free THEN 0 ELSE 1 END) as paid_requests,
  SUM(credits_used) as total_credits_used,
  COUNT(DISTINCT user_id) as unique_users
FROM usage_logs
WHERE created_at >= NOW() - INTERVAL '30 days'
GROUP BY DATE(created_at), feature_type
ORDER BY date DESC, feature_type;
```

#### Revenue from Credit Usage
```sql
SELECT
  DATE(created_at) as date,
  SUM(credits_used) as credits_consumed,
  COUNT(DISTINCT user_id) as paying_users,
  feature_type
FROM usage_logs
WHERE was_free = FALSE
  AND created_at >= NOW() - INTERVAL '30 days'
GROUP BY DATE(created_at), feature_type
ORDER BY date DESC;
```

## Configuration Constants

All limits are defined at the top of `usageLimit.js`:

```javascript
const FREE_TIER_LIMITS = {
  ai_search: 20,        // Modify to change monthly quota
  ai_analysis: 5,
  ai_grant_writing: 3,
  ai_synthesis: 10
};

const RATE_LIMITS = {
  hourly: 100,          // Modify rate limits here
  daily: 500
};

const COOLDOWN_PERIODS = {
  ai_search: 0,                // seconds
  ai_analysis: 2 * 60,         // 2 minutes
  ai_grant_writing: 5 * 60,    // 5 minutes
  ai_synthesis: 0
};

const CREDIT_COSTS = {
  ai_search: 1,         // Modify credit costs here
  ai_analysis: 3,
  ai_grant_writing: 5,
  ai_synthesis: 2
};
```

## Testing

### Manual Testing
```bash
# Test free tier user within quota
curl -X POST http://localhost:3000/api/search/ai \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"query": "machine learning"}'

# Test quota exceeded
# (Make 21 search requests in same month)

# Test rate limit
# (Make 101 requests in one hour)

# Test cooldown
# (Make 2 grant requests within 5 minutes)

# Get usage status
curl http://localhost:3000/api/users/me/usage \
  -H "Authorization: Bearer $TOKEN"
```

### Unit Tests (Recommended)
```javascript
import { checkUsageLimit, getUsageStatus } from './middleware/usageLimit.js';

describe('Usage Limit Middleware', () => {
  it('should allow grandfathered users unlimited access', async () => {
    // Test implementation
  });

  it('should enforce free tier monthly quotas', async () => {
    // Test implementation
  });

  it('should deduct credits when quota exceeded', async () => {
    // Test implementation
  });

  it('should enforce rate limits', async () => {
    // Test implementation
  });

  it('should enforce cooldown periods', async () => {
    // Test implementation
  });
});
```

## Error Handling

The middleware includes comprehensive error handling:
- Database connection failures don't block requests (fail-open for availability)
- All errors are logged with full context
- Usage is logged even when errors occur
- Transaction rollback for credit deduction failures

## Performance Considerations

### Database Queries
- All queries use indexes (user_id, feature_type, created_at)
- Usage status fetches use database functions with optimized queries
- Rate limit resets use UPDATE...WHERE to avoid table scans

### Caching Opportunities
Consider caching:
- `get_effective_usage_limits()` results (5 minute TTL)
- `usage_limits` rows (1 minute TTL)
- Institutional partnership status (10 minute TTL)

## Security Features

1. **User Isolation**: All queries filter by authenticated user_id
2. **SQL Injection Prevention**: Uses parameterized queries
3. **Rate Limit Enforcement**: Prevents abuse and DoS
4. **Cooldown Periods**: Prevents rapid-fire expensive operations
5. **Audit Trail**: Complete logging for security investigations
6. **Transaction Safety**: Credit deduction uses database transactions

## Future Enhancements

Consider implementing:
- [ ] Email notifications when approaching quota
- [ ] Admin dashboard for usage analytics
- [ ] Dynamic credit costs based on AI model usage
- [ ] Bulk credit packages with volume discounts
- [ ] Institutional usage reports for admins
- [ ] Credit expiration dates
- [ ] Referral credits for user growth
- [ ] Usage prediction and recommendations

## Support & Maintenance

### Monitoring Checklist
- [ ] Set up alerts for high rate limit hits
- [ ] Monitor credit deduction failures
- [ ] Track quota exceeded rates
- [ ] Monitor database function performance
- [ ] Set up usage analytics dashboard

### Monthly Tasks
- [ ] Review usage patterns
- [ ] Adjust quotas if needed
- [ ] Check for abuse patterns
- [ ] Verify credit costs align with actual costs
- [ ] Review grandfathered user list

## Contact & Questions

For questions or issues with the usage limit system:
1. Check `usageLimit.examples.md` for detailed examples
2. Review database migration files for schema details
3. Check logs in `usage_logs` table for debugging
4. Verify database functions are installed correctly

---

**Status**: ✅ Ready for production
**Version**: 1.0.0
**Last Updated**: 2025-11-14
**Database Dependencies**: Migrations 025, 026, 027, 028
