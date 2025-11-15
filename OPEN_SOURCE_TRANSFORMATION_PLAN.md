# COMPASSID Open-Source Transformation Plan
**Goal**: Transform from subscription-based to open-source with free tier + credit system for grant eligibility

## Current State Analysis

### Existing Subscription System
- **3 Paid Tiers**: Researcher ($15), Researcher Pro ($25), Grant Writer ($39)
- **Stripe Integration**: Fully implemented payment processing
- **Problem**: Usage limits defined but NOT enforced
- **Finding**: 0% of usage tracking implemented

### Key Files to Modify
1. **Database**: `src/migrations/016_add_subscription_columns.sql`
2. **Backend Routes**: `src/routes/stripe.js`
3. **Backend Controllers**: `src/controllers/stripeController.js` (500 lines)
4. **Frontend Pricing**: `src/pages/PremiumPage.jsx`
5. **Frontend Account**: `src/pages/AccountSettingsPage.jsx`
6. **Rate Limiting**: `src/middleware/rateLimiter.js`

---

## New Architecture: Free Tier + Credit System

### Philosophy
- **Default**: Free access for all researchers
- **Fair Use Limits**: Protect sustainability without paywall
- **Credits**: Pay-per-use for additional capacity (not subscriptions)
- **Foundation-Friendly**: No "premium tiers", just open research infrastructure

### Free Tier Limits (Monthly Reset)
```
✅ Database Access: UNLIMITED (500K+ papers)
✅ Basic Search: UNLIMITED
✅ Researcher Profiles: UNLIMITED
✅ Paper Submission: UNLIMITED
✅ Policy Tagging: UNLIMITED

🎯 AI-Powered Features (Fair Use Limits):
- AI Natural Language Search: 20/month ($0.002-0.025 per query)
- Research Gap Analysis: 5/month (~$0.50 per analysis)
- Grant Writing Assistance: 3/month (~$2-5 per grant)
- Strategy Synthesis: 10/month (~$0.10 per synthesis)

💰 Additional Credits Available:
- Small Pack: $10 = 100 AI searches + 10 analyses + 5 grants
- Medium Pack: $25 = 300 AI searches + 30 analyses + 15 grants
- Large Pack: $75 = 1000 AI searches + 100 analyses + 50 grants
```

---

## Database Schema Changes

### NEW TABLES

#### 1. `usage_limits` - Track user usage per month
```sql
CREATE TABLE usage_limits (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,

  -- Monthly counters (auto-reset)
  ai_searches_used INTEGER DEFAULT 0,
  gap_analyses_used INTEGER DEFAULT 0,
  grant_writings_used INTEGER DEFAULT 0,
  syntheses_used INTEGER DEFAULT 0,

  -- Monthly limits (from tier or credits)
  ai_searches_limit INTEGER DEFAULT 20,
  gap_analyses_limit INTEGER DEFAULT 5,
  grant_writings_limit INTEGER DEFAULT 3,
  syntheses_limit INTEGER DEFAULT 10,

  -- Rate limiting
  hourly_api_calls INTEGER DEFAULT 0,
  daily_api_calls INTEGER DEFAULT 0,
  last_hourly_reset TIMESTAMP DEFAULT NOW(),
  last_daily_reset TIMESTAMP DEFAULT NOW(),

  -- Reset tracking
  current_period_start DATE DEFAULT CURRENT_DATE,
  current_period_end DATE DEFAULT (CURRENT_DATE + INTERVAL '1 month'),

  -- Flags
  is_suspended BOOLEAN DEFAULT FALSE,
  suspension_reason TEXT,

  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW(),

  UNIQUE(user_id, current_period_start)
);

CREATE INDEX idx_usage_limits_user ON usage_limits(user_id);
CREATE INDEX idx_usage_limits_period ON usage_limits(current_period_start, current_period_end);
```

