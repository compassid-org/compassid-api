import Stripe from 'stripe';
import pg from 'pg';

const { Pool } = pg;
const pool = new Pool({
  host: process.env.DB_HOST,
  port: process.env.DB_PORT,
  database: process.env.DB_NAME,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD
});

// Initialize Stripe with secret key - lazy initialization
let stripe;
const getStripe = () => {
  if (!stripe) {
    if (!process.env.STRIPE_SECRET_KEY) {
      throw new Error('STRIPE_SECRET_KEY environment variable is not set');
    }
    stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
  }
  return stripe;
};

/**
 * GET /api/credits/packs
 * Get available credit packs from database
 */
export const getCreditPacks = async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT
        id,
        pack_name,
        pack_size,
        credits,
        price_usd,
        discount_percent,
        popular,
        description,
        active
      FROM credit_pack_configs
      WHERE active = TRUE
      ORDER BY
        CASE pack_size
          WHEN 'small' THEN 1
          WHEN 'medium' THEN 2
          WHEN 'large' THEN 3
          ELSE 4
        END
    `);

    res.json({
      success: true,
      packs: result.rows
    });
  } catch (error) {
    console.error('Get credit packs error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch credit packs',
      message: error.message
    });
  }
};

/**
 * POST /api/credits/purchase
 * Create a Stripe Checkout Session for one-time credit purchase
 */
export const createCreditPurchaseSession = async (req, res) => {
  try {
    const { packSize } = req.body;
    const userId = req.user.userId; // From auth middleware

    console.log('Creating credit purchase session for:', { packSize, userId });

    // Validate pack size
    if (!['small', 'medium', 'large'].includes(packSize)) {
      return res.status(400).json({
        success: false,
        error: 'Invalid pack size. Must be small, medium, or large.'
      });
    }

    // Get pack details from database
    const packResult = await pool.query(
      'SELECT * FROM credit_pack_configs WHERE pack_size = $1 AND active = TRUE',
      [packSize]
    );

    if (packResult.rows.length === 0) {
      return res.status(400).json({
        success: false,
        error: 'Credit pack not found or inactive'
      });
    }

    const pack = packResult.rows[0];

    // Get or create Stripe customer
    let stripeCustomerId;
    let userEmail = req.user.email; // From JWT token

    // Try to check if user already has a Stripe customer ID
    try {
      const userResult = await pool.query(
        'SELECT stripe_customer_id, email FROM users WHERE id = $1',
        [userId]
      );

      if (userResult.rows.length > 0) {
        const user = userResult.rows[0];
        userEmail = user.email; // Use DB email if available

        if (user.stripe_customer_id) {
          stripeCustomerId = user.stripe_customer_id;
        } else {
          // Create new Stripe customer
          const customer = await getStripe().customers.create({
            email: userEmail,
            metadata: {
              userId: userId.toString()
            }
          });

          stripeCustomerId = customer.id;

          // Save Stripe customer ID to database
          await pool.query(
            'UPDATE users SET stripe_customer_id = $1 WHERE id = $2',
            [stripeCustomerId, userId]
          );
        }
      } else {
        // User not found in DB, create Stripe customer without saving to DB
        const customer = await getStripe().customers.create({
          email: userEmail,
          metadata: {
            userId: userId.toString()
          }
        });
        stripeCustomerId = customer.id;
        console.log('Created Stripe customer without DB (DB not available)');
      }
    } catch (dbError) {
      // Database not available - proceed with JWT email only
      console.log('Database not available, using JWT email for Stripe customer');
      const customer = await getStripe().customers.create({
        email: userEmail,
        metadata: {
          userId: userId.toString()
        }
      });
      stripeCustomerId = customer.id;
    }

    // Create checkout session for ONE-TIME payment
    const session = await getStripe().checkout.sessions.create({
      customer: stripeCustomerId,
      payment_method_types: ['card'],
      line_items: [
        {
          price_data: {
            currency: 'usd',
            product_data: {
              name: `${pack.pack_name} - ${pack.credits} Credits`,
              description: pack.description || `Get ${pack.credits} credits for AI-powered features`,
              metadata: {
                pack_id: pack.id,
                pack_size: packSize,
                credits: pack.credits.toString()
              }
            },
            unit_amount: Math.round(pack.price_usd * 100), // Stripe uses cents
          },
          quantity: 1,
        },
      ],
      mode: 'payment', // ONE-TIME payment, not subscription
      success_url: `${req.headers.origin || 'http://localhost:3000'}/dashboard?credits_purchase=success&session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${req.headers.origin || 'http://localhost:3000'}/credits?canceled=true`,
      metadata: {
        userId: userId.toString(),
        packId: pack.id.toString(),
        packSize: packSize,
        credits: pack.credits.toString(),
        purchaseType: 'credit_pack'
      },
    });

    console.log('Credit purchase session created:', session.id);

    res.json({
      success: true,
      sessionId: session.id,
      url: session.url
    });
  } catch (error) {
    console.error('Stripe credit purchase error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to create checkout session',
      message: error.message
    });
  }
};

/**
 * POST /api/credits/webhook
 * Webhook handler for Stripe credit purchase events
 */
export const handleCreditPurchaseWebhook = async (req, res) => {
  const sig = req.headers['stripe-signature'];
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;

  let event;

  try {
    // Verify webhook signature
    if (webhookSecret) {
      event = getStripe().webhooks.constructEvent(req.body, sig, webhookSecret);
    } else {
      // For testing without webhook secret
      event = JSON.parse(req.body.toString());
    }
  } catch (err) {
    console.error('Webhook signature verification failed:', err.message);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  // Handle different event types
  try {
    console.log('Received credit purchase webhook event:', event.type);

    switch (event.type) {
      case 'checkout.session.completed':
        // Check if this is a credit purchase (not a subscription)
        const session = event.data.object;
        if (session.metadata?.purchaseType === 'credit_pack') {
          await handleCreditPurchaseCompleted(session);
        }
        break;

      case 'payment_intent.succeeded':
        console.log('Payment intent succeeded:', event.data.object.id);
        break;

      case 'payment_intent.payment_failed':
        console.log('Payment failed:', event.data.object.id);
        break;

      default:
        console.log(`Unhandled event type: ${event.type}`);
    }

    res.json({ received: true });
  } catch (error) {
    console.error('Webhook handler error:', error);
    res.status(500).json({
      error: 'Webhook handler failed',
      message: error.message
    });
  }
};

/**
 * Handle successful credit purchase
 */
async function handleCreditPurchaseCompleted(session) {
  console.log('Handling credit purchase completed:', session.id);

  const userId = session.metadata.userId;
  const packId = session.metadata.packId;
  const credits = parseInt(session.metadata.credits);
  const packSize = session.metadata.packSize;

  if (!userId || !credits) {
    console.error('Missing required metadata in session:', session.metadata);
    return;
  }

  // Start transaction
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    // 1. Record the purchase in credit_purchases table
    const purchaseResult = await client.query(`
      INSERT INTO credit_purchases (
        user_id,
        pack_id,
        credits_purchased,
        amount_paid_usd,
        payment_status,
        stripe_payment_id,
        stripe_session_id,
        purchase_metadata
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
      RETURNING id
    `, [
      userId,
      packId,
      credits,
      session.amount_total / 100, // Convert from cents
      'completed',
      session.payment_intent,
      session.id,
      JSON.stringify({
        packSize,
        customerEmail: session.customer_email,
        customerName: session.customer_details?.name
      })
    ]);

    const purchaseId = purchaseResult.rows[0].id;

    // 2. Add credits to user's available_credits using the database function
    await client.query(`
      SELECT add_credits_to_user($1, $2, $3, $4)
    `, [
      userId,
      credits,
      purchaseId,
      `Purchased ${packSize} pack (${credits} credits)`
    ]);

    await client.query('COMMIT');

    console.log(`Successfully added ${credits} credits to user ${userId} from purchase ${purchaseId}`);
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Error processing credit purchase:', error);
    throw error;
  } finally {
    client.release();
  }
}

/**
 * GET /api/credits/balance
 * Get user's current credit balance and usage limits
 */
export const getCreditBalance = async (req, res) => {
  try {
    const userId = req.user.userId;

    // Get current usage limits including credit balance
    const limitsResult = await pool.query(`
      SELECT
        available_credits,
        is_grandfathered,
        grandfathered_limits,
        ai_search_count,
        ai_analysis_count,
        ai_grant_writing_count,
        ai_synthesis_count,
        current_period_start,
        current_period_end,
        last_request_at
      FROM usage_limits
      WHERE user_id = $1
    `, [userId]);

    if (limitsResult.rows.length === 0) {
      return res.status(404).json({
        success: false,
        error: 'User usage limits not found'
      });
    }

    const limits = limitsResult.rows[0];

    // Get purchase history (last 10 purchases)
    const purchaseHistory = await pool.query(`
      SELECT
        cp.id,
        cp.credits_purchased,
        cp.amount_paid_usd,
        cp.purchased_at,
        cpc.pack_name,
        cpc.pack_size
      FROM credit_purchases cp
      LEFT JOIN credit_pack_configs cpc ON cp.pack_id = cpc.id
      WHERE cp.user_id = $1 AND cp.payment_status = 'completed'
      ORDER BY cp.purchased_at DESC
      LIMIT 10
    `, [userId]);

    // Get recent credit transactions (last 20)
    const transactions = await pool.query(`
      SELECT
        id,
        transaction_type,
        credits_amount,
        balance_after,
        description,
        created_at
      FROM credit_transactions
      WHERE user_id = $1
      ORDER BY created_at DESC
      LIMIT 20
    `, [userId]);

    res.json({
      success: true,
      balance: {
        availableCredits: limits.available_credits,
        isGrandfathered: limits.is_grandfathered,
        grandfatheredLimits: limits.grandfathered_limits,
        currentPeriod: {
          start: limits.current_period_start,
          end: limits.current_period_end,
          aiSearchCount: limits.ai_search_count,
          aiAnalysisCount: limits.ai_analysis_count,
          aiGrantWritingCount: limits.ai_grant_writing_count,
          aiSynthesisCount: limits.ai_synthesis_count
        },
        lastActivity: limits.last_request_at
      },
      purchaseHistory: purchaseHistory.rows,
      recentTransactions: transactions.rows
    });
  } catch (error) {
    console.error('Get credit balance error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to get credit balance',
      message: error.message
    });
  }
};

/**
 * GET /api/credits/usage-summary
 * Get summary of user's usage across all AI features
 */
export const getUsageSummary = async (req, res) => {
  try {
    const userId = req.user.userId;

    // Get user's access type and limits
    const userResult = await pool.query(`
      SELECT
        u.access_type,
        ul.available_credits,
        ul.is_grandfathered,
        ul.ai_search_count,
        ul.ai_analysis_count,
        ul.ai_grant_writing_count,
        ul.ai_synthesis_count,
        ul.current_period_start,
        ul.current_period_end
      FROM users u
      LEFT JOIN usage_limits ul ON u.id = ul.user_id
      WHERE u.id = $1
    `, [userId]);

    if (userResult.rows.length === 0) {
      return res.status(404).json({
        success: false,
        error: 'User not found'
      });
    }

    const userData = userResult.rows[0];

    // Define free tier limits
    const FREE_TIER_LIMITS = {
      ai_search: 20,
      ai_analysis: 5,
      ai_grant_writing: 3,
      ai_synthesis: 10
    };

    // Define credit costs
    const CREDIT_COSTS = {
      ai_search: 1,
      ai_analysis: 3,
      ai_grant_writing: 5,
      ai_synthesis: 2
    };

    // Calculate remaining quotas
    const remainingQuotas = {
      ai_search: FREE_TIER_LIMITS.ai_search - (userData.ai_search_count || 0),
      ai_analysis: FREE_TIER_LIMITS.ai_analysis - (userData.ai_analysis_count || 0),
      ai_grant_writing: FREE_TIER_LIMITS.ai_grant_writing - (userData.ai_grant_writing_count || 0),
      ai_synthesis: FREE_TIER_LIMITS.ai_synthesis - (userData.ai_synthesis_count || 0)
    };

    res.json({
      success: true,
      usage: {
        accessType: userData.access_type,
        isGrandfathered: userData.is_grandfathered,
        availableCredits: userData.available_credits || 0,
        currentPeriod: {
          start: userData.current_period_start,
          end: userData.current_period_end
        },
        features: {
          aiSearch: {
            used: userData.ai_search_count || 0,
            limit: userData.is_grandfathered ? -1 : FREE_TIER_LIMITS.ai_search,
            remaining: userData.is_grandfathered ? -1 : Math.max(0, remainingQuotas.ai_search),
            creditCost: CREDIT_COSTS.ai_search
          },
          aiAnalysis: {
            used: userData.ai_analysis_count || 0,
            limit: userData.is_grandfathered ? -1 : FREE_TIER_LIMITS.ai_analysis,
            remaining: userData.is_grandfathered ? -1 : Math.max(0, remainingQuotas.ai_analysis),
            creditCost: CREDIT_COSTS.ai_analysis
          },
          aiGrantWriting: {
            used: userData.ai_grant_writing_count || 0,
            limit: userData.is_grandfathered ? -1 : FREE_TIER_LIMITS.ai_grant_writing,
            remaining: userData.is_grandfathered ? -1 : Math.max(0, remainingQuotas.ai_grant_writing),
            creditCost: CREDIT_COSTS.ai_grant_writing
          },
          aiSynthesis: {
            used: userData.ai_synthesis_count || 0,
            limit: userData.is_grandfathered ? -1 : FREE_TIER_LIMITS.ai_synthesis,
            remaining: userData.is_grandfathered ? -1 : Math.max(0, remainingQuotas.ai_synthesis),
            creditCost: CREDIT_COSTS.ai_synthesis
          }
        }
      }
    });
  } catch (error) {
    console.error('Get usage summary error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to get usage summary',
      message: error.message
    });
  }
};
