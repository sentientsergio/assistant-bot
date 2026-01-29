/**
 * Environment configuration
 * 
 * This module MUST be imported first in index.ts to ensure
 * environment variables are loaded before any other modules.
 */

import dotenv from 'dotenv';

// Determine which environment
export const NODE_ENV = process.env.NODE_ENV || 'production';

// Load appropriate .env file
const envFile = NODE_ENV === 'development' ? '.env.dev' : 
                NODE_ENV === 'production' ? '.env.prod' : '.env';

dotenv.config({ path: envFile });

// Export common config
export const ENV_LABEL = NODE_ENV === 'development' ? 'DEV' : 'PROD';
