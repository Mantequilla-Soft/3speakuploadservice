const mongoose = require('mongoose');
const { threeSpeakDb } = require('../config/database');

// ============================================
// 3SPEAK VIDEO SCHEMA
// ============================================
// This schema matches the exact structure expected by 3Speak's existing system
const videoSchema = new mongoose.Schema({
  // ============================================
  // CORE IDENTITY
  // ============================================
  owner: { 
    type: String, 
    required: true,
    index: true,
    match: /^[a-z0-9.-]+$/
  },
  permlink: { 
    type: String, 
    required: true, 
    unique: true,
    index: true,
    minlength: 8,
    maxlength: 8
  },
  
  // ============================================
  // UPLOAD SERVICE TRACKING
  // ============================================
  upload_service_id: { 
    type: String, 
    default: () => process.env.UPLOAD_SERVICE_ID || 'simplified-upload-service',
    index: true
  },
  fallback_mode: { 
    type: Boolean, 
    default: false,
    index: true // For cleanup queries
  },
  cleanup_eligible: { 
    type: Boolean, 
    default: false,
    index: true // For cleanup queries
  },
  
  // ============================================
  // VIDEO METADATA
  // ============================================
  title: { 
    type: String, 
    required: true,
    maxlength: 250
  },
  description: { 
    type: String, 
    required: true,
    maxlength: 50000
  },
  tags: { 
    type: String,
    default: ''
  }, // Comma-separated for legacy compatibility
  tags_v2: [{ 
    type: String,
    maxlength: 50
  }], // Array format
  thumbnail: String, // "ipfs://hash" format
  
  // ============================================
  // FILE INFORMATION
  // ============================================
  originalFilename: String,
  filename: String, // "ipfs://hash" (raw video)
  video_v2: String, // "ipfs://hash/manifest.m3u8" (encoded)
  local_filename: String, // Temp file path (should be null after upload)
  size: { 
    type: Number,
    min: 1000, // Minimum 1KB
    max: 8000000000 // Maximum 8GB
  },
  duration: { 
    type: Number,
    min: 0.1,
    max: 21600 // Maximum 6 hours
  },
  
  // ============================================
  // UPLOAD & ENCODING STATUS
  // ============================================
  upload_type: { 
    type: String, 
    default: 'ipfs',
    enum: ['ipfs']
  },
  status: { 
    type: String, 
    default: 'uploaded',
    enum: [
      'uploaded', 
      'encoding_ipfs', 
      'encoding_preparing',
      'encoding_progress',
      'encoding_completed',
      'published',
      'failed'
    ],
    index: true
  },
  job_id: { 
    type: String,
    index: true // For linking with encoder jobs
  },
  encoding_price_steem: { 
    type: String, 
    default: '0.000' 
  },
  encodingProgress: { 
    type: Number, 
    default: 0,
    min: 0,
    max: 100
  },
  
  // ============================================
  // PUBLISHING CONFIGURATION
  // ============================================
  publish_type: { 
    type: String, 
    default: 'publish',
    enum: ['publish', 'schedule']
  },
  community: String,
  hive: String, // Community ID like "hive-181335"
  language: { 
    type: String, 
    default: 'en' 
  },
  category: { 
    type: String, 
    default: 'general' 
  },
  
  // ============================================
  // BENEFICIARIES & REWARDS
  // ============================================
  beneficiaries: String, // JSON array string for legacy compatibility
  declineRewards: { 
    type: Boolean, 
    default: false 
  },
  rewardPowerup: { 
    type: Boolean, 
    default: false 
  },
  votePercent: { 
    type: Number, 
    default: 1,
    min: 0,
    max: 1
  },
  donations: { 
    type: Boolean, 
    default: false  // Web upload default (legacy compatible)
  },
  
  // ============================================
  // CONTENT FLAGS & SETTINGS
  // ============================================
  isNsfwContent: { 
    type: Boolean, 
    default: false 
  },
  is3CJContent: { 
    type: Boolean, 
    default: false 
  },
  fromMobile: { 
    type: Boolean, 
    default: false 
  }, // Always false for this service
  firstUpload: { 
    type: Boolean, 
    default: false 
  },
  
  // ============================================
  // TIMESTAMPS
  // ============================================
  created: { 
    type: Date, 
    default: Date.now,
    index: true
  },
  
  // ============================================
  // STATUS TRACKING
  // ============================================
  needsHiveUpdate: { 
    type: Boolean, 
    default: false 
  },
  steemPosted: { 
    type: Boolean, 
    default: false 
  },
  indexed: { 
    type: Boolean, 
    default: false 
  },
  upvoteEligible: { 
    type: Boolean, 
    default: true 
  },
  
  // ============================================
  // LEGACY COMPATIBILITY FIELDS
  // ============================================
  encoding: {
    type: Object,
    default: {
      "360": false,
      "480": false,
      "720": false,
      "1080": false
    }
  },
  updateSteem: { 
    type: Boolean, 
    default: false 
  },
  lowRc: { 
    type: Boolean, 
    default: false 
  },
  needsBlockchainUpdate: { 
    type: Boolean, 
    default: false 
  },
  paid: { 
    type: Boolean, 
    default: false 
  },
  isVOD: { 
    type: Boolean, 
    default: false 
  },
  postToHiveBlog: { 
    type: Boolean, 
    default: false 
  },
  reducedUpvote: { 
    type: Boolean, 
    default: false 
  },
  
  // ============================================
  // ADDITIONAL LEGACY COMPATIBILITY FIELDS
  // ============================================
  app: { 
    type: String, 
    default: null  // Must be null for auto-publish (web uploads)
  },
  badges: { 
    type: [String], 
    default: [] 
  },
  curationComplete: { 
    type: Boolean, 
    default: false 
  },
  hasAudioOnlyVersion: { 
    type: Boolean, 
    default: false 
  },
  hasTorrent: { 
    type: Boolean, 
    default: false 
  },
  isB2: { 
    type: Boolean, 
    default: false 
  },
  pinned: { 
    type: Boolean, 
    default: false 
  },
  publishFailed: { 
    type: Boolean, 
    default: false 
  },
  recommended: { 
    type: Boolean, 
    default: false 
  },
  score: { 
    type: Number, 
    default: 0 
  },
  width: { 
    type: Number, 
    default: null 
  },
  height: { 
    type: Number, 
    default: null 
  },
  jsonMetaDataAppName: { 
    type: String, 
    default: null 
  },
  __v: { 
    type: Number, 
    default: 0 
  }
}, {
  collection: 'videos', // Explicit collection name for 3Speak compatibility
  timestamps: false // Using manual 'created' field
});