#### 2. `usage_logs` - Audit trail of all AI feature usage
```sql
CREATE TABLE usage_logs (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,

  -- Feature details
  feature_type VARCHAR(50) NOT NULL, -- 'ai_search', 'gap_analysis', 'grant_writing', 'synthesis'
  feature_metadata JSONB, -- Store query, params, etc.

  -- Cost tracking
  tokens_used INTEGER,
  estimated_cost_usd NUMERIC(10, 4),

  -- Result
  success BOOLEAN DEFAULT TRUE,
  error_message TEXT,

  -- Timing
  duration_ms INTEGER,
  created_at TIMESTAMP DEFAULT NOW(),

  -- For analytics
  ip_address INET,
  user_agent TEXT
);

CREATE INDEX idx_usage_logs_user ON usage_logs(user_id);
CREATE INDEX idx_usage_logs_feature ON usage_logs(feature_type);
CREATE INDEX idx_usage_logs_created ON usage_logs(created_at DESC);
CREATE INDEX idx_usage_logs_cost ON usage_logs(estimated_cost_usd) WHERE estimated_cost_usd > 0;
```

#### 3. `credit_purchases` - Track credit pack purchases
```sql
CREATE TABLE credit_purchases (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,

  -- Purchase details
  pack_size VARCHAR(20) NOT NULL, -- 'small', 'medium', 'large', 'custom'
  amount_usd NUMERIC(10, 2) NOT NULL,

  -- Credits granted
  ai_searches_credits INTEGER DEFAULT 0,
  gap_analyses_credits INTEGER DEFAULT 0,
  grant_writings_credits INTEGER DEFAULT 0,
  syntheses_credits INTEGER DEFAULT 0,

  -- Payment
  stripe_payment_intent_id VARCHAR(255),
  stripe_charge_id VARCHAR(255),
  payment_status VARCHAR(50) DEFAULT 'pending', -- 'pending', 'succeeded', 'failed', 'refunded'

  -- Metadata
  purchased_at TIMESTAMP DEFAULT NOW(),
  expires_at TIMESTAMP, -- NULL = never expires (or set to 1 year)

  created_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX idx_credit_purchases_user ON credit_purchases(user_id);
CREATE INDEX idx_credit_purchases_status ON credit_purchases(payment_status);
```

#### 4. `institutional_partnerships` - For universities/organizations
```sql
CREATE TABLE institutional_partnerships (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),

  -- Organization details
  organization_name VARCHAR(255) NOT NULL,
  organization_type VARCHAR(100), -- 'university', 'research_institute', 'ngo', 'government'
  contact_name VARCHAR(255),
  contact_email VARCHAR(255) NOT NULL,

  -- Partnership details
  partnership_tier VARCHAR(50) DEFAULT 'basic', -- 'basic', 'enhanced', 'enterprise'
  num_researchers_covered INTEGER DEFAULT 0,

  -- Enhanced limits for covered researchers
  enhanced_limits JSONB, -- Custom limits per feature

  -- Status
  status VARCHAR(50) DEFAULT 'pending', -- 'pending', 'active', 'suspended', 'cancelled'
  start_date DATE,
  end_date DATE,

  -- Billing
  annual_amount_usd NUMERIC(10, 2),
  billing_method VARCHAR(50) DEFAULT 'invoice', -- 'invoice', 'grant', 'donation'

  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX idx_institutional_partnerships_status ON institutional_partnerships(status);
```

#### 5. `institutional_members` - Link researchers to institutions
```sql
CREATE TABLE institutional_members (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  partnership_id UUID NOT NULL REFERENCES institutional_partnerships(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,

  -- Verification
  verified BOOLEAN DEFAULT FALSE,
  verification_method VARCHAR(50), -- 'email_domain', 'manual', 'csv_import'
  verified_at TIMESTAMP,
  verified_by UUID REFERENCES users(id),

  -- Status
  status VARCHAR(50) DEFAULT 'active', -- 'active', 'suspended', 'removed'

  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW(),

  UNIQUE(partnership_id, user_id)
);

CREATE INDEX idx_institutional_members_partnership ON institutional_members(partnership_id);
CREATE INDEX idx_institutional_members_user ON institutional_members(user_id);
```

