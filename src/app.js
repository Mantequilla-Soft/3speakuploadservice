const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const winston = require('winston');
require('dotenv').config();

const uploadRoutes = require('./routes/upload');
const storageRoutes = require('./routes/storage');
const cleanupService = require('./services/cleanup');
const { connectDatabases } = require('./config/database');

const app = express();
const PORT = process.env.PORT || 8080;

// ============================================
// TRUST PROXY (for proper IP detection behind nginx)
// ============================================
app.set('trust proxy', 1); // Trust first proxy (nginx)

// ============================================
// LOGGING SETUP
// ============================================
const logger = winston.createLogger({
  level: process.env.LOG_LEVEL || 'info',
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.errors({ stack: true }),
    winston.format.json()
  ),
  transports: [
    new winston.transports.File({ filename: 'logs/error.log', level: 'error' }),
    new winston.transports.File({ filename: 'logs/combined.log' }),
    new winston.transports.Console({
      format: winston.format.simple()
    })
  ]
});

// ============================================
// SECURITY MIDDLEWARE
// ============================================
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'", "'unsafe-inline'", "https://cdn.jsdelivr.net"],
      styleSrc: ["'self'", "'unsafe-inline'"],
      imgSrc: ["'self'", "data:", "https:"],
      mediaSrc: ["'self'", "blob:"],  // Allow blob URLs for video duration detection
      connectSrc: [
        "'self'", 
        "http://localhost:*",  // Allow any localhost port for development
        "http://127.0.0.1:*",  // Allow any 127.0.0.1 port
        "https://api.hive.blog", 
        "https://hived.privex.io", 
        "https://anyx.io", 
        "https://api.openhive.network"
      ]
    }
  }
}));
app.use(cors({
  origin: function (origin, callback) {
    // Allow requests with no origin (like mobile apps, curl, Postman)
    if (!origin) return callback(null, true);
    
    // Allow any localhost origin for development
    if (origin.startsWith('http://localhost:') || origin.startsWith('http://127.0.0.1:')) {
      return callback(null, true);
    }
    
    // Allow production domains
    const allowedOrigins = [
      'https://video.3speak.tv',
      'https://3speak.tv', 
      'https://3speak.co',
      'https://beta.3speak.tv',
      'https://studio.3speak.tv',
      'https://new.3speak.tv'  // Add new frontend domain
    ];
    
    // Allow any Vercel deployment (for development/testing)
    if (origin && origin.includes('.vercel.app')) {
      return callback(null, true);
    }
    
    // Allow any 3speak subdomain
    if (origin && (origin.endsWith('.3speak.tv') || origin.endsWith('.3speak.co'))) {
      return callback(null, true);
    }
    
    if (allowedOrigins.includes(origin)) {
      return callback(null, true);
    }
    
    // Log rejected origin for debugging
    console.warn(`⚠️ CORS rejected origin: ${origin}`);
    
    // Create descriptive error with origin info
    const error = new Error(`CORS_BLOCKED: Origin '${origin}' is not allowed. Allowed: *.3speak.tv, *.3speak.co, *.vercel.app, localhost`);
    error.isCorsError = true;
    error.rejectedOrigin = origin;
    callback(error);
  },
  credentials: true,
  // Allow custom headers used by 3Speak frontend
  allowedHeaders: [
    'Content-Type',
    'Authorization',
    'X-Hive-Username',      // Hive username for auth
    'X-Requested-With',
    'Accept',
    'Origin',
    'Cache-Control',
    'Tus-Resumable',        // TUS upload protocol headers
    'Upload-Length',
    'Upload-Offset',
    'Upload-Metadata'
  ],
  exposedHeaders: [
    'Location',             // TUS returns upload URL in Location header
    'Upload-Offset',
    'Upload-Length',
    'Tus-Resumable',
    'Tus-Version',
    'Tus-Extension',
    'Tus-Max-Size'
  ]
}));

// CORS error handler - must be right after cors() middleware
app.use((err, req, res, next) => {
  if (err.isCorsError) {
    // Set CORS headers manually so the browser can read our error response
    res.header('Access-Control-Allow-Origin', req.headers.origin || '*');
    res.header('Access-Control-Allow-Credentials', 'true');
    
    return res.status(403).json({
      success: false,
      error: 'CORS Error: Origin not allowed',
      message: `Your origin '${err.rejectedOrigin}' is not in the allowed list.`,
      allowed_patterns: [
        '*.3speak.tv',
        '*.3speak.co', 
        '*.vercel.app',
        'localhost:*'
      ],
      help: 'If you need access from a new domain, contact the 3Speak team.'
    });
  }
  next(err);
});

// ============================================
// RATE LIMITING
// ============================================
const generalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 500, // Increased from 100 - general requests per IP
  message: { success: false, error: 'Too many requests, try again later' },
  standardHeaders: true,
  legacyHeaders: false,
  // Skip rate limiting for static files
  skip: (req) => req.path.match(/\.(css|js|png|jpg|jpeg|gif|svg|ico|woff|woff2|ttf)$/)
});

app.use(generalLimiter);

// ============================================
// REQUEST PARSING
// ============================================
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// ============================================
// REQUEST LOGGING
// ============================================
app.use((req, res, next) => {
  const start = Date.now();
  
  res.on('finish', () => {
    const duration = Date.now() - start;
    logger.info('HTTP Request', {
      method: req.method,
      url: req.url,
      status: res.statusCode,
      duration,
      userAgent: req.get('User-Agent'),
      ip: req.ip
    });
  });
  
  next();
});

