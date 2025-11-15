/**
 * COMPASSID Usage Limit Middleware
 * Enforces usage quotas, rate limits, and credit deductions for AI features
 * Part of the open-source transformation with free tier + pay-per-use credits
 *
 * Features:
 * - Grandfathered users: Unlimited access
 * - Institutional users: Partnership-based limits
 * - Free tier users: Monthly quotas (20/5/3/10)
 * - Rate limiting: 100/hour, 500/day
 * - Cooldown periods: 5min grants, 2min analysis
 * - Credit deduction when quota exceeded
 * - Complete usage logging and audit trail
 *
 * @example Basic Usage - Protect AI endpoints
 * import { checkUsageLimit } from './middleware/usageLimit.js';
 *
 * // AI Search endpoint
 * router.post('/api/search/ai',
 *   authMiddleware,
 *   checkUsageLimit('ai_search'),
 *   searchController.aiSearch
 * );
 *
 * // AI Analysis endpoint
 * router.post('/api/papers/:id/analyze',
 *   authMiddleware,
 *   checkUsageLimit('ai_analysis'),
 *   paperController.analyze
 * );
 *
 * // AI Grant Writing endpoint
 * router.post('/api/grants/generate',
 *   authMiddleware,
 *   checkUsageLimit('ai_grant_writing'),
 *   grantController.generate
 * );
 *
 * @example Get User Usage Status - Display in UI
 * import { getUsageStatus } from './middleware/usageLimit.js';
 *
 * router.get('/api/users/me/usage', authMiddleware, async (req, res) => {
 *   try {
 *     const status = await getUsageStatus(req.user.id);
 *     res.json(status);
 *   } catch (error) {
 *     res.status(500).json({ error: 'Failed to fetch usage status' });
 *   }
 * });
 *
 * @example Attach Usage Status to All Requests
 * import { attachUsageStatus } from './middleware/usageLimit.js';
 *
 * // Apply globally to make req.usageStatus available everywhere
 * app.use(authMiddleware);
 * app.use(attachUsageStatus());
 *
 * @example Manual Usage Logging (for background jobs)
 * import { logUsage } from './middleware/usageLimit.js';
 *
 * await logUsage(
 *   userId,
 *   'ai_synthesis',
 *   0,
 *   true,
 *   'success',
 *   req,
 *   { synthesized_papers: 5 }
 * );
 *
 * Database Schema Requirements:
 * - Requires migrations 025, 026, 027, 028 to be applied
 * - Tables: usage_limits, usage_logs, credit_transactions, institutional_partnerships
 * - Functions: get_effective_usage_limits(), deduct_credits_from_user()
 */

import pool from '../../config/database.js';

// =============================================================================
// CONFIGURATION CONSTANTS
// =============================================================================

const FREE_TIER_LIMITS = {
  ai_search: 20,
  ai_analysis: 5,
  ai_grant_writing: 3,
  ai_synthesis: 10
};

const RATE_LIMITS = {
  hourly: 100,
  daily: 500
};

const COOLDOWN_PERIODS = {
  ai_search: 0,           // No cooldown
  ai_analysis: 2 * 60,    // 2 minutes in seconds
  ai_grant_writing: 5 * 60, // 5 minutes in seconds
  ai_synthesis: 0         // No cooldown
};

const CREDIT_COSTS = {
  ai_search: 1,
  ai_analysis: 3,
  ai_grant_writing: 5,
  ai_synthesis: 2
};

const VALID_FEATURES = ['ai_search', 'ai_analysis', 'ai_grant_writing', 'ai_synthesis'];

// =============================================================================
// USAGE LIMIT MIDDLEWARE CLASS
// =============================================================================