### MODIFY EXISTING TABLES

#### Update `users` table
```sql
ALTER TABLE users
  -- Remove subscription tier (keep for backward compat during migration)
  ADD COLUMN access_type VARCHAR(50) DEFAULT 'free', -- 'free', 'credits', 'institutional', 'sponsor'

  -- Credits balance (purchased credits)
  ADD COLUMN credits_ai_searches INTEGER DEFAULT 0,
  ADD COLUMN credits_gap_analyses INTEGER DEFAULT 0,
  ADD COLUMN credits_grant_writings INTEGER DEFAULT 0,
  ADD COLUMN credits_syntheses INTEGER DEFAULT 0,

  -- Institutional link
  ADD COLUMN institutional_partnership_id UUID REFERENCES institutional_partnerships(id),

  -- Grandfathering/special access
  ADD COLUMN is_grandfathered BOOLEAN DEFAULT FALSE,
  ADD COLUMN grandfathered_limits JSONB,

  -- Last usage check (for performance)
  ADD COLUMN last_usage_check TIMESTAMP DEFAULT NOW();

CREATE INDEX idx_users_access_type ON users(access_type);
CREATE INDEX idx_users_institutional ON users(institutional_partnership_id) WHERE institutional_partnership_id IS NOT NULL;
```

---

## Middleware: Usage Enforcement

