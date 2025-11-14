const express = require('express');
const multer = require('multer');
const { body, validationResult } = require('express-validator');
const fs = require('fs');
const path = require('path');

const ipfsService = require('../services/ipfs');
const jobService = require('../services/job');
const cleanupService = require('../services/cleanup');
const { requireAuth, uploadLimiter, authLimiter } = require('../middleware/auth');

const router = express.Router();

// ============================================
// MULTER CONFIGURATION FOR THUMBNAILS
// ============================================
const uploadDir = '/tmp/thumbnails';
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, { recursive: true });
}

const upload = multer({ 
  dest: uploadDir,
  limits: { 
    fileSize: 5 * 1024 * 1024, // 5MB limit for thumbnails
    files: 1
  },
  fileFilter: (req, file, cb) => {
    const allowedMimes = ['image/jpeg', 'image/jpg', 'image/png', 'image/gif', 'image/webp'];
    if (allowedMimes.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error('Only image files allowed for thumbnails'));
    }
  }
});

// ============================================
// VALIDATION MIDDLEWARE
// ============================================
const validatePrepareUpload = [
  body('owner')
    .isLength({ min: 3, max: 50 })
    .matches(/^[a-z0-9.-]+$/)
    .withMessage('Owner must be 3-50 characters, lowercase alphanumeric with dots and hyphens'),
  body('title')
    .isLength({ min: 5, max: 250 })
    .trim()
    .withMessage('Title must be 5-250 characters'),
  body('description')
    .isLength({ min: 1, max: 10000 })
    .trim()
    .withMessage('Description must be 1-10000 characters'),
  body('tags')
    .optional()
    .isArray({ max: 25 })
    .withMessage('Tags must be an array with maximum 25 items'),
  body('duration')
    .isFloat({ min: 0.1, max: 21600 })
    .withMessage('Duration must be between 0.1 and 21600 seconds (6 hours)'),
  body('size')
    .isInt({ min: 1000, max: 8000000000 })
    .withMessage('Size must be between 1000 bytes and 8GB'),
  body('originalFilename')
    .isLength({ min: 1, max: 255 })
    .withMessage('Original filename is required'),
  body('community')
    .optional()
    .isLength({ max: 50 })
    .withMessage('Community display name must be max 50 characters'),
  
  body('hive')
    .optional()
    .matches(/^hive-\d+$/)
    .withMessage('Hive must be in format "hive-123456"'),
  body('beneficiaries')
    .optional()
    .isString()
    .withMessage('Beneficiaries must be a JSON string'),
  body('category')
    .optional()
    .isIn(['general', 'technology', 'gaming', 'music', 'sports', 'entertainment', 'education', 'news'])
    .withMessage('Invalid category'),
  body('language')
    .optional()
    .isLength({ min: 2, max: 5 })
    .withMessage('Language must be 2-5 characters (e.g., "en", "es")'),
  body('hive')
    .optional()
    .matches(/^hive-\d+$/)
    .withMessage('Hive must be in format "hive-123456"'),
  body('app')
    .optional()
    .isLength({ max: 50 })
    .withMessage('App name must be max 50 characters'),
  body('declineRewards')
    .optional()
    .isBoolean()
    .withMessage('declineRewards must be boolean'),
  body('rewardPowerup')
    .optional()
    .isBoolean()
    .withMessage('rewardPowerup must be boolean'),
  body('votePercent')
    .optional()
    .isFloat({ min: 0, max: 1 })
    .withMessage('votePercent must be between 0 and 1'),
  (req, res, next) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ 
        success: false, 
        error: 'Validation failed',
        details: errors.array() 
      });
    }
    next();
  }
];

// ============================================
// HELPER FUNCTIONS
// ============================================
const generatePermlink = () => {
  return Math.random().toString(36).substring(2, 10).toLowerCase();
};

const getVideoModel = () => {
  return require('../models/Video')();
};

const getJobModel = () => {
  return require('../models/Job')();
};

