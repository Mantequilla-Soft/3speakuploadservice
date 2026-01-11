const mongoose = require('mongoose');
const { threeSpeakDb } = require('../config/database');

// ============================================
// TEMPORARY UPLOAD TRACKING SCHEMA
// ============================================
// Tracks uploads initiated before video metadata is provided
// Used for "upload-first" flow where TUS upload starts immediately
// Expires after 1 hour if not finalized
const tempUploadSchema = new mongoose.Schema({
  // ============================================
  // UPLOAD IDENTIFICATION
  // ============================================
  upload_id: {
    type: String,
    required: true,
    unique: true,
    index: true
  },
  
  // ============================================
  // USER & FILE INFO
  // ============================================
  owner: {
    type: String,
    required: true,
    index: true,
    match: /^[a-z0-9.-]+$/
  },
  originalFilename: {
    type: String,
    required: true
  },
  size: {
    type: Number,
    required: true,
    min: 1000
  },
  duration: {
    type: Number,
    required: true,
    min: 0.1
  },
  
  // ============================================
  // TUS UPLOAD STATUS
  // ============================================
  tus_completed: {
    type: Boolean,
    default: false,
    index: true
  },
  tus_file_path: {
    type: String,
    default: null
  },
  
  // ============================================
  // FINALIZATION STATUS
  // ============================================
  video_id: {
    type: String,
    default: null,
    index: true
  },
  finalized: {
    type: Boolean,
    default: false,
    index: true
  },
  
  // ============================================
  // TIMESTAMPS & EXPIRATION
  // ============================================
  created: {
    type: Date,
    default: Date.now,
    index: true
  },
  expires: {
    type: Date,
    default: () => new Date(Date.now() + 4 * 60 * 60 * 1000), // 4 hours from now
    index: true
  }
}, {
  collection: 'temp_uploads',
  timestamps: false
});

// ============================================
// INDEXES
// ============================================
tempUploadSchema.index({ upload_id: 1 });
tempUploadSchema.index({ owner: 1, created: -1 });
tempUploadSchema.index({ expires: 1 }); // For TTL cleanup
tempUploadSchema.index({ tus_completed: 1, finalized: 1 });

// ============================================
// STATIC METHODS
// ============================================

/**
 * Create new temporary upload
 */
tempUploadSchema.statics.createUpload = async function(uploadData) {
  const upload = new this({
    upload_id: uploadData.upload_id,
    owner: uploadData.owner,
    originalFilename: uploadData.originalFilename,
    size: uploadData.size,
    duration: uploadData.duration
  });
  
  await upload.save();
  console.log(`✅ Temporary upload created: ${upload.upload_id} for ${upload.owner}`);
  return upload;
};

/**
 * Mark TUS upload as completed
 */
tempUploadSchema.statics.markTusCompleted = async function(upload_id, filePath) {
  const upload = await this.findOneAndUpdate(
    { upload_id },
    { 
      tus_completed: true,
      tus_file_path: filePath
    },
    { new: true }
  );
  
  if (!upload) {
    throw new Error(`Temporary upload not found: ${upload_id}`);
  }
  
  console.log(`✅ TUS upload completed: ${upload_id}`);
  return upload;
};

/**
 * Mark as finalized with video_id
 */
tempUploadSchema.statics.markFinalized = async function(upload_id, video_id) {
  const upload = await this.findOneAndUpdate(
    { upload_id },
    { 
      finalized: true,
      video_id: video_id
    },
    { new: true }
  );
  
  if (!upload) {
    throw new Error(`Temporary upload not found: ${upload_id}`);
  }
  
  console.log(`✅ Upload finalized: ${upload_id} → video ${video_id}`);
  return upload;
};

/**
 * Find expired orphaned uploads (not finalized, past expiration)
 */
tempUploadSchema.statics.findOrphaned = async function() {
  return this.find({
    expires: { $lt: new Date() },
    finalized: false
  });
};

/**
 * Check if upload is ready to finalize
 */
tempUploadSchema.methods.isReadyToFinalize = function() {
  return this.tus_completed && this.tus_file_path && !this.finalized;
};

/**
 * Check if upload is expired
 */
tempUploadSchema.methods.isExpired = function() {
  return this.expires < new Date();
};

// ============================================
// MODEL CREATION
// ============================================
const createModel = () => {
  const { threeSpeakDb } = require('../config/database');
  if (!threeSpeakDb) {
    throw new Error('ThreeSpeak database connection not established');
  }
  return threeSpeakDb.model('TempUpload', tempUploadSchema);
};

module.exports = createModel;