### File: `src/middleware/usageLimit.js`
```javascript
const pool = require('../config/database.cjs');
const logger = require('../config/logger.cjs');

// Cost estimates per feature (in USD)
const FEATURE_COSTS = {
  ai_search: 0.002,      // Claude Haiku API call
  gap_analysis: 0.50,    // More complex analysis
  grant_writing: 2.50,   // Long-form generation
  synthesis: 0.10        // Medium complexity
};

// Free tier monthly limits
const FREE_TIER_LIMITS = {
  ai_searches: 20,
  gap_analyses: 5,
  grant_writings: 3,
  syntheses: 10
};

// Rate limits (per hour/day for abuse prevention)
const RATE_LIMITS = {
  hourly: 100,
  daily: 500
};

// Cooldown periods (minutes between same feature use)
const COOL DOWNS = {
  ai_search: 0,          // No cooldown
  gap_analysis: 2,       // 2 minutes
  grant_writing: 5,      // 5 minutes
  synthesis: 1           // 1 minute
};

class UsageLimitMiddleware {
  /**
   * Check if user can use a feature
   * @param {string} featureType - 'ai_search', 'gap_analysis', 'grant_writing', 'synthesis'
   */
  static checkUsageLimit(featureType) {
    return async (req, res, next) => {
      try {
        const userId = req.user.userId;

        // 1. Get or create usage limits for current month
        const limits = await this.getCurrentLimits(userId);

        // 2. Check if period needs reset
        if (new Date() > new Date(limits.current_period_end)) {
          await this.resetMonthlyLimits(userId);
          limits = await this.getCurrentLimits(userId);
        }

        // 3. Check rate limits (abuse prevention)
        const rateCheck = await this.checkRateLimits(limits);
        if (!rateCheck.allowed) {
          return res.status(429).json({
            error: 'Rate limit exceeded',
            message: rateCheck.message,
            retry_after: rateCheck.retryAfter
          });
        }

        // 4. Check feature cooldown
        const cooldownCheck = await this.checkCooldown(userId, featureType);
        if (!cooldownCheck.allowed) {
          return res.status(429).json({
            error: 'Cooldown active',
            message: `Please wait ${cooldownCheck.secondsRemaining} seconds before using this feature again`,
            retry_after: cooldownCheck.secondsRemaining
          });
        }

        // 5. Calculate available quota
        const quota = await this.calculateQuota(userId, featureType, limits);

        // 6. Check if user has quota remaining
        if (quota.remaining <= 0) {
          return res.status(403).json({
            error: 'Usage limit exceeded',
            message: `You've used all ${quota.limit} ${featureType.replace('_', ' ')} credits this month`,
            usage: {
              used: quota.used,
              limit: quota.limit,
              remaining: 0,
              resets_on: limits.current_period_end
            },
            upgrade_options: {
              buy_credits: true,
              credit_packs: this.getCreditPackOptions()
            }
          });
        }

        // 7. Allow request - attach usage info to request
        req.usageInfo = {
          userId,
          featureType,
          quota,
          limits,
          estimatedCost: FEATURE_COSTS[featureType]
        };

        next();

      } catch (error) {
        logger.error('Usage limit check error:', error);
        // Fail open in case of errors (log but allow)
        next();
      }
    };
  }

  /**
   * Get current usage limits for user
   */
  static async getCurrentLimits(userId) {
    const result = await pool.query(`
      SELECT * FROM usage_limits
      WHERE user_id = $1
      AND current_period_start <= CURRENT_DATE
      AND current_period_end > CURRENT_DATE
      ORDER BY created_at DESC
      LIMIT 1
    `, [userId]);

    if (result.rows.length === 0) {
      // Create new limits record for this month
      return await this.createMonthlyLimits(userId);
    }

    return result.rows[0];
  }

  /**
   * Create new monthly limits record
   */
  static async createMonthlyLimits(userId) {
    // Check if user has institutional access or credits
    const user = await pool.query(`
      SELECT access_type, credits_ai_searches, credits_gap_analyses,
             credits_grant_writings, credits_syntheses,
             is_grandfathered, grandfathered_limits,
             institutional_partnership_id
      FROM users WHERE id = $1
    `, [userId]);

    const userData = user.rows[0];
    const limits = { ...FREE_TIER_LIMITS };

    // Add purchased credits to limits
    limits.ai_searches += userData.credits_ai_searches || 0;
    limits.gap_analyses += userData.credits_gap_analyses || 0;
    limits.grant_writings += userData.credits_grant_writings || 0;
    limits.syntheses += userData.credits_syntheses || 0;

    // Check for institutional partnership
    if (userData.institutional_partnership_id) {
      const partnership = await pool.query(`
        SELECT enhanced_limits FROM institutional_partnerships
        WHERE id = $1 AND status = 'active'
      `, [userData.institutional_partnership_id]);

      if (partnership.rows.length > 0 && partnership.rows[0].enhanced_limits) {
        const enhanced = partnership.rows[0].enhanced_limits;
        limits.ai_searches = enhanced.ai_searches || limits.ai_searches;
        limits.gap_analyses = enhanced.gap_analyses || limits.gap_analyses;
        limits.grant_writings = enhanced.grant_writings || limits.grant_writings;
        limits.syntheses = enhanced.syntheses || limits.syntheses;
      }
    }

    // Check for grandfathered access
    if (userData.is_grandfathered && userData.grandfathered_limits) {
      Object.assign(limits, userData.grandfathered_limits);
    }

    const result = await pool.query(`
      INSERT INTO usage_limits (
        user_id, ai_searches_limit, gap_analyses_limit,
        grant_writings_limit, syntheses_limit,
        current_period_start, current_period_end
      ) VALUES ($1, $2, $3, $4, $5, CURRENT_DATE, CURRENT_DATE + INTERVAL '1 month')
      RETURNING *
    `, [userId, limits.ai_searches, limits.gap_analyses, limits.grant_writings, limits.syntheses]);

    return result.rows[0];
  }

  /**
   * Reset monthly limits (called when period ends)
   */
  static async resetMonthlyLimits(userId) {
    // Archive old period
    await pool.query(`
      UPDATE usage_limits
      SET updated_at = NOW()
      WHERE user_id = $1 AND current_period_end <= CURRENT_DATE
    `, [userId]);

    // Create new period
    return await this.createMonthlyLimits(userId);
  }

  /**
   * Check rate limits
   */
  static async checkRateLimits(limits) {
    const now = new Date();
    const hourlyReset = new Date(limits.last_hourly_reset);
    const dailyReset = new Date(limits.last_daily_reset);

    const hoursPassed = (now - hourlyReset) / (1000 * 60 * 60);
    const daysPassed = (now - dailyReset) / (1000 * 60 * 60 * 24);

    // Reset hourly counter if 1 hour passed
    if (hoursPassed >= 1) {
      await pool.query(`
        UPDATE usage_limits
        SET hourly_api_calls = 0, last_hourly_reset = NOW()
        WHERE id = $1
      `, [limits.id]);
      limits.hourly_api_calls = 0;
    }

    // Reset daily counter if 1 day passed
    if (daysPassed >= 1) {
      await pool.query(`
        UPDATE usage_limits
        SET daily_api_calls = 0, last_daily_reset = NOW()
        WHERE id = $1
      `, [limits.id]);
      limits.daily_api_calls = 0;
    }

    // Check limits
    if (limits.hourly_api_calls >= RATE_LIMITS.hourly) {
      return {
        allowed: false,
        message: 'Hourly rate limit exceeded',
        retryAfter: Math.ceil((3600 - (now - hourlyReset) / 1000))
      };
    }

    if (limits.daily_api_calls >= RATE_LIMITS.daily) {
      return {
        allowed: false,
        message: 'Daily rate limit exceeded',
        retryAfter: Math.ceil((86400 - (now - dailyReset) / 1000))
      };
    }

    return { allowed: true };
  }

  /**
   * Check cooldown period
   */
  static async checkCooldown(userId, featureType) {
    const cooldownMinutes = COOLDOWNS[featureType];
    if (cooldownMinutes === 0) {
      return { allowed: true };
    }

    const result = await pool.query(`
      SELECT created_at FROM usage_logs
      WHERE user_id = $1 AND feature_type = $2 AND success = TRUE
      ORDER BY created_at DESC
      LIMIT 1
    `, [userId, featureType]);

    if (result.rows.length === 0) {
      return { allowed: true };
    }

    const lastUse = new Date(result.rows[0].created_at);
    const now = new Date();
    const minutesSince = (now - lastUse) / (1000 * 60);

    if (minutesSince < cooldownMinutes) {
      return {
        allowed: false,
        secondsRemaining: Math.ceil((cooldownMinutes * 60) - (minutesSince * 60))
      };
    }

    return { allowed: true };
  }

  /**
   * Calculate available quota for a feature
   */
  static async calculateQuota(userId, featureType, limits) {
    const limitField = `${featureType}s_limit`;
    const usedField = `${featureType}s_used`;

    const limit = limits[limitField] || 0;
    const used = limits[usedField] || 0;

    return {
      limit,
      used,
      remaining: Math.max(0, limit - used)
    };
  }

  /**
   * Log usage after successful API call
   */
  static async logUsage(userId, featureType, metadata = {}, success = true, error = null) {
    const tokensUsed = metadata.tokensUsed || 0;
    const estimatedCost = FEATURE_COSTS[featureType];
    const durationMs = metadata.durationMs || 0;

    // Insert usage log
    await pool.query(`
      INSERT INTO usage_logs (
        user_id, feature_type, feature_metadata, tokens_used,
        estimated_cost_usd, success, error_message, duration_ms,
        ip_address, user_agent
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
    `, [
      userId, featureType, metadata, tokensUsed,
      estimatedCost, success, error, durationMs,
      metadata.ipAddress, metadata.userAgent
    ]);

    // Increment usage counter
    if (success) {
      const usedField = `${featureType}s_used`;
      await pool.query(`
        UPDATE usage_limits
        SET ${usedField} = ${usedField} + 1,
            hourly_api_calls = hourly_api_calls + 1,
            daily_api_calls = daily_api_calls + 1,
            updated_at = NOW()
        WHERE user_id = $1
        AND current_period_start <= CURRENT_DATE
        AND current_period_end > CURRENT_DATE
      `, [userId]);
    }
  }

  /**
   * Get credit pack options for upgrade prompts
   */
  static getCreditPackOptions() {
    return [
      {
        name: 'Small Pack',
        price: 10,
        credits: {
          ai_searches: 100,
          gap_analyses: 10,
          grant_writings: 5,
          syntheses: 50
        }
      },
      {
        name: 'Medium Pack',
        price: 25,
        credits: {
          ai_searches: 300,
          gap_analyses: 30,
          grant_writings: 15,
          syntheses: 150
        }
      },
      {
        name: 'Large Pack',
        price: 75,
        credits: {
          ai_searches: 1000,
          gap_analyses: 100,
          grant_writings: 50,
          syntheses: 500
        }
      }
    ];
  }
}