class UsageLimitMiddleware {
  /**
   * Main middleware function - checks usage limits before allowing request
   * @param {string} featureType - Type of AI feature ('ai_search', 'ai_analysis', etc.)
   * @returns {Function} Express middleware function
   */
  static checkUsageLimit(featureType) {
    // Validate feature type
    if (!VALID_FEATURES.includes(featureType)) {
      throw new Error(`Invalid feature type: ${featureType}. Must be one of: ${VALID_FEATURES.join(', ')}`);
    }

    return async (req, res, next) => {
      const userId = req.user?.id;

      // Check if user is authenticated
      if (!userId) {
        return res.status(401).json({
          error: 'Authentication required',
          message: 'You must be logged in to use AI features'
        });
      }

      try {
        // Get or initialize usage limits for user
        const usageLimits = await UsageLimitMiddleware.getUserLimits(userId);

        // STEP 1: Check if user is grandfathered (unlimited access)
        if (usageLimits.is_grandfathered) {
          await UsageLimitMiddleware.logUsage(
            userId,
            featureType,
            0,
            true,
            'success',
            req,
            { reason: 'grandfathered_user' }
          );
          return next();
        }

        // STEP 2: Check rate limits (hourly and daily)
        const rateLimitCheck = await UsageLimitMiddleware.checkRateLimits(userId, usageLimits);
        if (!rateLimitCheck.allowed) {
          await UsageLimitMiddleware.logUsage(
            userId,
            featureType,
            0,
            false,
            'rate_limited',
            req,
            { reason: rateLimitCheck.reason }
          );
          return res.status(429).json({
            error: 'Rate limit exceeded',
            message: rateLimitCheck.message,
            retryAfter: rateLimitCheck.retryAfter
          });
        }

        // STEP 3: Check cooldown periods
        const cooldownCheck = await UsageLimitMiddleware.checkCooldown(userId, featureType, usageLimits);
        if (!cooldownCheck.allowed) {
          await UsageLimitMiddleware.logUsage(
            userId,
            featureType,
            0,
            false,
            'rate_limited',
            req,
            { reason: 'cooldown_active' }
          );
          return res.status(429).json({
            error: 'Cooldown period active',
            message: cooldownCheck.message,
            retryAfter: cooldownCheck.retryAfter
          });
        }

        // STEP 4: Get effective usage limits for this user
        const effectiveLimits = await UsageLimitMiddleware.getEffectiveLimits(userId);

        // STEP 5: Check if user has institutional access
        if (effectiveLimits.source === 'institutional') {
          // Institutional users: check against partnership limits
          const institutionalCheck = await UsageLimitMiddleware.checkInstitutionalQuota(
            userId,
            featureType,
            effectiveLimits,
            usageLimits
          );

          if (!institutionalCheck.allowed) {
            await UsageLimitMiddleware.logUsage(
              userId,
              featureType,
              0,
              false,
              'quota_exceeded',
              req,
              { reason: 'institutional_quota_exceeded' }
            );
            return res.status(403).json({
              error: 'Institutional quota exceeded',
              message: institutionalCheck.message
            });
          }

          // Increment usage counter
          await UsageLimitMiddleware.incrementUsageCounter(userId, featureType);
          await UsageLimitMiddleware.logUsage(
            userId,
            featureType,
            0,
            true,
            'success',
            req,
            { source: 'institutional' }
          );
          return next();
        }

        // STEP 6: Free tier users - check monthly quota
        const quotaCheck = await UsageLimitMiddleware.checkMonthlyQuota(
          userId,
          featureType,
          usageLimits
        );

        if (quotaCheck.withinQuota) {
          // Within free quota - increment and allow
          await UsageLimitMiddleware.incrementUsageCounter(userId, featureType);
          await UsageLimitMiddleware.logUsage(
            userId,
            featureType,
            0,
            true,
            'success',
            req,
            { quota_remaining: quotaCheck.remaining }
          );
          return next();
        }

        // STEP 7: Free quota exceeded - attempt to deduct credits
        const creditCost = CREDIT_COSTS[featureType];
        const creditDeduction = await UsageLimitMiddleware.deductCredits(
          userId,
          creditCost,
          featureType,
          req
        );

        if (creditDeduction.success) {
          // Credits deducted successfully
          await UsageLimitMiddleware.incrementUsageCounter(userId, featureType);
          return next();
        } else {
          // No credits available
          await UsageLimitMiddleware.logUsage(
            userId,
            featureType,
            creditCost,
            false,
            'quota_exceeded',
            req,
            {
              reason: 'no_credits',
              quota_exceeded: true,
              credits_needed: creditCost,
              credits_available: usageLimits.available_credits
            }
          );
          return res.status(403).json({
            error: 'Usage quota exceeded',
            message: `You've exceeded your monthly ${featureType.replace('ai_', '').replace('_', ' ')} quota. Please purchase credits to continue.`,
            quotaLimit: FREE_TIER_LIMITS[featureType],
            quotaUsed: usageLimits[`${featureType}_count`],
            creditsNeeded: creditCost,
            creditsAvailable: usageLimits.available_credits
          });
        }

      } catch (error) {
        console.error(`[UsageLimitMiddleware] Error checking usage limit for ${featureType}:`, error);

        // Log the error but don't block the request in case of system errors
        // This ensures service availability even if usage tracking fails
        await UsageLimitMiddleware.logUsage(
          userId,
          featureType,
          0,
          false,
          'failure',
          req,
          { error: error.message }
        ).catch(err => console.error('[UsageLimitMiddleware] Failed to log error:', err));

        return res.status(500).json({
          error: 'Usage limit check failed',
          message: 'An error occurred while checking usage limits. Please try again.'
        });
      }
    };
  }

