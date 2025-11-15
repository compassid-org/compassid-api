# Usage Limit Middleware - Examples & Response Formats

## Overview
The usage limit middleware enforces fair use policies for COMPASSID's open-source transformation, implementing a free tier with optional credit-based usage for power users.

## Access Tiers

### 1. Grandfathered Users (Unlimited)
Existing users before the open-source launch get unlimited access to all features.

### 2. Institutional Users (Partnership Limits)
University/organization members get access based on their institutional partnership agreement.

### 3. Free Tier Users (Monthly Quotas)
New users get free monthly quotas:
- AI Search: 20 requests/month
- AI Analysis: 5 requests/month
- AI Grant Writing: 3 requests/month
- AI Synthesis: 10 requests/month

Once quota is exceeded, users can purchase credits to continue.

## Rate Limits (All Users)
- 100 requests per hour
- 500 requests per day

## Cooldown Periods
- AI Grant Writing: 5 minutes between requests
- AI Analysis: 2 minutes between requests
- AI Search: No cooldown
- AI Synthesis: No cooldown

## Credit Costs
When free quota is exceeded, credits are deducted:
- AI Search: 1 credit
- AI Synthesis: 2 credits
- AI Analysis: 3 credits
- AI Grant Writing: 5 credits

---

## Implementation Examples

### Example 1: Protect AI Search Endpoint
```javascript
import express from 'express';
import { checkUsageLimit } from './middleware/usageLimit.js';
import authMiddleware from './middleware/auth.js';

const router = express.Router();

router.post('/api/search/ai',
  authMiddleware,
  checkUsageLimit('ai_search'),
  async (req, res) => {
    // If we get here, usage limit check passed
    const results = await aiSearchService.search(req.body.query);
    res.json({ results });
  }
);
```

### Example 2: Get User's Current Usage Status
```javascript
import { getUsageStatus } from './middleware/usageLimit.js';

router.get('/api/users/me/usage', authMiddleware, async (req, res) => {
  try {
    const status = await getUsageStatus(req.user.id);
    res.json(status);
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch usage status' });
  }
});
```

### Example 3: Attach Usage Status Globally
```javascript
import { attachUsageStatus } from './middleware/usageLimit.js';

// Apply after authentication to make req.usageStatus available
app.use(authMiddleware);
app.use(attachUsageStatus());

// Now all authenticated routes can access req.usageStatus
router.get('/api/dashboard', (req, res) => {
  res.json({
    user: req.user,
    usage: req.usageStatus  // Automatically attached
  });
});
```

### Example 4: Manual Logging (Background Jobs)
```javascript
import { logUsage } from './middleware/usageLimit.js';

async function backgroundSynthesis(userId, papers) {
  // Perform synthesis
  const result = await synthesizePapers(papers);

  // Log the usage
  await logUsage(
    userId,
    'ai_synthesis',
    0,
    true,
    'success',
    null,  // No request object in background job
    {
      papers_count: papers.length,
      synthesis_length: result.length,
      background_job: true
    }
  );

  return result;
}
```

---

## Response Formats

### Success Response (Within Quota)
Request proceeds to the controller. No special response from middleware.

```javascript
// Middleware passes through, controller returns normal response
{
  "results": [...],
  "message": "Search completed successfully"
}
```

### Success Response (Credits Deducted)
Request proceeds after deducting credits.

```javascript
// Middleware passes through, but credits were charged
// Controller returns normal response
{
  "results": [...],
  "creditsUsed": 3
}
```

### Error: Quota Exceeded (No Credits)
HTTP 403 Forbidden

```json
{
  "error": "Usage quota exceeded",
  "message": "You've exceeded your monthly AI analysis quota. Please purchase credits to continue.",
  "quotaLimit": 5,
  "quotaUsed": 5,
  "creditsNeeded": 3,
  "creditsAvailable": 0
}
```

### Error: Rate Limit Exceeded (Hourly)
HTTP 429 Too Many Requests

