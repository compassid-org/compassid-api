# Usage Limit Middleware - Quick Start Guide

## 🚀 5-Minute Integration

### 1. Import the middleware
```javascript
import { checkUsageLimit } from './middleware/usageLimit.js';
```

### 2. Protect your AI endpoints
```javascript
router.post('/api/search/ai',
  authMiddleware,                    // ← Must be authenticated
  checkUsageLimit('ai_search'),      // ← Add this line
  searchController.aiSearch
);
```

### 3. Done! ✅

The middleware automatically:
- ✅ Checks if user is grandfathered (unlimited access)
- ✅ Checks if user is institutional (partnership limits)
- ✅ Checks free tier monthly quotas (20/5/3/10)
- ✅ Enforces rate limits (100/hour, 500/day)
- ✅ Enforces cooldown periods (5min grants, 2min analysis)
- ✅ Deducts credits if quota exceeded
- ✅ Logs all usage to database
- ✅ Returns appropriate error responses

---

## 📊 Display Usage in UI

### Add usage endpoint
```javascript
import { getUsageStatus } from './middleware/usageLimit.js';

router.get('/api/users/me/usage', authMiddleware, async (req, res) => {
  const status = await getUsageStatus(req.user.id);
  res.json(status);
});
```

### Usage status response
```json
{
  "accessType": "free",
  "credits": { "available": 45 },
  "usage": {
    "aiSearch": { "used": 12, "limit": 20, "remaining": 8 },
    "aiAnalysis": { "used": 5, "limit": 5, "remaining": 0 }
  }
}
```

---

## 🎯 Feature Types

Use these strings in `checkUsageLimit()`:

| Feature Type | Monthly Quota | Credit Cost | Cooldown |
|-------------|---------------|-------------|----------|
| `'ai_search'` | 20 | 1 | None |
| `'ai_analysis'` | 5 | 3 | 2 min |
| `'ai_grant_writing'` | 3 | 5 | 5 min |
| `'ai_synthesis'` | 10 | 2 | None |

---

## 📝 Error Responses

### Quota Exceeded (HTTP 403)
```json
{
  "error": "Usage quota exceeded",
  "quotaLimit": 20,
  "quotaUsed": 20,
  "creditsNeeded": 1,
  "creditsAvailable": 0
}
```

### Rate Limited (HTTP 429)
```json
{
  "error": "Rate limit exceeded",
  "message": "...",
  "retryAfter": 1380
}
```

### Cooldown Active (HTTP 429)
```json
{
  "error": "Cooldown period active",
  "message": "Please wait 3 minutes...",
  "retryAfter": 180
}
```

---

## 🔧 Configuration

Edit constants in `usageLimit.js`:

```javascript
const FREE_TIER_LIMITS = {
  ai_search: 20,        // ← Change monthly quotas
  ai_analysis: 5,
  ai_grant_writing: 3,
  ai_synthesis: 10
};

const CREDIT_COSTS = {
  ai_search: 1,         // ← Change credit costs
  ai_analysis: 3,
  ai_grant_writing: 5,
  ai_synthesis: 2
};

const RATE_LIMITS = {
  hourly: 100,          // ← Change rate limits
  daily: 500
};
```

---

## 🧪 Testing

### Test within quota
```bash
curl -X POST http://localhost:3000/api/search/ai \
  -H "Authorization: Bearer $TOKEN" \
  -d '{"query": "test"}'
```
**Expected**: 200 OK

### Test quota exceeded
Make 21 requests in the same month (quota is 20)

**Expected**: 403 Forbidden (if no credits) or 200 OK (if credits available)

### Test rate limit
Make 101 requests in one hour

**Expected**: 429 Too Many Requests

### Check usage status
```bash
curl http://localhost:3000/api/users/me/usage \
  -H "Authorization: Bearer $TOKEN"
```

---

## 🎓 User Access Types

### Grandfathered (Unlimited)
- Existing users before launch
- Unlimited everything
- No charges

### Institutional (Partnership)
- University/organization members
- Custom limits per partnership
- Usually unlimited

### Free Tier (Quotas)
- New users
- Monthly quotas (20/5/3/10)
- Pay with credits when exceeded

---

## 📋 Common Patterns

### Pattern 1: Basic Protection
```javascript
router.post('/api/feature',
  authMiddleware,
  checkUsageLimit('ai_search'),
  controller.handler
);
```

### Pattern 2: Show Usage in Dashboard
```javascript
import { attachUsageStatus } from './middleware/usageLimit.js';

app.use(authMiddleware);
app.use(attachUsageStatus());

// Now req.usageStatus available everywhere
router.get('/dashboard', (req, res) => {
  res.json({ usage: req.usageStatus });
});
```

### Pattern 3: Background Jobs
```javascript
import { logUsage } from './middleware/usageLimit.js';

await logUsage(userId, 'ai_synthesis', 0, true, 'success', null, {
  background: true,
  papers: 5
});
```

---

## 🔍 Monitoring

### SQL: Check user's current usage
```sql
SELECT * FROM usage_limits WHERE user_id = $1;
```

### SQL: Get usage history
```sql
SELECT * FROM usage_logs
WHERE user_id = $1
ORDER BY created_at DESC
LIMIT 20;
```

### SQL: Check credit balance
```sql
SELECT available_credits FROM usage_limits WHERE user_id = $1;
```

---

## ⚠️ Requirements

- ✅ Database migrations 025, 026, 027, 028 must be applied
- ✅ User must be authenticated (req.user.id must exist)
- ✅ Database functions must be installed

---

## 📚 Full Documentation

- **`usageLimit.js`** - Main implementation (730 lines)
- **`usageLimit.README.md`** - Complete integration guide
- **`usageLimit.examples.md`** - Detailed examples and response formats
- **`usageLimit.QUICKSTART.md`** - This file

---

## 🆘 Troubleshooting

### "User not found in usage_limits"
→ User was created before migration 025. Manually insert row or re-run trigger.

### "Function get_effective_usage_limits does not exist"
→ Migration 028 not applied. Run database migrations.

### "Authentication required"
→ Add `authMiddleware` before `checkUsageLimit()`

### Credits not deducting
→ Check `deduct_credits_from_user` function exists and has correct permissions

---

**Ready to use!** 🎉

For more details, see `usageLimit.README.md`