// ============================================
// ROUTES
// ============================================

/**
 * 1. PREPARE UPLOAD
 * Creates video entry and returns upload information
 */
router.post('/prepare', 
  authLimiter, 
  uploadLimiter, 
  requireAuth, 
  upload.single('thumbnail'), 
  validatePrepareUpload, 
  async (req, res) => {
    try {
      const {
        owner,
        title,
        description,
        tags = [],
        duration,
        size,
        originalFilename,
        community,
        beneficiaries,
        category = 'general',
        language = 'en',
        hive,
        app,  // Should be null for auto-publish web uploads
        declineRewards = false,
        rewardPowerup = false,
        votePercent = 1,
        thumbnail_base64
      } = req.body;

      console.log(`📤 Preparing upload for ${owner}: "${title}"`);

      let thumbnailCid = null;

      // Handle thumbnail upload (file or base64)
      if (req.file) {
        console.log(`🖼️ Uploading thumbnail file: ${req.file.originalname}`);
        const uploadResult = await ipfsService.uploadThumbnail(req.file.path);
        thumbnailCid = uploadResult.hash;
        
        // Clean up temp file
        fs.unlinkSync(req.file.path);
      } else if (thumbnail_base64) {
        console.log('🖼️ Uploading base64 thumbnail');
        const uploadResult = await ipfsService.uploadThumbnailBase64(thumbnail_base64);
        thumbnailCid = uploadResult.hash;
      }

      // Create video document
      const Video = getVideoModel();
      // Thumbnail fallback logic:
      // - Prefer uploaded thumbnailCid
      // - Else, use DEFAULT_THUMBNAIL env var (can be either a full ipfs:// URI or a raw CID)
      // - Else, fallback to empty string (legacy expects a string, not null)
      const DEFAULT_THUMBNAIL = process.env.DEFAULT_THUMBNAIL || '';
      let thumbnailValue = '';
      if (thumbnailCid) {
        thumbnailValue = `ipfs://${thumbnailCid}`;
      } else if (DEFAULT_THUMBNAIL) {
        // If env value already contains ipfs:// prefix, keep it; otherwise prepend
        thumbnailValue = DEFAULT_THUMBNAIL.startsWith('ipfs://')
          ? DEFAULT_THUMBNAIL
          : `ipfs://${DEFAULT_THUMBNAIL}`;
      } else {
        // Use empty string as a safe non-null placeholder
        thumbnailValue = '';
      }

      const video = new Video({
        owner,
        permlink: generatePermlink(),
        title,
        description,
        tags: Array.isArray(tags) ? tags.join(',') : tags,
        tags_v2: Array.isArray(tags) ? tags : (tags ? tags.split(',') : []),
        thumbnail: thumbnailValue,
        originalFilename,
        duration: parseFloat(duration),
        size: parseInt(size),
        community: community || null,  // Display name like "Politics"
      hive: hive || null,           // Technical ID like "hive-165423"
        hive,
        app,
        category,
        language,
        declineRewards,
        rewardPowerup,
        votePercent,
        beneficiaries: beneficiaries || "[]",  // Empty - encoder adds payment after job completes
        local_filename: null, // Will be set during processing
        status: 'uploaded'
      });

      await video.save();

      console.log(`✅ Video entry created: ${video._id} (${owner}/${video.permlink})`);

      res.json({
        success: true,
        data: {
          video_id: video._id.toString(),
          permlink: video.permlink,
          tus_endpoint: process.env.TUS_ENDPOINT,
          metadata: {
            video_id: video._id.toString(),
            owner: video.owner,
            permlink: video.permlink
          }
        }
      });

    } catch (error) {
      console.error('❌ Prepare upload error:', error);
      res.status(500).json({
        success: false,
        error: process.env.NODE_ENV === 'production' 
          ? 'Upload preparation failed' 
          : error.message
      });
    }
  }
);

/**
 * 2. TUS UPLOAD CALLBACK
 * Called by TUS server when upload completes
 */