  /**
   * Get or initialize usage limits for a user
   * @param {string} userId - User ID
   * @returns {Promise<Object>} Usage limits object
   */
  static async getUserLimits(userId) {
    const result = await pool.query(
      `SELECT * FROM usage_limits WHERE user_id = $1`,
      [userId]
    );

    if (result.rows.length === 0) {
      // User doesn't have usage_limits row - this shouldn't happen due to trigger
      // but we'll create one just in case
      const createResult = await pool.query(
        `INSERT INTO usage_limits (user_id, current_period_start, current_period_end)
         VALUES ($1, NOW(), NOW() + INTERVAL '1 month')
         RETURNING *`,
        [userId]
      );
      return createResult.rows[0];
    }

    const limits = result.rows[0];

    // Check if monthly period has expired
    const now = new Date();
    const periodEnd = new Date(limits.current_period_end);

    if (now > periodEnd) {
      // Reset monthly limits
      await UsageLimitMiddleware.resetMonthlyLimits(userId);
      // Fetch updated limits
      const updatedResult = await pool.query(
        `SELECT * FROM usage_limits WHERE user_id = $1`,
        [userId]
      );
      return updatedResult.rows[0];
    }

    return limits;
  }

  /**
   * Get effective usage limits for a user based on their access type
   * @param {string} userId - User ID
   * @returns {Promise<Object>} Effective limits object
   */
  static async getEffectiveLimits(userId) {
    const result = await pool.query(
      `SELECT * FROM get_effective_usage_limits($1)`,
      [userId]
    );

    return result.rows[0];
  }

