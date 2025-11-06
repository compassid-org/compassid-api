// Environment Variable Validator
// Ensures all required environment variables are set before starting the server

export function validateEnvironment() {
  const required = {
    // Always required
    JWT_SECRET: 'JWT secret key for authentication',
    DB_HOST: 'Database host',
    DB_PORT: 'Database port',
    DB_NAME: 'Database name',
    DB_USER: 'Database user',
    DB_PASSWORD: 'Database password',
  };

  const productionRequired = {
    // Only required in production
    CORS_ORIGIN: 'CORS allowed origins',
    FRONTEND_URL: 'Frontend application URL',
    STRIPE_WEBHOOK_SECRET: 'Stripe webhook signing secret'
  };

  const errors = [];
  const warnings = [];

  // Check always-required variables
  Object.entries(required).forEach(([key, description]) => {
    if (!process.env[key]) {
      errors.push(`Missing required environment variable: ${key} (${description})`);
    }
  });

  // Check production-only required variables
  if (process.env.NODE_ENV === 'production') {
    Object.entries(productionRequired).forEach(([key, description]) => {
      if (!process.env[key]) {
        errors.push(`Missing required environment variable for production: ${key} (${description})`);
      }
    });

    // Check for development secrets in production
    if (process.env.JWT_SECRET && process.env.JWT_SECRET.length < 32) {
      errors.push('JWT_SECRET is too weak for production (must be at least 32 characters)');
    }

    if (process.env.DB_PASSWORD && process.env.DB_PASSWORD.includes('Dev')) {
      warnings.push('⚠️  Database password appears to be a development password');
    }

    if (process.env.ADMIN_PASSWORD && process.env.ADMIN_PASSWORD.includes('Admin2024')) {
      warnings.push('⚠️  Admin password should be changed for production');
    }
  }

  // Development warnings
  if (process.env.NODE_ENV !== 'production') {
    if (!process.env.STRIPE_WEBHOOK_SECRET) {
      warnings.push('⚠️  STRIPE_WEBHOOK_SECRET not set - Stripe payments will not work');
    }
  }

  // Print results
  if (warnings.length > 0) {
    console.log('\n⚠️  Environment Warnings:');
    warnings.forEach(warning => console.log(`  ${warning}`));
    console.log('');
  }

  if (errors.length > 0) {
    console.error('\n❌ Environment Validation Failed:\n');
    errors.forEach(error => console.error(`  • ${error}`));
    console.error('\nPlease set the missing environment variables in your .env file\n');
    process.exit(1);
  }

  console.log('✅ Environment validation passed');
  return true;
}
