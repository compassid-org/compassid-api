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

// Subscription plan configurations matching frontend
const SUBSCRIPTION_PLANS = {
  researcher: {
    name: 'Researcher',
    monthlyPrice: 15,
    yearlyPrice: 150,
    features: {
      ai_queries: 50,
      analytics: false,
      grant_writing: false
    }
  },
  premium: {
    name: 'Researcher Pro',
    monthlyPrice: 25,
    yearlyPrice: 250,
    features: {
      ai_queries: 50,
      analytics: true,
      grant_writing: false,
      api_access: 500
    }
  },
  grant_writing: {
    name: 'Grant Writer',
    monthlyPrice: 39,
    yearlyPrice: 390,
    features: {
      ai_queries: 100,
      analytics: true,
      grant_writing: true,
      grant_writing_words: 50000,
      api_access: 1000
    }
  }
};

/**
 * Create a Stripe Checkout Session for subscription
 */
export const createCheckoutSession = async (req, res) => {
  try {
    const { planType, billingPeriod } = req.body;
    const userId = req.user.userId; // From auth middleware

    console.log('Creating checkout session for:', { planType, billingPeriod, userId });

    // Validate plan
    const plan = SUBSCRIPTION_PLANS[planType];
    if (!plan) {
      return res.status(400).json({ error: 'Invalid plan type' });
    }

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

    // Determine price based on billing period
    const amount = billingPeriod === 'yearly' ? plan.yearlyPrice : plan.monthlyPrice;
    const interval = billingPeriod === 'yearly' ? 'year' : 'month';

    // Create checkout session
    const session = await getStripe().checkout.sessions.create({
      customer: stripeCustomerId,
      payment_method_types: ['card'],
      line_items: [
        {
          price_data: {
            currency: 'usd',
            product_data: {
              name: plan.name,
              description: `COMPASS ID ${plan.name} Subscription`,
            },
            recurring: {
              interval: interval,
            },
            unit_amount: amount * 100, // Stripe uses cents
          },
          quantity: 1,
        },
      ],
      mode: 'subscription',
      success_url: `${req.headers.origin || 'http://localhost:3000'}/settings?session_id={CHECKOUT_SESSION_ID}&payment=success`,
      cancel_url: `${req.headers.origin || 'http://localhost:3000'}/premium?canceled=true`,
      metadata: {
        userId: userId.toString(),
        planType,
        billingPeriod
      },
    });

    console.log('Checkout session created:', session.id);

    res.json({
      sessionId: session.id,
      url: session.url
    });
  } catch (error) {
    console.error('Stripe checkout error:', error);
    res.status(500).json({
      error: 'Failed to create checkout session',
      details: error.message
    });
  }
};

/**
 * Create a Stripe Customer Portal session for managing subscriptions
 */
export const createPortalSession = async (req, res) => {
  try {
    const userId = req.user.userId;

    // Get user's Stripe customer ID
    const userResult = await pool.query(
      'SELECT stripe_customer_id FROM users WHERE id = $1',
      [userId]
    );

    if (!userResult.rows.length || !userResult.rows[0].stripe_customer_id) {
      return res.status(400).json({
        error: 'No active subscription found'
      });
    }

    const session = await getStripe().billingPortal.sessions.create({
      customer: userResult.rows[0].stripe_customer_id,
      return_url: `${req.headers.origin || 'http://localhost:3000'}/settings`,
    });

    res.json({ url: session.url });
  } catch (error) {
    console.error('Stripe portal error:', error);
    res.status(500).json({
      error: 'Failed to create portal session',
      details: error.message
    });
  }
};

/**
 * Webhook handler for Stripe events
 */
export const handleWebhook = async (req, res) => {
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
    console.log('Received webhook event:', event.type);

    switch (event.type) {
      case 'checkout.session.completed':
        await handleCheckoutCompleted(event.data.object);
        break;

      case 'customer.subscription.updated':
        await handleSubscriptionUpdated(event.data.object);
        break;

      case 'customer.subscription.deleted':
        await handleSubscriptionDeleted(event.data.object);
        break;

      case 'invoice.payment_succeeded':
        await handlePaymentSucceeded(event.data.object);
        break;

      case 'invoice.payment_failed':
        await handlePaymentFailed(event.data.object);
        break;

      default:
        console.log(`Unhandled event type: ${event.type}`);
    }

    res.json({ received: true });
  } catch (error) {
    console.error('Webhook handler error:', error);
    res.status(500).json({ error: 'Webhook handler failed' });
  }
};

/**
 * Handle successful checkout
 */
async function handleCheckoutCompleted(session) {
  console.log('Handling checkout completed:', session.id);

  const userId = parseInt(session.metadata.userId);
  const planType = session.metadata.planType;
  const billingPeriod = session.metadata.billingPeriod;

  // Get subscription details
  const subscription = await getStripe().subscriptions.retrieve(session.subscription);

  // Update user subscription status
  await pool.query(
    'UPDATE users SET subscription = $1, subscription_status = $2, stripe_customer_id = $3 WHERE id = $4',
    [planType, 'active', session.customer, userId]
  );

  console.log(`Subscription activated for user ${userId}: ${planType}`);
}