```json
{
  "error": "Rate limit exceeded",
  "message": "Hourly rate limit exceeded. You can make 100 requests per hour. Please try again in 23 minutes.",
  "retryAfter": 1380
}
```

### Error: Rate Limit Exceeded (Daily)
HTTP 429 Too Many Requests

```json
{
  "error": "Rate limit exceeded",
  "message": "Daily rate limit exceeded. You can make 500 requests per day. Please try again in 8 hours.",
  "retryAfter": 28800
}
```

### Error: Cooldown Active
HTTP 429 Too Many Requests

```json
{
  "error": "Cooldown period active",
  "message": "Please wait 3 minutes between grant writing requests to prevent system abuse.",
  "retryAfter": 180
}
```

### Error: Institutional Quota Exceeded
HTTP 403 Forbidden

```json
{
  "error": "Institutional quota exceeded",
  "message": "Your institutional partnership has reached its monthly AI analysis limit of 1000 requests. Please contact your institutional administrator."
}
```

### Error: Authentication Required
HTTP 401 Unauthorized

```json
{
  "error": "Authentication required",
  "message": "You must be logged in to use AI features"
}
```

---

## Usage Status Response Format

```json
{
  "userId": "550e8400-e29b-41d4-a716-446655440000",
  "accessType": "free",
  "isUnlimited": false,
  "credits": {
    "available": 45,
    "lifetimePurchased": 100
  },
  "currentPeriod": {
    "start": "2025-11-01T00:00:00.000Z",
    "end": "2025-12-01T00:00:00.000Z"
  },
  "usage": {
    "aiSearch": {
      "used": 12,
      "limit": 20,
      "remaining": 8
    },
    "aiAnalysis": {
      "used": 5,
      "limit": 5,
      "remaining": 0
    },
    "aiGrantWriting": {
      "used": 1,
      "limit": 3,
      "remaining": 2
    },
    "aiSynthesis": {
      "used": 8,
      "limit": 10,
      "remaining": 2
    }
  },
  "rateLimits": {
    "hourly": {
      "used": 23,
      "limit": 100,
      "resetAt": "2025-11-14T15:00:00.000Z"
    },
    "daily": {
      "used": 156,
      "limit": 500,
      "resetAt": "2025-11-15T00:00:00.000Z"
    }
  }
}
```

### Grandfathered User Status
```json
{
  "userId": "550e8400-e29b-41d4-a716-446655440001",
  "accessType": "grandfathered",
  "isUnlimited": true,
  "usage": {
    "aiSearch": {
      "used": 142,
      "limit": -1,
      "remaining": "unlimited"
    },
    "aiAnalysis": {
      "used": 45,
      "limit": -1,
      "remaining": "unlimited"
    },
    "aiGrantWriting": {
      "used": 28,
      "limit": -1,
      "remaining": "unlimited"
    },
    "aiSynthesis": {
      "used": 67,
      "limit": -1,
      "remaining": "unlimited"
    }
  }
}
```

### Institutional User Status
```json
{
  "userId": "550e8400-e29b-41d4-a716-446655440002",
  "accessType": "institutional",
  "isUnlimited": false,
  "usage": {
    "aiSearch": {
      "used": 234,
      "limit": 1000,
      "remaining": 766
    },
    "aiAnalysis": {
      "used": 45,
      "limit": 500,
      "remaining": 455
    },
    "aiGrantWriting": {
      "used": 12,
      "limit": 100,
      "remaining": 88
    },
    "aiSynthesis": {
      "used": 89,
      "limit": 300,
      "remaining": 211
    }
  }
}
```

---

## Testing Scenarios

### Test 1: Free User Within Quota
```bash
# First request of the month - should succeed
curl -X POST http://localhost:3000/api/search/ai \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"query": "machine learning papers"}'

# Expected: 200 OK with search results
```

### Test 2: Free User Quota Exceeded (With Credits)
```bash
# 21st search request (quota is 20) - should deduct 1 credit
curl -X POST http://localhost:3000/api/search/ai \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"query": "deep learning"}'

# Expected: 200 OK, 1 credit deducted
```