module.exports = UsageLimitMiddleware;
```

---

## Implementation Phases

### Phase 1: Database Foundation (Week 1)
- [ ] Create migration: `025_usage_tracking_system.sql`
- [ ] Create migration: `026_credit_system.sql`
- [ ] Create migration: `027_institutional_partnerships.sql`
- [ ] Run migrations on development database
- [ ] Test database constraints and triggers

### Phase 2: Usage Middleware (Week 1-2)
- [ ] Implement `src/middleware/usageLimit.js`
- [ ] Create unit tests for usage calculation
- [ ] Create unit tests for quota checking
- [ ] Create integration tests with mock users

### Phase 3: API Updates (Week 2)
- [ ] Add usage middleware to AI search endpoint
- [ ] Add usage middleware to gap analysis endpoint
- [ ] Add usage middleware to grant writing endpoint
- [ ] Add usage middleware to synthesis endpoint
- [ ] Add usage logging after each successful call
- [ ] Update API responses to include usage info

### Phase 4: Credit Purchase System (Week 2-3)
- [ ] Create `src/routes/credits.js`
- [ ] Create `src/controllers/creditsController.js`
- [ ] Implement Stripe checkout for credit packs
- [ ] Implement credit application to user account
- [ ] Add webhook handling for payment events
- [ ] Test credit purchase flow end-to-end

### Phase 5: Frontend Updates (Week 3)
- [ ] Transform `PremiumPage.jsx` → `CommunityAccessPage.jsx`
- [ ] Remove subscription language
- [ ] Show free tier limits prominently
- [ ] Add credit pack purchase UI
- [ ] Create usage dashboard component
- [ ] Update account settings to show usage
- [ ] Add "Support Our Mission" donation option

### Phase 6: Migration & Cleanup (Week 4)
- [ ] Create migration script for existing users
- [ ] Grandfather heavy users with custom limits
- [ ] Cancel all existing subscriptions (with notice)
- [ ] Update documentation
- [ ] Update marketing materials
- [ ] Test entire flow with real users

### Phase 7: Analytics & Monitoring (Week 4)
- [ ] Create admin dashboard for usage monitoring
- [ ] Add cost tracking analytics
- [ ] Add abuse detection alerts
- [ ] Create monthly usage reports
- [ ] Set up automated suspension for violations

---

## Success Metrics

### Foundation Grant Eligibility
- ✅ Free tier with NO paywalls for core research
- ✅ Open-source friendly pricing model
- ✅ Transparent cost structure
- ✅ Institutional partnership options
- ✅ No "unlimited" promises

### User Experience
- Users understand their monthly limits
- Upgrade path is clear (credits, not subscriptions)
- Fair use prevents abuse without blocking research
- Institutional researchers get enhanced access

### Financial Sustainability
- Track actual API costs per user
- Ensure credit prices cover costs + 20% buffer
- Monitor conversion rate (free → paid credits)
- Maintain runway with grant funding + credits

---

## Communication Strategy

### Current Users Email
```
Subject: COMPASSID is Going Open Source! 🌍

