const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const winston = require('winston');
require('dotenv').config();

const uploadRoutes = require('./routes/upload');
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
      connectSrc: [
        "'self'", 
        "http://localhost:1080", 
        "https://api.hive.blog", 
        "https://hived.privex.io", 
        "https://anyx.io", 
        "https://api.openhive.network"
      ]
    }
  }
}));
app.use(cors({
  origin: process.env.NODE_ENV === 'production' 
    ? ['https://video.3speak.tv', 'https://3speak.tv', 'https://3speak.co'] 
    : true,
  credentials: true
}));

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
app.use((error, req, res, next) => {
  logger.error('Unhandled error:', error);
  res.status(500).json({
    success: false,
    error: process.env.NODE_ENV === 'production' 
      ? 'Internal server error' 
      : error.message
  });
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