  /**
   * Check rate limits (hourly and daily)
   * @param {string} userId - User ID
   * @param {Object} usageLimits - Current usage limits
   * @returns {Promise<Object>} Rate limit check result
   */
  static async checkRateLimits(userId, usageLimits) {
    const now = new Date();

    // Check hourly rate limit
    const hourlyResetAt = new Date(usageLimits.hourly_reset_at);
    if (now < hourlyResetAt) {
      if (usageLimits.hourly_count >= RATE_LIMITS.hourly) {
        const retryAfter = Math.ceil((hourlyResetAt - now) / 1000);
        return {
          allowed: false,
          reason: 'hourly_rate_limit',
          message: `Hourly rate limit exceeded. You can make ${RATE_LIMITS.hourly} requests per hour. Please try again in ${Math.ceil(retryAfter / 60)} minutes.`,
          retryAfter
        };
      }
    } else {
      // Reset hourly counter
      await pool.query(
        `UPDATE usage_limits
         SET hourly_count = 0, hourly_reset_at = NOW() + INTERVAL '1 hour'
         WHERE user_id = $1`,
        [userId]
      );
      usageLimits.hourly_count = 0;
    }

    // Check daily rate limit
    const dailyResetAt = new Date(usageLimits.daily_reset_at);
    if (now < dailyResetAt) {
      if (usageLimits.daily_count >= RATE_LIMITS.daily) {
        const retryAfter = Math.ceil((dailyResetAt - now) / 1000);
        return {
          allowed: false,
          reason: 'daily_rate_limit',
          message: `Daily rate limit exceeded. You can make ${RATE_LIMITS.daily} requests per day. Please try again in ${Math.ceil(retryAfter / 3600)} hours.`,
          retryAfter
        };
      }
    } else {
      // Reset daily counter
      await pool.query(
        `UPDATE usage_limits
         SET daily_count = 0, daily_reset_at = NOW() + INTERVAL '1 day'
         WHERE user_id = $1`,
        [userId]
      );
      usageLimits.daily_count = 0;
    }

    // Increment rate limit counters
    await pool.query(
      `UPDATE usage_limits
       SET hourly_count = hourly_count + 1, daily_count = daily_count + 1
       WHERE user_id = $1`,
      [userId]
    );

    return { allowed: true };
  }

  /**
   * Check cooldown period for feature
   * @param {string} userId - User ID
   * @param {string} featureType - Feature type
   * @param {Object} usageLimits - Current usage limits
   * @returns {Promise<Object>} Cooldown check result
   */
  static async checkCooldown(userId, featureType, usageLimits) {
    const cooldownSeconds = COOLDOWN_PERIODS[featureType];

    if (cooldownSeconds === 0) {
      return { allowed: true };
    }

    const lastUsedField = `last_${featureType}_at`;
    const lastUsedAt = usageLimits[lastUsedField];

    if (!lastUsedAt) {
      // Never used before - no cooldown
      return { allowed: true };
    }

    const now = new Date();
    const lastUsed = new Date(lastUsedAt);
    const elapsedSeconds = (now - lastUsed) / 1000;

    if (elapsedSeconds < cooldownSeconds) {
      const retryAfter = Math.ceil(cooldownSeconds - elapsedSeconds);
      const featureName = featureType.replace('ai_', '').replace('_', ' ');
      return {
        allowed: false,
        reason: 'cooldown_active',
        message: `Please wait ${Math.ceil(retryAfter / 60)} minutes between ${featureName} requests to prevent system abuse.`,
        retryAfter
      };
    }

    return { allowed: true };
  }

  /**
   * Check institutional quota
   * @param {string} userId - User ID
   * @param {string} featureType - Feature type
   * @param {Object} effectiveLimits - Effective limits
   * @param {Object} usageLimits - Current usage limits
   * @returns {Promise<Object>} Institutional quota check result
   */
  static async checkInstitutionalQuota(userId, featureType, effectiveLimits, usageLimits) {
    const featureLimit = effectiveLimits[`${featureType}_limit`];

    // -1 means unlimited
    if (featureLimit === -1) {
      return { allowed: true };
    }

    const currentUsage = usageLimits[`${featureType}_count`];

    if (currentUsage >= featureLimit) {
      const featureName = featureType.replace('ai_', '').replace('_', ' ');
      return {
        allowed: false,
        message: `Your institutional partnership has reached its monthly ${featureName} limit of ${featureLimit} requests. Please contact your institutional administrator.`
      };
    }

    return { allowed: true };
  }

  /**
   * Check monthly quota for free tier users
   * @param {string} userId - User ID
   * @param {string} featureType - Feature type
   * @param {Object} usageLimits - Current usage limits
   * @returns {Promise<Object>} Quota check result
   */
  static async checkMonthlyQuota(userId, featureType, usageLimits) {
    const quotaLimit = FREE_TIER_LIMITS[featureType];
    const currentUsage = usageLimits[`${featureType}_count`];

    if (currentUsage < quotaLimit) {
      return {
        withinQuota: true,
        remaining: quotaLimit - currentUsage
      };
    }

    return { withinQuota: false };
  }