// ============================================
// INDEXES FOR PERFORMANCE
// ============================================
videoSchema.index({ owner: 1, created: -1 });
videoSchema.index({ status: 1, created: -1 });
videoSchema.index({ upload_service_id: 1, fallback_mode: 1, cleanup_eligible: 1 });
videoSchema.index({ job_id: 1 });

// ============================================
// VIRTUAL FIELDS
// ============================================
videoSchema.virtual('ipfsHash').get(function() {
  if (this.filename && this.filename.startsWith('ipfs://')) {
    return this.filename.replace('ipfs://', '');
  }
  return null;
});

videoSchema.virtual('thumbnailHash').get(function() {
  if (this.thumbnail && this.thumbnail.startsWith('ipfs://')) {
    return this.thumbnail.replace('ipfs://', '');
  }
  return null;
});

// ============================================
// INSTANCE METHODS
// ============================================
videoSchema.methods.updateStatus = function(newStatus, progress = null) {
  this.status = newStatus;
  if (progress !== null) {
    this.encodingProgress = progress;
  }
  return this.save();
};

videoSchema.methods.markForCleanup = function() {
  this.cleanup_eligible = true;
  return this.save();
};

videoSchema.methods.toPublicJSON = function() {
  return {
    id: this._id,
    owner: this.owner,
    permlink: this.permlink,
    title: this.title,
    description: this.description,
    tags: this.tags_v2 || [],
    thumbnail: this.thumbnail,
    status: this.status,
    encodingProgress: this.encodingProgress,
    duration: this.duration,
    size: this.size,
    created: this.created,
    community: this.community
  };
};

// ============================================
// STATIC METHODS
// ============================================
videoSchema.statics.findByOwner = function(owner, options = {}) {
  const query = { owner };
  
  if (options.status) {
    query.status = options.status;
  }
  
  return this.find(query)
    .sort({ created: -1 })
    .limit(options.limit || 20)
    .skip(options.offset || 0);
};

videoSchema.statics.findEligibleForCleanup = function(retentionDays = 7) {
  const cutoffDate = new Date();
  cutoffDate.setDate(cutoffDate.getDate() - retentionDays);
  
  return this.find({
    upload_service_id: process.env.UPLOAD_SERVICE_ID || 'simplified-upload-service',
    fallback_mode: true,
    status: 'published',
    created: { $lt: cutoffDate },
    cleanup_eligible: { $ne: true }
  });
};

// ============================================
// PRE-SAVE MIDDLEWARE
// ============================================
videoSchema.pre('save', function(next) {
  // Ensure tags_v2 is populated from tags if provided
  if (this.tags && (!this.tags_v2 || this.tags_v2.length === 0)) {
    this.tags_v2 = this.tags.split(',').map(tag => tag.trim()).filter(tag => tag.length > 0);
  }
  
  // Ensure tags string is populated from tags_v2
  if (this.tags_v2 && this.tags_v2.length > 0 && !this.tags) {
    this.tags = this.tags_v2.join(',');
  }
  
  next();
});

// ============================================
// MODEL CREATION WITH DYNAMIC CONNECTION
// ============================================
const createModel = () => {
  const { threeSpeakDb } = require('../config/database');
  if (!threeSpeakDb) {
    throw new Error('ThreeSpeak database connection not established');
  }
  return threeSpeakDb.model('Video', videoSchema);
};

module.exports = createModel;