### Test 3: Free User Quota Exceeded (No Credits)
```bash
# Search request with 0 credits available
curl -X POST http://localhost:3000/api/search/ai \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"query": "neural networks"}'

# Expected: 403 Forbidden
{
  "error": "Usage quota exceeded",
  "quotaLimit": 20,
  "quotaUsed": 20,
  "creditsNeeded": 1,
  "creditsAvailable": 0
}
```

### Test 4: Cooldown Period
```bash
# Make grant writing request
curl -X POST http://localhost:3000/api/grants/generate \
  -H "Authorization: Bearer $TOKEN" \
  -d '{"topic": "AI research"}'

# Immediately make another request (within 5 minutes)
curl -X POST http://localhost:3000/api/grants/generate \
  -H "Authorization: Bearer $TOKEN" \
  -d '{"topic": "ML research"}'

# Expected: 429 Too Many Requests
{
  "error": "Cooldown period active",
  "message": "Please wait 5 minutes between grant writing requests",
  "retryAfter": 280
}
```

### Test 5: Rate Limit
```bash
# Make 101 requests in one hour
for i in {1..101}; do
  curl -X POST http://localhost:3000/api/search/ai \
    -H "Authorization: Bearer $TOKEN" \
    -d '{"query": "test '$i'"}'
done

# Expected: First 100 succeed, 101st returns 429
{
  "error": "Rate limit exceeded",
  "message": "Hourly rate limit exceeded...",
  "retryAfter": 3600
}
```

### Test 6: Grandfathered User (Unlimited)
```bash
# Make unlimited requests
curl -X POST http://localhost:3000/api/search/ai \
  -H "Authorization: Bearer $GRANDFATHERED_TOKEN" \
  -d '{"query": "test"}'

# Expected: Always succeeds, no quota checks
```

---

## Database Queries for Monitoring

### Check User's Current Usage
```sql
SELECT
  u.email,
  u.access_type,
  ul.is_grandfathered,
  ul.ai_search_count,
  ul.ai_analysis_count,
  ul.ai_grant_writing_count,
  ul.ai_synthesis_count,
  ul.available_credits,
  ul.current_period_end
FROM users u
JOIN usage_limits ul ON u.id = ul.user_id
WHERE u.email = 'user@example.com';
```

### Get Usage Logs for User
```sql
SELECT
  feature_type,
  credits_used,
  was_free,
  status,
  created_at
FROM usage_logs
WHERE user_id = '550e8400-e29b-41d4-a716-446655440000'
ORDER BY created_at DESC
LIMIT 20;
```

### Get Credit Transaction History
```sql
SELECT
  transaction_type,
  credits_delta,
  balance_before,
  balance_after,
  description,
  created_at
FROM credit_transactions
WHERE user_id = '550e8400-e29b-41d4-a716-446655440000'
ORDER BY created_at DESC
LIMIT 20;
```

### Check All Users Approaching Quota
```sql
SELECT
  u.email,
  u.access_type,
  ul.ai_search_count,
  ul.ai_analysis_count,
  ul.ai_grant_writing_count,
  ul.ai_synthesis_count,
  ul.available_credits
FROM users u
JOIN usage_limits ul ON u.id = ul.user_id
WHERE
  u.access_type = 'free'
  AND (
    ul.ai_search_count >= 18
    OR ul.ai_analysis_count >= 4
    OR ul.ai_grant_writing_count >= 2
  );
```

---

## Integration Checklist

- [ ] Apply database migrations 025, 026, 027, 028
- [ ] Import middleware in API routes
- [ ] Add `checkUsageLimit()` to all AI endpoints
- [ ] Create `/api/users/me/usage` endpoint for status
- [ ] Add credit purchase functionality
- [ ] Display usage metrics in user dashboard
- [ ] Set up monitoring for quota approaching users
- [ ] Configure email notifications for quota exceeded
- [ ] Test all user access tiers
- [ ] Document rate limits in API documentation