  /**
   * Increment usage counter for a feature
   * @param {string} userId - User ID
   * @param {string} featureType - Feature type
   * @returns {Promise<void>}
   */
  static async incrementUsageCounter(userId, featureType) {
    const countField = `${featureType}_count`;
    const lastUsedField = `last_${featureType}_at`;

    await pool.query(
      `UPDATE usage_limits
       SET ${countField} = ${countField} + 1,
           ${lastUsedField} = NOW()
       WHERE user_id = $1`,
      [userId]
    );
  }

  /**
   * Deduct credits from user account
   * @param {string} userId - User ID
   * @param {number} credits - Number of credits to deduct
   * @param {string} featureType - Feature type
   * @param {Object} req - Express request object
   * @returns {Promise<Object>} Deduction result
   */
  static async deductCredits(userId, credits, featureType, req) {
    const client = await pool.connect();

    try {
      await client.query('BEGIN');

      // Create usage log first (we need the ID for the transaction)
      const logResult = await client.query(
        `INSERT INTO usage_logs (
          user_id, feature_type, credits_used, was_free, status,
          ip_address, user_agent, request_metadata
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
        RETURNING id`,
        [
          userId,
          featureType,
          credits,
          false,
          'success',
          req.ip || req.connection?.remoteAddress,
          req.get('user-agent'),
          JSON.stringify({
            path: req.path,
            method: req.method
          })
        ]
      );

      const usageLogId = logResult.rows[0].id;

      // Use database function to deduct credits
      const deductResult = await client.query(
        `SELECT deduct_credits_from_user($1, $2, $3, $4) as success`,
        [
          userId,
          credits,
          usageLogId,
          `Used ${credits} credits for ${featureType.replace('ai_', '').replace('_', ' ')}`
        ]
      );

      const success = deductResult.rows[0].success;

      if (success) {
        await client.query('COMMIT');
        return { success: true, usageLogId };
      } else {
        await client.query('ROLLBACK');
        return { success: false, reason: 'insufficient_credits' };
      }

    } catch (error) {
      await client.query('ROLLBACK');
      console.error('[UsageLimitMiddleware] Error deducting credits:', error);
      throw error;
    } finally {
      client.release();
    }
  }

  /**
   * Log usage to usage_logs table
   * @param {string} userId - User ID
   * @param {string} featureType - Feature type
   * @param {number} creditsUsed - Credits used
   * @param {boolean} wasFree - Whether usage was free (within quota)
   * @param {string} status - Status ('success', 'failure', 'rate_limited', 'quota_exceeded')
   * @param {Object} req - Express request object
   * @param {Object} metadata - Additional metadata
   * @returns {Promise<Object>} Log result
   */
  static async logUsage(userId, featureType, creditsUsed, wasFree, status, req, metadata = {}) {
    try {
      const result = await pool.query(
        `INSERT INTO usage_logs (
          user_id,
          feature_type,
          credits_used,
          was_free,
          status,
          ip_address,
          user_agent,
          request_metadata
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
        RETURNING id`,
        [
          userId,
          featureType,
          creditsUsed,
          wasFree,
          status,
          req?.ip || req?.connection?.remoteAddress || null,
          req?.get?.('user-agent') || null,
          JSON.stringify({
            ...metadata,
            path: req?.path,
            method: req?.method,
            timestamp: new Date().toISOString()
          })
        ]
      );

      return result.rows[0];
    } catch (error) {
      console.error('[UsageLimitMiddleware] Error logging usage:', error);
      throw error;
    }
  }

  /**
   * Reset monthly limits when period expires
   * @param {string} userId - User ID
   * @returns {Promise<void>}
   */
  static async resetMonthlyLimits(userId) {
    await pool.query(
      `UPDATE usage_limits
       SET current_period_start = NOW(),
           current_period_end = NOW() + INTERVAL '1 month',
           ai_search_count = 0,
           ai_analysis_count = 0,
           ai_grant_writing_count = 0,
           ai_synthesis_count = 0
       WHERE user_id = $1`,
      [userId]
    );
  }