Hi [Name],

Exciting news! COMPASSID is transitioning to an open-source model to better serve the global conservation research community.

What's Changing:
✅ FREE access to all core features (database, profiles, search)
✅ Fair use limits on AI features (20 searches/month, 5 analyses, 3 grants)
✅ Buy credits when you need more (no subscriptions!)
✅ Your current subscription will be cancelled with full refund for unused time

What's the Same:
✅ Same great database of 500K+ papers
✅ Same AI-powered research tools
✅ Same commitment to conservation science

Your Action Required:
- Your subscription will be cancelled on [date]
- You'll receive a full refund for [amount]
- You'll automatically get FREE access (no interruption)
- If you need more than 20 AI searches/month, you can buy credit packs

Why This Change:
We're positioning COMPASSID to secure grants from foundations like Sloan, Moore, and NSF POSE. Going open-source makes us eligible for millions in research infrastructure funding, ensuring COMPASSID remains free and sustainable for years to come.

Questions? Reply to this email or visit compassid.org/open-source

Thank you for being part of this journey!
The COMPASSID Team
```

### Website Messaging
**Homepage Hero**:
```
COMPASSID: Free Open Research Infrastructure for Conservation Science

Access 500K+ conservation papers, AI-powered research tools,
and global researcher network—all free for the research community.

