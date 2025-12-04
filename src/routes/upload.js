const express = require('express');
const multer = require('multer');
const { body, validationResult } = require('express-validator');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const ipfsService = require('../services/ipfs');
const jobService = require('../services/job');
const cleanupService = require('../services/cleanup');
const { requireAuth, uploadLimiter, authLimiter } = require('../middleware/auth');

const router = express.Router();

// ============================================
// CONTENT CREATOR VERIFICATION
// ============================================
const getContentCreatorModel = () => {
  return require('../models/ContentCreator')();
};

/**
 * Middleware: Check if user can upload
 * - Creates content creator if doesn't exist
 * - Blocks banned users
 * - Blocks users with canUpload: false
 */
const checkContentCreator = async (req, res, next) => {
  try {
    const { owner } = req.body;
    
    if (!owner) {
      return res.status(400).json({
        success: false,
        error: 'Username (owner) is required'
      });
    }

    const ContentCreator = getContentCreatorModel();
    const permission = await ContentCreator.checkUploadPermission(owner);

    if (!permission.canUpload) {
      console.warn(`🚫 Upload blocked for ${owner}: ${permission.reason}`);
      return res.status(403).json({
        success: false,
        error: permission.reason
      });
    }

    console.log(`✅ Upload permission verified for ${owner}`);
    next();
  } catch (error) {
    console.error('❌ Content creator check error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to verify upload permission'
    });
  }
};

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
    .isLength({ min: 1, max: 50000 })
    .trim()
    .withMessage('Description must be 1-50000 characters'),
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
    .custom((value) => {
      // Accept string directly
      if (typeof value === 'string') {
        if (value.length > 50) {
          throw new Error('Community name must be max 50 characters');
        }
        return true;
      }
      // Accept object with name property (extract it)
      if (typeof value === 'object' && value !== null) {
        if (value.name && typeof value.name === 'string') {
          if (value.name.length > 50) {
            throw new Error('Community name must be max 50 characters');
          }
          return true;
        }
        throw new Error('Community object must have a "name" property');
      }
      throw new Error('Community must be a string or object with name property');
    })
    .withMessage('Invalid community format'),
  
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
 * 0. INITIALIZE UPLOAD (UPLOAD-FIRST FLOW)
 * Creates temporary upload entry before video metadata provided
 * Returns upload_id and tus_endpoint for immediate upload
 * Video entry created later in /finalize after TUS completes
 */
router.post('/init',
  authLimiter,
  uploadLimiter,
  requireAuth,
  checkContentCreator,
  [
    body('owner')
      .isLength({ min: 3, max: 50 })
      .matches(/^[a-z0-9.-]+$/)
      .withMessage('Owner must be 3-50 characters, lowercase alphanumeric with dots and hyphens'),
    body('originalFilename')
      .isLength({ min: 1, max: 255 })
      .withMessage('Filename required'),
    body('size')
      .isInt({ min: 1000 })
      .withMessage('File size must be at least 1000 bytes'),
    body('duration')
      .isFloat({ min: 0.1 })
      .withMessage('Duration must be at least 0.1 seconds')
  ],
  async (req, res) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({
          success: false,
          errors: errors.array()
        });
      }

      const { owner, originalFilename, size, duration } = req.body;

      // Generate unique upload ID
      const crypto = require('crypto');
      const upload_id = `${owner}_${Date.now()}_${crypto.randomBytes(8).toString('hex')}`;

      console.log(`🚀 Initializing upload-first for ${owner}: ${originalFilename}`);

      // Create temporary upload record
      const TempUpload = require('../models/TempUpload')();
      await TempUpload.createUpload({
        upload_id,
        owner,
        originalFilename,
        size,
        duration
      });

      // Return TUS endpoint for immediate upload
      const tusEndpoint = process.env.TUS_ENDPOINT || 'https://video.3speak.tv/files';

      res.json({
        success: true,
        data: {
          upload_id,
          tus_endpoint: tusEndpoint,
          expires_in: 3600 // 1 hour
        }
      });

      console.log(`✅ Upload initialized: ${upload_id}`);

    } catch (error) {
      console.error('❌ Init upload error:', error);
      res.status(500).json({
        success: false,
        error: process.env.NODE_ENV === 'production'
          ? 'Failed to initialize upload'
          : error.message
      });
    }
  }
);

/**
 * 1. PREPARE UPLOAD
 * Creates video entry and returns upload information
 */