  /**
   * Get usage status for a user
   * @param {string} userId - User ID
   * @returns {Promise<Object>} Usage status
   */
  static async getUsageStatus(userId) {
    const usageLimits = await UsageLimitMiddleware.getUserLimits(userId);
    const effectiveLimits = await UsageLimitMiddleware.getEffectiveLimits(userId);

    return {
      userId,
      accessType: effectiveLimits.source,
      isUnlimited: effectiveLimits.is_unlimited,
      credits: {
        available: usageLimits.available_credits,
        lifetimePurchased: usageLimits.lifetime_credits_purchased
      },
      currentPeriod: {
        start: usageLimits.current_period_start,
        end: usageLimits.current_period_end
      },
      usage: {
        aiSearch: {
          used: usageLimits.ai_search_count,
          limit: effectiveLimits.ai_search_limit,
          remaining: effectiveLimits.ai_search_limit === -1
            ? 'unlimited'
            : Math.max(0, effectiveLimits.ai_search_limit - usageLimits.ai_search_count)
        },
        aiAnalysis: {
          used: usageLimits.ai_analysis_count,
          limit: effectiveLimits.ai_analysis_limit,
          remaining: effectiveLimits.ai_analysis_limit === -1
            ? 'unlimited'
            : Math.max(0, effectiveLimits.ai_analysis_limit - usageLimits.ai_analysis_count)
        },
        aiGrantWriting: {
          used: usageLimits.ai_grant_writing_count,
          limit: effectiveLimits.ai_grant_writing_limit,
          remaining: effectiveLimits.ai_grant_writing_limit === -1
            ? 'unlimited'
            : Math.max(0, effectiveLimits.ai_grant_writing_limit - usageLimits.ai_grant_writing_count)
        },
        aiSynthesis: {
          used: usageLimits.ai_synthesis_count,
          limit: effectiveLimits.ai_synthesis_limit,
          remaining: effectiveLimits.ai_synthesis_limit === -1
            ? 'unlimited'
            : Math.max(0, effectiveLimits.ai_synthesis_limit - usageLimits.ai_synthesis_count)
        }
      },
      rateLimits: {
        hourly: {
          used: usageLimits.hourly_count,
          limit: RATE_LIMITS.hourly,
          resetAt: usageLimits.hourly_reset_at
        },
        daily: {
          used: usageLimits.daily_count,
          limit: RATE_LIMITS.daily,
          resetAt: usageLimits.daily_reset_at
        }
      }
    };
  }

  /**
   * Middleware to attach usage status to request object
   * Useful for displaying usage info in UI
   * @returns {Function} Express middleware function
   */
  static attachUsageStatus() {
    return async (req, res, next) => {
      const userId = req.user?.id;

      if (!userId) {
        return next();
      }

      try {
        req.usageStatus = await UsageLimitMiddleware.getUsageStatus(userId);
        next();
      } catch (error) {
        console.error('[UsageLimitMiddleware] Error attaching usage status:', error);
        // Don't block request if status fetch fails
        next();
      }
    };
  }
}

// =============================================================================
// EXPORTS
// =============================================================================

export default UsageLimitMiddleware;

// Named exports for convenience
export const checkUsageLimit = UsageLimitMiddleware.checkUsageLimit.bind(UsageLimitMiddleware);
export const getUsageStatus = UsageLimitMiddleware.getUsageStatus.bind(UsageLimitMiddleware);
export const attachUsageStatus = UsageLimitMiddleware.attachUsageStatus.bind(UsageLimitMiddleware);
export const logUsage = UsageLimitMiddleware.logUsage.bind(UsageLimitMiddleware);
export const resetMonthlyLimits = UsageLimitMiddleware.resetMonthlyLimits.bind(UsageLimitMiddleware);