[Get Started Free] [Learn More]
```

**Pricing Page**:
```
Access for Everyone

🌍 Free for All Researchers
Full database access, unlimited basic search, researcher profiles, and fair-use AI tools.

Free tier includes:
✅ 500K+ conservation papers
✅ Unlimited database search
✅ 20 AI searches per month
✅ 5 research gap analyses per month
✅ 3 grant writing sessions per month
✅ Researcher profiles & networking

[Sign Up Free]

---

💰 Need More AI Credits?

Small Pack - $10
100 AI searches + 10 analyses + 5 grants

Medium Pack - $25
300 AI searches + 30 analyses + 15 grants

Large Pack - $75
1000 AI searches + 100 analyses + 50 grants

[Buy Credits]

---

🏛️ Institutional Partnerships

Universities and research organizations can sponsor enhanced access for their researchers.
Contact: partnerships@compassid.org

---

💚 Support Our Mission

COMPASSID is grant-funded open research infrastructure. Your contributions help us keep the platform free for everyone.

[Donate] [Learn About Our Grants]
```

---

## Technical Debt to Address

1. **Remove Old Subscription Code** (after migration):
   - Delete `src/routes/stripe.js` subscription routes
   - Delete subscription management code in `stripeController.js`
   - Remove subscription UI components
   - Clean up database: drop `subscription_tier`, `subscription_status` columns

2. **Add Missing Features**:
   - Email notifications for usage warnings (80%, 100%)
   - Admin dashboard for usage monitoring
   - Automated monthly reports
   - Abuse detection algorithms

3. **Performance Optimization**:
   - Cache usage limits in Redis (reduce DB queries)
   - Batch usage log writes
   - Add database indexes for common queries

---

## Risk Mitigation

### Revenue Risk
- **Problem**: Losing subscription revenue before securing grants
- **Mitigation**:
  - Phase transition over 3 months
  - Keep credit purchase system as backup revenue
  - Apply for grants before cancelling subscriptions
  - Monitor credit purchase conversion rates

### Abuse Risk
- **Problem**: Users gaming free tier with multiple accounts
- **Mitigation**:
  - Rate limiting (100 calls/hour, 500/day)
  - Cooldown periods (5 min between grants)
  - IP address tracking
  - Email verification required
  - Automated suspension for violations
  - Manual review for suspicious patterns

### Cost Risk
- **Problem**: Underestimating AI API costs
- **Mitigation**:
  - Track actual costs per feature
  - Set credit prices at cost + 30% buffer
  - Monitor aggregate monthly costs
  - Add hard caps at system level
  - Alert when daily costs exceed $500

---

## Next Steps

1. **Immediate** (This Week):
   - Create database migrations
   - Implement usage middleware
   - Test with development database

2. **Short Term** (Next 2 Weeks):
   - Update API endpoints
   - Create credit purchase system
   - Transform frontend pricing page

3. **Medium Term** (Month 1):
   - Migrate existing users
   - Launch new pricing model
   - Monitor usage and costs

4. **Long Term** (Months 2-3):
   - Apply for foundation grants
   - Build institutional partnerships
   - Optimize based on real usage data

---

**Status**: Planning Complete - Ready for Implementation
**Last Updated**: 2025-01-14
**Owner**: COMPASSID Development Team