// ============================================
// ROUTES
// ============================================
// Serve static demo files
app.use(express.static('public'));
app.use('/images', express.static('images'));

app.use('/api/upload', uploadRoutes);
app.use('/api/storage', storageRoutes);

// Health check endpoint (public)
app.get('/health', (req, res) => {
  res.json({
    success: true,
    status: 'healthy',
    service: '3Speak Upload Service',
    timestamp: new Date().toISOString(),
    version: require('../package.json').version
  });
});

// Root endpoint
app.get('/', (req, res) => {
  res.json({
    success: true,
    service: '3Speak Simplified Upload Service',
    version: require('../package.json').version,
    endpoints: {
      health: '/health',
      upload: '/api/upload',
      prepare: '/api/upload/prepare',
      callback: '/api/upload/tus-callback',
      status: '/api/upload/video/:id/status',
      videos: '/api/upload/videos'
    }
  });
});

// ============================================
// ERROR HANDLING
// ============================================

// General error handler with descriptive messages
app.use((error, req, res, next) => {
  // Log the full error for debugging
  logger.error('Unhandled error:', {
    message: error.message,
    stack: error.stack,
    url: req.url,
    method: req.method,
    origin: req.headers.origin,
    ip: req.ip
  });
  
  // Determine error type and provide helpful message
  let statusCode = error.statusCode || error.status || 500;
  let errorResponse = {
    success: false,
    error: 'Internal server error'
  };
  
  // Validation errors
  if (error.name === 'ValidationError') {
    statusCode = 400;
    errorResponse = {
      success: false,
      error: 'Validation Error',
      message: error.message,
      details: error.errors || undefined
    };
  }
  // MongoDB errors
  else if (error.name === 'MongoError' || error.name === 'MongoServerError') {
    if (error.code === 11000) {
      statusCode = 409;
      errorResponse = {
        success: false,
        error: 'Duplicate Entry',
        message: 'A record with this identifier already exists.'
      };
    } else {
      errorResponse = {
        success: false,
        error: 'Database Error',
        message: process.env.NODE_ENV === 'production' 
          ? 'A database error occurred. Please try again.'
          : error.message
      };
    }
  }
  // JSON parsing errors
  else if (error.type === 'entity.parse.failed') {
    statusCode = 400;
    errorResponse = {
      success: false,
      error: 'Invalid JSON',
      message: 'The request body contains invalid JSON.'
    };
  }
  // File upload errors
  else if (error.code === 'LIMIT_FILE_SIZE') {
    statusCode = 413;
    errorResponse = {
      success: false,
      error: 'File Too Large',
      message: 'The uploaded file exceeds the maximum allowed size.'
    };
  }
  // Authentication errors
  else if (error.message && error.message.includes('auth')) {
    statusCode = 401;
    errorResponse = {
      success: false,
      error: 'Authentication Error',
      message: error.message
    };
  }
  // Development mode - show full error
  else if (process.env.NODE_ENV !== 'production') {
    errorResponse = {
      success: false,
      error: error.name || 'Error',
      message: error.message,
      stack: error.stack
    };
  }
  
  res.status(statusCode).json(errorResponse);
});

// 404 Handler
app.use((req, res) => {
  res.status(404).json({
    success: false,
    error: 'Endpoint not found'
  });
});

// ============================================
// GRACEFUL SHUTDOWN
// ============================================
const server = app.listen(PORT, async () => {
  logger.info(`3Speak Upload Service running on port ${PORT}`);
  logger.info(`Health check: http://localhost:${PORT}/health`);
  logger.info(`API documentation: http://localhost:${PORT}/`);
  
  try {
    // Connect to databases
    await connectDatabases();
    logger.info('Database connections established');
    
    // Start cleanup scheduler
    cleanupService.startScheduledCleanup();
    logger.info('Cleanup service started');
    
    // Start status healer for scheduled videos
    cleanupService.startStatusHealer();
    logger.info('Scheduled video status healer started');
    
  } catch (error) {
    logger.error('Startup error:', error);
    process.exit(1);
  }
});

const gracefulShutdown = (signal) => {
  logger.info(`Received ${signal}, starting graceful shutdown...`);
  
  server.close(async () => {
    logger.info('HTTP server closed');
    
    try {
      const { closeConnections } = require('./config/database');
      await closeConnections();
      logger.info('Database connections closed');
      
      // Stop cleanup service
      cleanupService.stopScheduledCleanup();
      
      // Stop status healer
      cleanupService.stopStatusHealer();
      
      logger.info('Graceful shutdown completed');
      process.exit(0);
    } catch (error) {
      logger.error('Error during shutdown:', error);
      process.exit(1);
    }
  });
  
  // Force shutdown after 30 seconds
  setTimeout(() => {
    logger.error('Could not close connections in time, forcefully shutting down');
    process.exit(1);
  }, 30000);
};

process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));
process.on('uncaughtException', (error) => {
  logger.error('Uncaught Exception:', error);
  process.exit(1);
});
process.on('unhandledRejection', (error) => {
  logger.error('Unhandled Rejection:', error);
  process.exit(1);
});

module.exports = app;