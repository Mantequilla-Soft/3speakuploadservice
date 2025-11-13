const rateLimit = require('express-rate-limit');

// ============================================
// AUTHENTICATION MIDDLEWARE
// ============================================

/**
 * Dual authentication support:
 * 1. Bearer token (for API clients)
 * 2. X-Hive-Username header (for demo/frontend)
 */
const requireAuth = (req, res, next) => {
  // Check for Hive username header (demo mode)
  const hiveUsername = req.headers['x-hive-username'];
  
  if (hiveUsername) {
    // Validate Hive username format
    const usernameRegex = /^[a-z0-9\-]{3,16}$/;
    
    if (!usernameRegex.test(hiveUsername)) {
      return res.status(401).json({
        success: false,
        error: 'Invalid Hive username format'
      });
    }
    
    // Store authenticated user info
    req.auth = {
      authenticated: true,
      authType: 'hive-username',
      username: hiveUsername
    };
    
    return next();
  }
  
  // Fall back to Bearer token authentication
  const authHeader = req.headers.authorization;
  
  if (!authHeader) {
    return res.status(401).json({
      success: false,
      error: 'Authorization required. Provide Bearer token or X-Hive-Username header.'
    });
  }
  
  const token = authHeader.replace('Bearer ', '');
  
  if (!token || token !== process.env.UPLOAD_SECRET_TOKEN) {
    return res.status(401).json({
      success: false,
      error: 'Invalid authentication token'
    });
  }
  
  // Store authenticated user info
  req.auth = {
    authenticated: true,
    authType: 'bearer-token'
  };
  
  next();
};

// ============================================
// RATE LIMITING WITH PER-USER SUPPORT
// ============================================

// Per-user rate limiter (for Hive username auth)
const perUserUploadLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hour
  max: 10, // 10 uploads per hour per user
  message: {
    success: false,
    error: 'Upload limit exceeded. Maximum 10 uploads per hour.'
  },
  keyGenerator: (req) => {
    // Use Hive username if available, otherwise IP
    return req.headers['x-hive-username'] || req.ip;
  },
  standardHeaders: true,
  legacyHeaders: false
});

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100, // 100 auth requests per window per IP
  message: {
    success: false,
    error: 'Too many authentication attempts, please try again later'
  },
  skipSuccessfulRequests: true,
  standardHeaders: true,
  legacyHeaders: false
});

const uploadLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 20, // Increased from 5 to 20 uploads per window per IP
  message: {
    success: false,
    error: 'Too many upload attempts, please try again later'
  },
  standardHeaders: true,
  legacyHeaders: false,
  // Use X-Forwarded-For if behind proxy
  keyGenerator: (req) => {
    return req.headers['x-hive-username'] || req.ip;
  }
});

// ============================================
// OPTIONAL: TOKEN VALIDATION HELPER
// ============================================
const validateToken = (token) => {
  // Basic validation
  if (!token || typeof token !== 'string') {
    return { valid: false, reason: 'Token must be a string' };
  }
  
  if (token.length < 32) {
    return { valid: false, reason: 'Token too short' };
  }
  
  if (token !== process.env.UPLOAD_SECRET_TOKEN) {
    return { valid: false, reason: 'Invalid token' };
  }
  
  return { valid: true };
};

// ============================================
// MIDDLEWARE FOR OPTIONAL AUTH (PUBLIC ENDPOINTS)
// ============================================
const optionalAuth = (req, res, next) => {
  const authHeader = req.headers.authorization;
  
  if (authHeader) {
    const token = authHeader.replace('Bearer ', '');
    const validation = validateToken(token);
    
    if (validation.valid) {
      req.auth = {
        authenticated: true,
        tokenType: 'upload-service'
      };
    } else {
      req.auth = {
        authenticated: false,
        error: validation.reason
      };
    }
  } else {
    req.auth = {
      authenticated: false
    };
  }
  
  next();
};

module.exports = {
  requireAuth,
  optionalAuth,
  authLimiter,
  uploadLimiter,
  perUserUploadLimiter,
  validateToken
};