router.post('/tus-callback', async (req, res) => {
  try {
    const uploadData = req.body;
    
    if (!uploadData || !uploadData.Upload) {
      return res.status(400).json({
        success: false,
        error: 'Invalid callback data format'
      });
    }
    
    const { ID, Storage, MetaData } = uploadData.Upload;
    
    if (!MetaData || !MetaData.video_id || !MetaData.owner || !MetaData.permlink) {
      return res.status(400).json({
        success: false,
        error: 'Missing required metadata'
      });
    }
    
    const { video_id, owner, permlink } = MetaData;
    const filePath = Storage.Path;

    console.log(`📁 TUS callback for ${owner}/${permlink}: ${filePath}`);

    // Find video document
    const Video = getVideoModel();
    const video = await Video.findById(video_id);
    if (!video) {
      return res.status(404).json({
        success: false,
        error: 'Video not found'
      });
    }

    // Verify file exists
    if (!fs.existsSync(filePath)) {
      return res.status(404).json({
        success: false,
        error: 'Upload file not found'
      });
    }

    console.log(`⬆️ Uploading to IPFS: ${filePath}`);

    // Check if video already has IPFS hash and job (idempotency check)
    if (video.filename && video.filename.startsWith('ipfs://') && video.job_id) {
      console.log(`⚠️ Video already processed (hash: ${video.filename}, job: ${video.job_id})`);
      
      // Clean up temp file if it still exists
      try {
        if (fs.existsSync(filePath)) {
          fs.unlinkSync(filePath);
          console.log(`🗑️ Cleaned up duplicate upload temp file: ${filePath}`);
        }
      } catch (cleanupError) {
        console.warn(`⚠️ Failed to cleanup duplicate temp file: ${cleanupError.message}`);
      }
      
      return res.json({ 
        success: true,
        message: 'Video already processed',
        existing: true
      });
    }

    // Clean up expired idempotency locks (auto-healing)
    const Job = getJobModel();
    const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);
    await Job.deleteMany({
      status: 'idempotency_lock',
      created_at: { $lt: oneHourAgo }
    });

    // Check if encoding job already exists for this video (race condition protection)
    const existingJob = await Job.findOne({
      'metadata.video_owner': owner,
      'metadata.video_permlink': permlink
    });

    if (existingJob) {
      console.log(`⚠️ Encoding job already exists for ${owner}/${permlink}: ${existingJob.id}`);
      
      // Update video with existing job info if not set
      if (!video.job_id) {
        video.job_id = existingJob.id;
        if (!video.filename && existingJob.input && existingJob.input.uri) {
          // Extract IPFS hash from URI
          const ipfsMatch = existingJob.input.uri.match(/\/ipfs\/([a-zA-Z0-9]+)/);
          if (ipfsMatch) {
            video.filename = `ipfs://${ipfsMatch[1]}`;
          }
        }
        await video.save();
      }
      
      // Clean up temp file
      try {
        if (fs.existsSync(filePath)) {
          fs.unlinkSync(filePath);
          console.log(`🗑️ Cleaned up duplicate upload temp file: ${filePath}`);
        }
      } catch (cleanupError) {
        console.warn(`⚠️ Failed to cleanup duplicate temp file: ${cleanupError.message}`);
      }
      
      return res.json({ 
        success: true,
        message: 'Video already has encoding job',
        existing: true,
        job_id: existingJob.id
      });
    }

    // Create idempotency marker BEFORE starting IPFS upload
    // This prevents race condition when TUS hook retries
    const idempotencyKey = `${owner}_${permlink}_${video_id}`;
    const marker = await Job.findOneAndUpdate(
      { 
        'metadata.video_owner': owner,
        'metadata.video_permlink': permlink,
        status: 'idempotency_lock' // Special status for locking
      },
      { 
        $setOnInsert: {
          id: `lock_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
          status: 'idempotency_lock',
          metadata: {
            video_owner: owner,
            video_permlink: permlink,
            video_id: video_id,
            locked_at: new Date(),
            tus_upload_id: ID
          },
          expires_at: new Date(Date.now() + 45 * 60 * 1000) // Auto-expire in 45 minutes
        }
      },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    );

    // If we didn't create the lock, another request is processing this
    if (marker && marker.metadata.tus_upload_id !== ID) {
      console.log(`⚠️ Another TUS callback already processing ${owner}/${permlink}`);
      
      // Clean up temp file
      try {
        if (fs.existsSync(filePath)) {
          fs.unlinkSync(filePath);
          console.log(`🗑️ Cleaned up duplicate upload temp file: ${filePath}`);
        }
      } catch (cleanupError) {
        console.warn(`⚠️ Failed to cleanup duplicate temp file: ${cleanupError.message}`);
      }
      
      return res.json({ 
        success: true,
        message: 'Video upload already being processed',
        duplicate_request: true
      });
    }

    console.log(`🔒 Acquired idempotency lock for ${owner}/${permlink}`);

    // Upload with fallback strategy
    let uploadResult;
    try {
      uploadResult = await ipfsService.uploadFile(filePath);
    } catch (uploadError) {
      // IPFS upload failed - remove the lock
      await Job.deleteOne({ 
        'metadata.video_owner': owner,
        'metadata.video_permlink': permlink,
        status: 'idempotency_lock'
      });
      console.error(`❌ IPFS upload failed, lock released for ${owner}/${permlink}`);
      throw uploadError;
    }
    
    console.log(`📋 Creating encoding job (replacing lock)...`);
    
    // Create encoding job with appropriate gateway URL
    const jobId = await jobService.createEncodingJob(
      video, 
      uploadResult.hash, 
      video.size, 
      uploadResult.gatewayUrl
    );
    
    // Remove the idempotency lock now that real job exists
    await Job.deleteOne({ 
      'metadata.video_owner': owner,
      'metadata.video_permlink': permlink,
      status: 'idempotency_lock'
    });
    console.log(`🔓 Idempotency lock removed, real job created: ${jobId}`);
    
    // Update video document
    video.filename = `ipfs://${uploadResult.hash}`;
    video.status = 'encoding_ipfs';
    video.job_id = jobId;
    video.local_filename = null; // Clear temp path
    video.fallback_mode = uploadResult.fallbackMode;
    video.cleanup_eligible = false; // Not eligible until published
    
    await video.save();
    
    // Clean up temp file immediately (zero local storage!)
    try {
      fs.unlinkSync(filePath);
      console.log(`🗑️ Cleaned up temp file: ${filePath}`);
    } catch (cleanupError) {
      console.warn(`⚠️ Failed to cleanup temp file: ${cleanupError.message}`);
    }

    console.log(`✅ Upload complete: ${owner}/${permlink} → ipfs://${uploadResult.hash}`);

    res.json({ success: true });

  } catch (error) {
    console.error('❌ TUS callback error:', error);
    res.status(500).json({
      success: false,
      error: process.env.NODE_ENV === 'production' 
        ? 'Upload processing failed' 
        : error.message
    });
  }
});

/**
 * 3. VIDEO STATUS
 * Returns current video and job status
 */
router.get('/video/:id/status', requireAuth, async (req, res) => {
  try {
    const Video = getVideoModel();
    const video = await Video.findById(req.params.id);
    
    if (!video) {
      return res.status(404).json({
        success: false,
        error: 'Video not found'
      });
    }

    let jobData = null;
    if (video.job_id) {
      const job = await jobService.findJobByVideo(video.owner, video.permlink);
      if (job) {
        jobData = job.toPublicJSON();
      }
    }

    res.json({
      success: true,
      data: {
        video: video.toPublicJSON(),
        job: jobData
      }
    });

  } catch (error) {
    console.error('❌ Status check error:', error);
    res.status(500).json({
      success: false,
      error: process.env.NODE_ENV === 'production' 
        ? 'Status check failed' 
        : error.message
    });
  }
});

/**
 * 4. LIST VIDEOS
 * Returns videos for a specific owner
 */
router.get('/videos', requireAuth, async (req, res) => {
  try {
    const {
      owner,
      status,
      limit = 20,
      offset = 0
    } = req.query;

    if (!owner) {
      return res.status(400).json({
        success: false,
        error: 'Owner parameter is required'
      });
    }

    const Video = getVideoModel();
    const videos = await Video.findByOwner(owner, {
      status,
      limit: parseInt(limit),
      offset: parseInt(offset)
    });

    const query = { owner };
    if (status) query.status = status;
    const total = await Video.countDocuments(query);

    res.json({
      success: true,
      data: {
        videos: videos.map(v => v.toPublicJSON()),
        total,
        limit: parseInt(limit),
        offset: parseInt(offset)
      }
    });

  } catch (error) {
    console.error('❌ List videos error:', error);
    res.status(500).json({
      success: false,
      error: process.env.NODE_ENV === 'production' 
        ? 'Failed to list videos' 
        : error.message
    });
  }
});

/**
 * 5. ENHANCED HEALTH CHECK
 * Returns comprehensive service health information
 */
router.get('/health', async (req, res) => {
  try {
    const checks = {
      timestamp: new Date().toISOString(),
      uptime: process.uptime(),
      memory: process.memoryUsage(),
      service: 'healthy'
    };

    // Database connectivity
    try {
      const Video = getVideoModel();
      await Video.findOne({}).limit(1);
      checks.database = 'healthy';
    } catch (dbError) {
      checks.database = 'unhealthy';
      checks.service = 'degraded';
      checks.database_error = dbError.message;
    }

    // IPFS connectivity
    const ipfsStatus = await ipfsService.getServiceStatus();
    checks.ipfs = ipfsStatus;
    
    if (ipfsStatus.status === 'degraded') {
      checks.service = 'degraded';
    }

    // Job service health
    const jobHealth = await jobService.healthCheck();
    checks.job_service = jobHealth;
    
    if (!jobHealth.healthy) {
      checks.service = 'degraded';
    }

    // Cleanup service health
    const cleanupHealth = await cleanupService.healthCheck();
    checks.cleanup_service = cleanupHealth;

    // Disk space check for temp directory
    try {
      const stats = await fs.promises.stat('/tmp');
      const tempDir = await fs.promises.opendir('/tmp');
      let fileCount = 0;
      for await (const dirent of tempDir) {
        if (dirent.isFile()) fileCount++;
      }
      
      checks.storage = {
        temp_files: fileCount,
        status: fileCount < 1000 ? 'healthy' : 'warning'
      };
      
      if (fileCount >= 1000) checks.service = 'degraded';
    } catch (storageError) {
      checks.storage = {
        status: 'unknown',
        error: storageError.message
      };
    }

    const statusCode = checks.service === 'healthy' ? 200 : 
                      checks.service === 'degraded' ? 200 : 503;

    res.status(statusCode).json(checks);

  } catch (error) {
    res.status(503).json({
      success: false,
      status: 'unhealthy', 
      error: error.message,
      timestamp: new Date().toISOString()
    });
  }
});

/**
 * 6. MANUAL CLEANUP TRIGGER
 * Triggers immediate cleanup process
 */
router.post('/cleanup', requireAuth, async (req, res) => {
  try {
    console.log('🧹 Manual cleanup triggered');
    const result = await cleanupService.performCleanup();
    
    res.json({
      success: true,
      message: 'Cleanup completed',
      result
    });
  } catch (error) {
    console.error('❌ Manual cleanup error:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * 7. SERVICE STATISTICS
 * Returns comprehensive service statistics
 */
router.get('/stats', requireAuth, async (req, res) => {
  try {
    const [
      cleanupStats,
      jobStats,
      ipfsStatus
    ] = await Promise.all([
      cleanupService.getCleanupStats(),
      jobService.getJobStats(),
      ipfsService.getServiceStatus()
    ]);

    res.json({
      success: true,
      data: {
        cleanup: cleanupStats,
        jobs: jobStats,
        ipfs: ipfsStatus,
        timestamp: new Date().toISOString()
      }
    });
  } catch (error) {
    console.error('❌ Stats error:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * 8. METRICS ENDPOINT (Prometheus compatible)
 * Returns metrics in Prometheus format
 */
router.get('/metrics', async (req, res) => {
  try {
    const [cleanupStats, jobStats] = await Promise.all([
      cleanupService.getCleanupStats(),
      jobService.getJobStats()
    ]);

    const metrics = `
# HELP upload_videos_total Total number of videos processed
# TYPE upload_videos_total counter
upload_videos_total{status="total"} ${cleanupStats.total}
upload_videos_total{status="published"} ${cleanupStats.published}
upload_videos_total{status="cleaned"} ${cleanupStats.cleaned}

# HELP upload_jobs_total Total number of encoding jobs
# TYPE upload_jobs_total counter
${Object.entries(jobStats.byStatus).map(([status, data]) => 
  `upload_jobs_total{status="${status}"} ${data.count}`
).join('\n')}

# HELP upload_storage_bytes Storage usage in bytes
# TYPE upload_storage_bytes gauge
upload_storage_bytes{type="total"} ${cleanupStats.total_size || 0}
upload_storage_bytes{type="fallback"} ${cleanupStats.fallback_size || 0}
upload_storage_bytes{type="cleaned"} ${cleanupStats.storage_cleaned_bytes || 0}

# HELP upload_service_uptime_seconds Service uptime in seconds
# TYPE upload_service_uptime_seconds counter
upload_service_uptime_seconds ${process.uptime()}
    `.trim();

    res.set('Content-Type', 'text/plain').send(metrics);
  } catch (error) {
    res.status(500).set('Content-Type', 'text/plain').send(`# Error generating metrics: ${error.message}`);
  }
});

/**
 * STANDALONE THUMBNAIL UPLOAD
 * Upload thumbnail for existing video and update MongoDB
 */
router.post('/thumbnail/:video_id',
  requireAuth,
  upload.single('thumbnail'),
  async (req, res) => {
    try {
      const { video_id } = req.params;
      
      if (!req.file) {
        return res.status(400).json({
          success: false,
          error: 'No thumbnail file provided'
        });
      }

      console.log(`🖼️ Uploading thumbnail for video: ${video_id}`);
      
      // Upload to IPFS supernode
      const uploadResult = await ipfsService.uploadThumbnail(req.file.path);
      const thumbnailCid = uploadResult.hash;
      const thumbnailUri = `ipfs://${thumbnailCid}`;
      
      console.log(`✅ Thumbnail uploaded: ${thumbnailUri}`);
      
      // Update video document
      const Video = getVideoModel();
      const video = await Video.findByIdAndUpdate(
        video_id,
        { thumbnail: thumbnailUri },
        { new: true }
      );
      
      if (!video) {
        return res.status(404).json({
          success: false,
          error: 'Video not found'
        });
      }
      
      console.log(`📝 Updated video ${video.owner}/${video.permlink} with thumbnail`);
      
      // Clean up temp file
      try {
        const fs = require('fs').promises;
        await fs.unlink(req.file.path);
      } catch (err) {
        console.warn(`⚠️ Failed to cleanup temp thumbnail: ${err.message}`);
      }
      
      res.json({
        success: true,
        data: {
          video_id: video._id,
          owner: video.owner,
          permlink: video.permlink,
          thumbnail: thumbnailUri,
          thumbnail_url: thumbnailUri, // Frontend expects this
          ipfs_hash: thumbnailCid
        }
      });
      
    } catch (error) {
      console.error('❌ Thumbnail upload error:', error);
      res.status(500).json({
        success: false,
        error: error.message
      });
    }
  }
);

module.exports = router;