/**
 * Handle subscription updates
 */
async function handleSubscriptionUpdated(subscription) {
  console.log('Handling subscription updated:', subscription.id);

  const customerId = subscription.customer;

  // Find user by Stripe customer ID
  const userResult = await pool.query(
    'SELECT id FROM users WHERE stripe_customer_id = $1',
    [customerId]
  );

  if (userResult.rows.length === 0) {
    console.error('User not found for customer:', customerId);
    return;
  }

  const userId = userResult.rows[0].id;

  // Update user status
  await pool.query(
    'UPDATE users SET subscription_status = $1 WHERE id = $2',
    [subscription.status, userId]
  );

  console.log(`Subscription updated for user ${userId}: ${subscription.status}`);
}

/**
 * Handle subscription cancellation
 */
async function handleSubscriptionDeleted(subscription) {
  console.log('Handling subscription deleted:', subscription.id);

  const customerId = subscription.customer;

  const userResult = await pool.query(
    'SELECT id FROM users WHERE stripe_customer_id = $1',
    [customerId]
  );

  if (userResult.rows.length === 0) {
    console.error('User not found for customer:', customerId);
    return;
  }

  const userId = userResult.rows[0].id;

  // Update user subscription status
  await pool.query(
    'UPDATE users SET subscription = NULL, subscription_status = $1 WHERE id = $2',
    ['canceled', userId]
  );

  console.log(`Subscription canceled for user ${userId}`);
}

/**
 * Handle successful payment
 */
async function handlePaymentSucceeded(invoice) {
  console.log(`Payment succeeded for invoice: ${invoice.id}`);
}

/**
 * Handle failed payment
 */
async function handlePaymentFailed(invoice) {
  console.log(`Payment failed for invoice: ${invoice.id}`);

  const customerId = invoice.customer;

  const userResult = await pool.query(
    'SELECT id, email FROM users WHERE stripe_customer_id = $1',
    [customerId]
  );

  if (userResult.rows.length > 0) {
    console.error(`Payment failed for user ${userResult.rows[0].email}`);
    // TODO: Send email notification about failed payment
  }
}

/**
 * Get user's subscription details
 */
export const getSubscription = async (req, res) => {
  try {
    const userId = req.user.userId;

    const result = await pool.query(`
      SELECT subscription, subscription_status, stripe_customer_id
      FROM users
      WHERE id = $1
    `, [userId]);

    if (result.rows.length === 0) {
      return res.json({ subscription: null });
    }

    const userData = result.rows[0];

    // Get latest info from Stripe if they have a customer ID
    let stripeSubscription = null;
    if (userData.stripe_customer_id) {
      try {
        const subscriptions = await getStripe().subscriptions.list({
          customer: userData.stripe_customer_id,
          status: 'active',
          limit: 1
        });

        if (subscriptions.data.length > 0) {
          stripeSubscription = subscriptions.data[0];
        }
      } catch (error) {
        console.error('Error fetching Stripe subscription:', error);
      }
    }

    res.json({
      subscription: {
        type: userData.subscription,
        status: userData.subscription_status,
        stripeData: stripeSubscription
      }
    });
  } catch (error) {
    console.error('Get subscription error:', error);
    res.status(500).json({
      error: 'Failed to get subscription',
      details: error.message
    });
  }
};

/**
 * Cancel subscription
 */
export const cancelSubscription = async (req, res) => {
  try {
    const userEmail = req.user.email;
    let customerId = null;

    // Try to get customer ID from database first
    try {
      const userResult = await pool.query(
        'SELECT stripe_customer_id FROM users WHERE id = $1',
        [req.user.userId]
      );

      if (userResult.rows.length > 0 && userResult.rows[0].stripe_customer_id) {
        customerId = userResult.rows[0].stripe_customer_id;
      }
    } catch (dbError) {
      console.log('Could not query database, will search by email');
    }

    // If no customer ID from database, search Stripe by email
    if (!customerId) {
      const customers = await getStripe().customers.list({
        email: userEmail,
        limit: 1
      });

      if (customers.data.length === 0) {
        return res.status(404).json({ error: 'No Stripe customer found' });
      }

      customerId = customers.data[0].id;
    }

    // Get active subscriptions
    const subscriptions = await getStripe().subscriptions.list({
      customer: customerId,
      status: 'active',
      limit: 1
    });

    if (subscriptions.data.length === 0) {
      return res.status(404).json({ error: 'No active subscription found' });
    }

    // Cancel subscription at period end (don't cancel immediately)
    const subscription = await getStripe().subscriptions.update(subscriptions.data[0].id, {
      cancel_at_period_end: true
    });

    res.json({
      message: 'Subscription will be canceled at the end of the billing period',
      subscription
    });
  } catch (error) {
    console.error('Cancel subscription error:', error);
    res.status(500).json({
      error: 'Failed to cancel subscription',
      details: error.message
    });
  }
};
