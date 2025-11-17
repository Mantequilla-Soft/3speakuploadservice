const express = require('express');
const router = express.Router();
const storageService = require('../services/storage');
const winston = require('winston');

const logger = winston.createLogger({
  level: process.env.LOG_LEVEL || 'info',
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.json()
  ),
  transports: [
    new winston.transports.Console({ format: winston.format.simple() })
  ]
});

// Basic auth middleware for storage admin
const requireStorageAuth = (req, res, next) => {
  const authHeader = req.headers.authorization;
  
  if (!authHeader || !authHeader.startsWith('Basic ')) {
    res.setHeader('WWW-Authenticate', 'Basic realm="IPFS Storage Management"');
    return res.status(401).json({
      success: false,
      error: 'Authentication required'
    });
  }

  try {
    const base64Credentials = authHeader.split(' ')[1];
    const credentials = Buffer.from(base64Credentials, 'base64').toString('utf-8');
    const [username, password] = credentials.split(':');

    const validUsername = process.env.IPFS_STORAGE_ADMIN_USERNAME || 'admin';
    const validPassword = process.env.IPFS_STORAGE_ADMIN_PASSWORD;

    if (!validPassword) {
      logger.error('IPFS_STORAGE_ADMIN_PASSWORD not configured');
      return res.status(500).json({
        success: false,
        error: 'Storage authentication not configured'
      });
    }

    if (username === validUsername && password === validPassword) {
      next();
    } else {
      res.setHeader('WWW-Authenticate', 'Basic realm="IPFS Storage Management"');
      return res.status(401).json({
        success: false,
        error: 'Invalid credentials'
      });
    }
  } catch (error) {
    logger.error('Auth error:', error);
    res.setHeader('WWW-Authenticate', 'Basic realm="IPFS Storage Management"');
    return res.status(401).json({
      success: false,
      error: 'Invalid authentication format'
    });
  }
};

/**
 * GET /api/storage/stats
 * Get comprehensive storage statistics
 */
router.get('/stats', requireStorageAuth, async (req, res) => {
  try {
    const stats = await storageService.getStorageStats();
    
    res.json({
      success: true,
      data: stats
    });
  } catch (error) {
    logger.error('Error getting storage stats:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * GET /api/storage/pinned
 * List all pinned files with metadata
 */
router.get('/pinned', requireStorageAuth, async (req, res) => {
  try {
    const pinnedFiles = await storageService.listPinnedFiles();
    
    res.json({
      success: true,
      count: pinnedFiles.length,
      data: pinnedFiles
    });
  } catch (error) {
    logger.error('Error listing pinned files:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * POST /api/storage/unpin
 * Unpin specified files
 * Body: { cids: ['Qm...', 'Qm...'], force: false }
 */
router.post('/unpin', requireStorageAuth, async (req, res) => {
  try {
    const { cids, force = false } = req.body;

    if (!cids || !Array.isArray(cids) || cids.length === 0) {
      return res.status(400).json({
        success: false,
        error: 'Invalid request: cids array is required'
      });
    }

    logger.info(`Unpinning ${cids.length} files...`);
    const results = await storageService.unpinFiles(cids, force);
    
    res.json({
      success: true,
      data: results,
      message: `Unpinned ${results.success.length} files, ${results.failed.length} failed`
    });
  } catch (error) {
    logger.error('Error unpinning files:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * GET /api/storage/unpinned
 * List unpinned files (not yet garbage collected)
 */
router.get('/unpinned', requireStorageAuth, async (req, res) => {
  try {
    const unpinnedFiles = await storageService.listUnpinnedFiles();
    const estimate = await storageService.estimateReclaimableSpace();
    
    res.json({
      success: true,
      count: unpinnedFiles.length,
      data: unpinnedFiles,
      reclaimable: estimate
    });
  } catch (error) {
    logger.error('Error listing unpinned files:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * POST /api/storage/gc
 * Run garbage collection
 */
router.post('/gc', requireStorageAuth, async (req, res) => {
  try {
    logger.info('Garbage collection requested by admin');
    
    const result = await storageService.runGarbageCollection();
    
    res.json({
      success: true,
      data: result,
      message: `Garbage collection completed. Freed ${storageService.formatBytes(result.spaceFreed)}`
    });
  } catch (error) {
    logger.error('Error running garbage collection:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * GET /api/storage/health
 * Quick health check for storage system
 */
router.get('/health', requireStorageAuth, async (req, res) => {
  try {
    const stats = await storageService.getStorageStats();
    
    res.json({
      success: true,
      healthy: stats.status.level !== 'critical',
      status: stats.status
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      healthy: false,
      error: error.message
    });
  }
});

module.exports = router;