router.post('/prepare', 
  authLimiter, 
  uploadLimiter, 
  requireAuth, 
  checkContentCreator,  // New: Verify user can upload
  upload.single('thumbnail'), 
  validatePrepareUpload, 
  async (req, res) => {
    try {
      let {
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

      // Normalize community to string if it's an object
      if (community && typeof community === 'object') {
        console.log(`📋 Extracting community name from object:`, community);
        community = community.name || community.title || null;
        if (community) {
          console.log(`✅ Using community name: ${community}`);
        } else {
          console.warn(`⚠️  Community object has no name/title property, setting to null`);
          community = null;
        }
      }

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
        community: community || hive || null,  // Community ID (e.g., "hive-110011")
        hive: community || hive || null,       // Same value - for autopublish compatibility
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

      // Build TUS endpoint based on request protocol/host
      // If accessed via HTTPS domain, return HTTPS TUS endpoint
      const protocol = req.protocol; // 'http' or 'https'
      const host = req.get('host'); // 'video.3speak.tv' or 'localhost:8080'
      const tusEndpoint = `${protocol}://${host}/files`;

      res.json({
        success: true,
        data: {
          video_id: video._id.toString(),
          permlink: video.permlink,
          tus_endpoint: tusEndpoint,
          metadata: {
            video_id: video._id.toString(),
            owner: video.owner,
            permlink: video.permlink
          }
        }
      });

    } catch (error) {
      console.error('❌ Prepare upload error:', error);
      
      // Handle Mongoose validation errors with better messages
      if (error.name === 'ValidationError') {
        const validationErrors = Object.keys(error.errors).map(field => {
          const err = error.errors[field];
          // Format value display - don't dump huge objects
          let valueDisplay = err.value;
          if (typeof err.value === 'object' && err.value !== null) {
            valueDisplay = `[Object: ${err.value.name || err.value.title || 'no name'}]`;
          }
          
          return {
            field,
            message: err.message,
            value: valueDisplay
          };
        });
        
        console.warn('⚠️  Validation error details:', validationErrors);
        
        return res.status(400).json({
          success: false,
          error: 'Validation failed',
          details: validationErrors
        });
      }
      
      // Generic error response
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
 * Handles both traditional flow (video_id) and upload-first flow (upload_id)
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
    const filePath = Storage.Path;
    
    if (!MetaData) {
      return res.status(400).json({
        success: false,
        error: 'Missing metadata'
      });
    }

    // ============================================
    // FLOW 1: TRADITIONAL (video_id in metadata)
    // ============================================
    if (MetaData.video_id) {
      const { video_id, owner, permlink } = MetaData;
      
      if (!owner || !permlink) {
        return res.status(400).json({
          success: false,
          error: 'Missing owner or permlink in metadata'
        });
      }

      console.log(`📁 TUS callback (traditional) for ${owner}/${permlink}: ${filePath}`);

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

      // Continue with traditional processing...
      // (existing IPFS upload and job creation code follows below)
    }
    
    // ============================================
    // FLOW 2: UPLOAD-FIRST (upload_id in metadata)
    // ============================================
    else if (MetaData.upload_id) {
      const { upload_id } = MetaData;
      
      console.log(`📁 TUS callback (upload-first) for upload_id: ${upload_id}`);

      // Find temporary upload
      const TempUpload = require('../models/TempUpload')();
      const tempUpload = await TempUpload.findOne({ upload_id });
      
      if (!tempUpload) {
        return res.status(404).json({
          success: false,
          error: 'Upload not found'
        });
      }

      // Verify file exists
      if (!fs.existsSync(filePath)) {
        return res.status(404).json({
          success: false,
          error: 'Upload file not found'
        });
      }

      // Mark TUS upload as completed
      await TempUpload.markTusCompleted(upload_id, filePath);
      
      console.log(`✅ TUS upload marked complete for ${upload_id} - awaiting finalization`);
      
      // Return success - video entry will be created in /finalize
      return res.json({ 
        success: true,
        message: 'Upload completed, awaiting finalization'
      });
    }
    
    // ============================================
    // ERROR: No valid flow identifier
    // ============================================
    else {
      return res.status(400).json({
        success: false,
        error: 'Missing video_id or upload_id in metadata'
      });
    }

    // ============================================
    // TRADITIONAL FLOW CONTINUES HERE
    // ============================================
    const { video_id, owner, permlink } = MetaData;
    const Video = getVideoModel();
    const video = await Video.findById(video_id);

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

    console.log(`⬆️ Uploading to IPFS: ${filePath}`);

    // Upload to local IPFS (fast, reliable)
    const uploadResult = await ipfsService.uploadFile(filePath);
    
    console.log(`📋 Creating encoding job...`);
    
    // LAST SECOND CHECK: Does a job already exist? (Simple duplicate prevention)
    const Job = getJobModel();
    const existingJob = await Job.findOne({
      'metadata.video_owner': owner,
      'metadata.video_permlink': permlink
    });
    
    if (existingJob) {
      console.log(`⚠️ Job already exists for ${owner}/${permlink}: ${existingJob.id} - Skipping job creation`);
      
      // Update video with existing job info
      if (!video.job_id) {
        video.job_id = existingJob.id;
      }
      if (!video.filename) {
        video.filename = `ipfs://${uploadResult.hash}`;
      }
      await video.save();
      
      // Clean up temp file
      try {
        fs.unlinkSync(filePath);
        console.log(`🗑️ Cleaned up temp file: ${filePath}`);
      } catch (cleanupError) {
        console.warn(`⚠️ Failed to cleanup temp file: ${cleanupError.message}`);
      }
      
      return res.json({ 
        success: true,
        message: 'Job already exists',
        job_id: existingJob.id
      });
    }
    
    // Create encoding job with appropriate gateway URL
    const jobId = await jobService.createEncodingJob(
      video, 
      uploadResult.hash, 
      video.size, 
      uploadResult.gatewayUrl
    );
    
    console.log(`✅ Job created: ${jobId}`);
    
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
 * 2B. FINALIZE UPLOAD (UPLOAD-FIRST FLOW)
 * Completes upload after TUS finishes by creating video entry
 * Requires upload_id from /init endpoint
 */
router.post('/finalize',
  authLimiter,
  uploadLimiter,
  requireAuth,
  upload.single('thumbnail'),
  [
    body('upload_id')
      .isLength({ min: 10 })
      .withMessage('Valid upload_id required'),
    body('title')
      .isLength({ min: 5, max: 250 })
      .trim()
      .withMessage('Title must be 5-250 characters'),
    body('description')
      .isLength({ min: 1, max: 50000 })
      .trim()
      .withMessage('Description must be 1-50000 characters'),
    body('tags')
      .optional()
      .isArray({ min: 1, max: 10 })
      .withMessage('Tags must be an array (1-10 items)'),
    body('permlink')
      .optional()
      .isLength({ min: 3, max: 255 })
      .matches(/^[a-z0-9-]+$/)
      .withMessage('Permlink must be lowercase alphanumeric with hyphens'),
    body('category')
      .optional()
      .isIn(['general', 'news', 'vlogs', 'gaming', 'education', 'sports', 'music', 'crypto'])
      .withMessage('Invalid category'),
    body('language')
      .optional()
      .isLength({ min: 2, max: 5 })
      .matches(/^[a-z]{2}(-[A-Z]{2})?$/)
      .withMessage('Language must be ISO 639-1 code (e.g., "en", "es", "zh-CN")'),
    body('beneficiaries')
      .optional()
      .isArray()
      .withMessage('Beneficiaries must be an array'),
    body('declineRewards')
      .optional()
      .isBoolean()
      .withMessage('declineRewards must be boolean'),
    body('rewardPowerup')
      .optional()
      .isBoolean()
      .withMessage('rewardPowerup must be boolean')
  ],
  async (req, res) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({
          success: false,
          errors: errors.array()
        });
      }

      const {
        upload_id,
        title,
        description,
        tags = [],
        permlink,
        community,
        beneficiaries,
        category = 'general',
        language = 'en',
        hive,
        app,
        declineRewards = false,
        rewardPowerup = false,
        votePercent = 1,
        thumbnail_base64
      } = req.body;

      console.log(`🏁 Finalizing upload: ${upload_id}`);

      // Find temporary upload
      const TempUpload = require('../models/TempUpload')();
      const tempUpload = await TempUpload.findOne({ upload_id });

      if (!tempUpload) {
        return res.status(404).json({
          success: false,
          error: 'Upload not found or expired'
        });
      }

      if (tempUpload.finalized) {
        return res.status(400).json({
          success: false,
          error: 'Upload already finalized',
          video_id: tempUpload.video_id
        });
      }

      if (!tempUpload.tus_completed) {
        return res.status(400).json({
          success: false,
          error: 'TUS upload not completed yet'
        });
      }

      if (tempUpload.isExpired()) {
        return res.status(410).json({
          success: false,
          error: 'Upload expired'
        });
      }

      const owner = tempUpload.owner;

      console.log(`📝 Creating video entry for ${owner}: "${title}"`);

      // Normalize community to string if it's an object
      let communityStr = community;
      if (community && typeof community === 'object') {
        console.log(`📋 Extracting community name from object:`, community);
        communityStr = community.name || community.title || null;
        if (communityStr) {
          console.log(`✅ Using community name: ${communityStr}`);
        } else {
          console.warn(`⚠️  Community object has no name/title property, setting to null`);
          communityStr = null;
        }
      }

      // Handle thumbnail upload (file or base64)
      let thumbnailCid = null;
      if (req.file) {
        console.log(`🖼️ Uploading thumbnail file: ${req.file.originalname}`);
        const uploadResult = await ipfsService.uploadThumbnail(req.file.path);
        thumbnailCid = uploadResult.hash;
        fs.unlinkSync(req.file.path);
      } else if (thumbnail_base64) {
        console.log('🖼️ Uploading base64 thumbnail');
        const uploadResult = await ipfsService.uploadThumbnailBase64(thumbnail_base64);
        thumbnailCid = uploadResult.hash;
      }

      // Create video document
      const Video = getVideoModel();
      const DEFAULT_THUMBNAIL = process.env.DEFAULT_THUMBNAIL || '';
      let thumbnailValue = '';
      if (thumbnailCid) {
        thumbnailValue = `ipfs://${thumbnailCid}`;
      } else if (DEFAULT_THUMBNAIL) {
        thumbnailValue = DEFAULT_THUMBNAIL.startsWith('ipfs://')
          ? DEFAULT_THUMBNAIL
          : `ipfs://${DEFAULT_THUMBNAIL}`;
      }

      // Generate 8-character permlink (required by 3Speak schema)
      const generatedPermlink = permlink || crypto.randomBytes(4).toString('hex');
      
      const videoData = {
        owner,
        title,
        description,
        permlink: generatedPermlink,
        tags_v2: Array.isArray(tags) ? tags : [tags],
        filename: null, // Will be set after IPFS upload
        size: tempUpload.size,
        duration: tempUpload.duration,
        thumbnail: thumbnailValue,
        community: communityStr || hive || null,
        hive: communityStr || hive || null,
        category,
        language,
        status: 'uploaded', // Initial status, will change to encoding_ipfs after job created
        beneficiaries: JSON.stringify(beneficiaries || []), // Must be JSON string for legacy compatibility
        declineRewards,
        fromMobile: false,
        app: app || null,
        local_filename: tempUpload.tus_file_path,
        originalFilename: tempUpload.originalFilename,
        created: new Date()
      };

      const video = await Video.create(videoData);
      console.log(`✅ Video created: ${video._id} (${owner}/${video.permlink})`);

      // Mark temporary upload as finalized
      await TempUpload.markFinalized(upload_id, video._id.toString());

      // Now trigger IPFS upload and job creation
      // (This is the same logic as the TUS callback)
      console.log(`⬆️ Uploading to IPFS: ${tempUpload.tus_file_path}`);

      const uploadResult = await ipfsService.uploadFile(tempUpload.tus_file_path);

      console.log(`📋 Creating encoding job...`);

      const Job = getJobModel();
      const existingJob = await Job.findOne({
        'metadata.video_owner': owner,
        'metadata.video_permlink': video.permlink
      });

      if (existingJob) {
        console.log(`⚠️ Job already exists for ${owner}/${video.permlink}: ${existingJob.id}`);
        video.job_id = existingJob.id;
        video.filename = `ipfs://${uploadResult.hash}`;
        await video.save();

        try {
          fs.unlinkSync(tempUpload.tus_file_path);
          console.log(`🗑️ Cleaned up temp file: ${tempUpload.tus_file_path}`);
        } catch (cleanupError) {
          console.warn(`⚠️ Failed to cleanup temp file: ${cleanupError.message}`);
        }

        return res.json({
          success: true,
          message: 'Job already exists',
          data: {
            video_id: video._id,
            job_id: existingJob.id
          }
        });
      }

      const jobId = await jobService.createEncodingJob(
        video,
        uploadResult.hash,
        video.size,
        uploadResult.gatewayUrl
      );

      console.log(`✅ Job created: ${jobId}`);

      // Update video document
      video.filename = `ipfs://${uploadResult.hash}`;
      video.status = 'encoding_ipfs';
      video.job_id = jobId;
      video.local_filename = null;
      video.fallback_mode = uploadResult.fallbackMode;
      video.cleanup_eligible = false;

      await video.save();

      // Clean up temp file
      try {
        fs.unlinkSync(tempUpload.tus_file_path);
        console.log(`🗑️ Cleaned up temp file: ${tempUpload.tus_file_path}`);
      } catch (cleanupError) {
        console.warn(`⚠️ Failed to cleanup temp file: ${cleanupError.message}`);
      }

      console.log(`✅ Upload finalized: ${owner}/${video.permlink} → ipfs://${uploadResult.hash}`);

      res.json({
        success: true,
        data: {
          video_id: video._id,
          permlink: video.permlink,
          job_id: jobId
        }
      });

    } catch (error) {
      console.error('❌ Finalize upload error:', error);
      res.status(500).json({
        success: false,
        error: process.env.NODE_ENV === 'production'
          ? 'Failed to finalize upload'
          : error.message
      });
    }
  }
);

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

// ============================================
// GET IN-PROGRESS VIDEOS
// ============================================
/**
 * Get videos currently being processed for a user
 * Returns job IDs so frontend can poll encoding progress
 * 
 * Frontend use case:
 * - User uploads video and hits "publish"
 * - User navigates to homepage
 * - Homepage calls /api/upload/in-progress
 * - If videos are encoding, show progress UI with job_id polling
 * 
 * Query logic:
 * - Find videos owned by user
 * - Filter by encoding status (not published/failed yet)
 * - Fetch full job data for each video
 * - Calculate display-ready status labels and progress
 * - Return everything frontend needs in ONE call
 */
router.get('/in-progress', requireAuth, async (req, res) => {
  try {
    const owner = req.body.owner || req.headers['x-hive-username'];
    
    if (!owner) {
      return res.status(400).json({
        success: false,
        error: 'Username required'
      });
    }
    
    console.log(`🔍 Checking in-progress videos for: ${owner}`);
    
    const Video = getVideoModel();
    
    // Calculate cutoff time (6 hours ago)
    const sixHoursAgo = new Date(Date.now() - 6 * 60 * 60 * 1000);
    
    // Find videos that are still being processed (and less than 6 hours old)
    const inProgressVideos = await Video.find({
      owner,
      status: {
        $in: [
          'uploaded',           // Just uploaded, not yet encoding
          'encoding_ipfs',      // Currently uploading to IPFS
          'encoding_preparing', // Encoder preparing job
          'encoding_progress'   // Actively encoding
        ]
      },
      created: { $gte: sixHoursAgo } // Only videos from last 6 hours
    })
    .select('_id owner permlink title status job_id created encodingProgress thumbnail filename')
    .sort({ created: -1 }) // Newest first
    .limit(10); // Reasonable limit
    
    if (inProgressVideos.length === 0) {
      console.log(`✅ No videos in progress for ${owner}`);
      return res.json({
        success: true,
        data: {
          videos: [],
          count: 0,
          summary: {
            queued: 0,
            encoding: 0,
            finishing: 0
          }
        }
      });
    }
    
    console.log(`📹 Found ${inProgressVideos.length} video(s) in progress for ${owner}`);
    
    // Fetch all jobs in parallel for efficiency
    const jobPromises = inProgressVideos.map(async (video) => {
      if (!video.job_id) return null;
      try {
        const job = await jobService.findJobByVideo(video.owner, video.permlink);
        return job ? job.toPublicJSON() : null;
      } catch (err) {
        console.warn(`Failed to fetch job for ${video.permlink}:`, err.message);
        return null;
      }
    });
    
    const jobs = await Promise.all(jobPromises);
    
    // Helper to calculate display status following 3-phase flow
    const getDisplayStatus = (video, job) => {
      // PHASE 3: Check for completion
      if (video.status === 'published' || video.status === 'publish_manual') {
        return {
          phase: 3,
          label: '🎉 Published!',
          shortLabel: 'Published',
          progress: 100,
          isComplete: true,
          isFailed: false
        };
      }
      
      // Check for failures
      if (video.status === 'failed' || video.status === 'encoding_failed' || job?.status === 'failed') {
        return {
          phase: 0,
          label: '❌ Failed',
          shortLabel: 'Failed',
          progress: 0,
          isComplete: false,
          isFailed: true
        };
      }
      
      // PHASE 1: Waiting for job
      if (video.status === 'uploaded' || !job) {
        return {
          phase: 1,
          label: '⏳ Waiting for encoder...',
          shortLabel: 'Queued',
          progress: 5,
          isComplete: false,
          isFailed: false
        };
      }
      
      // PHASE 2: Job exists - track job status
      switch (job.status) {
        case 'queued':
          return {
            phase: 2,
            label: '⏳ Queued for encoding...',
            shortLabel: 'Queued',
            progress: 10,
            isComplete: false,
            isFailed: false
          };
          
        case 'running':
          const downloadPct = job.progress?.download_pct || 0;
          const encodePct = job.progress?.pct || 0;
          
          if (downloadPct < 100) {
            return {
              phase: 2,
              label: `📥 Downloading: ${Math.round(downloadPct)}%`,
              shortLabel: 'Downloading',
              progress: 10 + (downloadPct * 0.2), // 10-30%
              downloadProgress: downloadPct,
              encodeProgress: 0,
              isComplete: false,
              isFailed: false
            };
          } else {
            return {
              phase: 2,
              label: `🎬 Encoding: ${Math.round(encodePct)}%`,
              shortLabel: 'Encoding',
              progress: 30 + (encodePct * 0.6), // 30-90%
              downloadProgress: 100,
              encodeProgress: encodePct,
              isComplete: false,
              isFailed: false
            };
          }
          
        case 'complete':
        case 'completed':
          return {
            phase: 2.5,
            label: '✅ Publishing to Hive...',
            shortLabel: 'Publishing',
            progress: 95,
            downloadProgress: 100,
            encodeProgress: 100,
            isComplete: false, // Not complete until video.status === 'published'
            isFailed: false
          };
          
        default:
          return {
            phase: 2,
            label: `Processing (${job.status})...`,
            shortLabel: job.status,
            progress: 50,
            isComplete: false,
            isFailed: false
          };
      }
    };
    
    // Build rich response with all data frontend needs
    const videosWithFullData = inProgressVideos.map((video, index) => {
      const job = jobs[index];
      const displayStatus = getDisplayStatus(video, job);
      
      // Calculate time elapsed
      const createdAt = new Date(video.created);
      const elapsedMs = Date.now() - createdAt.getTime();
      const elapsedMinutes = Math.floor(elapsedMs / 60000);
      
      return {
        // Video info
        video_id: video._id.toString(),
        owner: video.owner,
        permlink: video.permlink,
        title: video.title,
        thumbnail: video.thumbnail || null,
        created: video.created,
        elapsed_minutes: elapsedMinutes,
        
        // Raw status (for advanced use)
        video_status: video.status,
        job_id: video.job_id || null,
        job_status: job?.status || null,
        
        // Job progress details
        job_progress: job?.progress || null,
        
        // Display-ready data (USE THIS!)
        display: displayStatus,
        
        // Convenience fields
        progress_percent: displayStatus.progress,
        status_label: displayStatus.label,
        status_short: displayStatus.shortLabel,
        is_complete: displayStatus.isComplete,
        is_failed: displayStatus.isFailed
      };
    });
    
    // Calculate summary stats
    const summary = {
      queued: videosWithFullData.filter(v => v.display.phase === 1 || (v.display.phase === 2 && v.job_status === 'queued')).length,
      encoding: videosWithFullData.filter(v => v.job_status === 'running').length,
      finishing: videosWithFullData.filter(v => v.display.phase === 2.5).length,
      failed: videosWithFullData.filter(v => v.is_failed).length
    };
    
    // Calculate overall progress (average of all videos)
    const overallProgress = videosWithFullData.length > 0
      ? Math.round(videosWithFullData.reduce((sum, v) => sum + v.progress_percent, 0) / videosWithFullData.length)
      : 0;
    
    res.json({
      success: true,
      data: {
        videos: videosWithFullData,
        count: videosWithFullData.length,
        summary,
        overall_progress: overallProgress,
        
        // Helpful message for UI
        message: videosWithFullData.length === 1
          ? `1 video being processed`
          : `${videosWithFullData.length} videos being processed`,
          
        // Polling hint
        poll_interval_ms: 5000
      }
    });
    
  } catch (error) {
    console.error('❌ In-progress check error:', error);
    res.status(500).json({
      success: false,
      error: process.env.NODE_ENV === 'production' 
        ? 'Failed to check in-progress videos'
        : error.message
    });
  }
});

module.exports = router;