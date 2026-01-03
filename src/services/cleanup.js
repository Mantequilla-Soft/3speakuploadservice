const cron = require('node-cron');
const ipfsService = require('./ipfs');

class CleanupService {
  constructor() {
    this.serviceId = process.env.UPLOAD_SERVICE_ID || 'simplified-upload-service';
    this.retentionDays = parseFloat(process.env.CLEANUP_RETENTION_DAYS) || 0.25; // 6 hours for raw files
    this.isSchedulerRunning = false;
    this.scheduledTask = null;
    
    // Lazy load models to avoid circular dependencies
    this._Video = null;
  }

  get Video() {
    if (!this._Video) {
      this._Video = require('../models/Video')();
    }
    return this._Video;
  }

  /**
   * Start scheduled cleanup process
   */
  startScheduledCleanup() {
    if (this.isSchedulerRunning) {
      console.log('⚠️ Cleanup scheduler is already running');
      return;
    }

    const schedule = process.env.CLEANUP_SCHEDULE_CRON || '0 */6 * * *'; // Every 6 hours
    
    console.log(`📅 Scheduling cleanup: ${schedule} (retention: ${this.retentionDays} days)`);
    
    this.scheduledTask = cron.schedule(schedule, async () => {
      console.log('🧹 Starting scheduled cleanup...');
      try {
        await this.performCleanup();
        await this.cleanupOrphanedUploads();
      } catch (error) {
        console.error('❌ Scheduled cleanup failed:', error);
      }
    }, {
      scheduled: true,
      timezone: 'UTC'
    });

    this.isSchedulerRunning = true;
    console.log('✅ Cleanup scheduler started');
  }

  /**
   * Stop scheduled cleanup process
   */
  stopScheduledCleanup() {
    if (this.scheduledTask) {
      this.scheduledTask.stop();
      this.scheduledTask = null;
    }
    this.isSchedulerRunning = false;
    console.log('🛑 Cleanup scheduler stopped');
  }

  /**
   * Perform cleanup of eligible videos
   * @returns {Promise<{cleaned: number, errors: number, total: number, details: Array}>}
   */
  async performCleanup() {
    try {
      console.log(`🔍 Looking for videos older than ${this.retentionDays} days...`);
      
      // Find videos created by this service that are ready for cleanup
      const eligibleVideos = await this.findEligibleVideos();
      
      console.log(`📊 Found ${eligibleVideos.length} videos eligible for cleanup`);
      
      if (eligibleVideos.length === 0) {
        return { cleaned: 0, errors: 0, total: 0, details: [] };
      }

      let cleaned = 0;
      let errors = 0;
      const details = [];

      for (const video of eligibleVideos) {
        try {
          const result = await this.cleanupVideo(video);
          if (result.success) {
            cleaned++;
            details.push({
              video: `${video.owner}/${video.permlink}`,
              action: 'cleaned',
              ipfsHash: result.ipfsHash,
              size: video.size
            });
          } else {
            errors++;
            details.push({
              video: `${video.owner}/${video.permlink}`,
              action: 'error',
              error: result.error
            });
          }
        } catch (error) {
          console.error(`❌ Failed to cleanup video ${video._id}:`, error.message);
          errors++;
          details.push({
            video: `${video.owner}/${video.permlink}`,
            action: 'error',
            error: error.message
          });
        }
      }

      const summary = {
        cleaned,
        errors,
        total: eligibleVideos.length,
        details,
        timestamp: new Date().toISOString(),
        retentionDays: this.retentionDays
      };

      console.log(`✅ Cleanup complete: ${cleaned} cleaned, ${errors} errors`);
      
      return summary;
    } catch (error) {
      console.error('❌ Cleanup service error:', error);
      throw error;
    }
  }

  /**
   * Find videos eligible for cleanup
   * @returns {Promise<Array>} Eligible video documents
   */
  async findEligibleVideos() {
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - this.retentionDays);

    return this.Video.find({
      upload_service_id: this.serviceId,
      fallback_mode: false,          // Cleanup LOCAL pins (new strategy)
      status: { $in: ['encoding_ipfs', 'encoding_ready', 'published'] }, // Encoding started or complete
      created: { $lt: cutoffDate },  // Older than retention period (24h for raw files)
      cleanup_eligible: { $ne: true } // Not already cleaned
    }).select('_id owner permlink filename fallback_mode created status size');
  }

  /**
   * Clean up individual video
   * @param {Object} video - Video document
   * @returns {Promise<{success: boolean, ipfsHash?: string, error?: string}>}
   */
  async cleanupVideo(video) {
    try {
      console.log(`🗑️ Cleaning up video: ${video.owner}/${video.permlink}`);
      
      // Extract IPFS hash from filename (format: "ipfs://hash")
      if (!video.filename || !video.filename.startsWith('ipfs://')) {
        throw new Error('Invalid filename format for cleanup');
      }
      
      const ipfsHash = video.filename.replace('ipfs://', '');
      
      // Unpin from local IPFS
      const unpinSuccess = await ipfsService.unpinFromFallback(ipfsHash);
      
      if (unpinSuccess) {
        // Mark as cleaned up in database
        video.cleanup_eligible = true;
        await video.save();
        
        console.log(`✅ Cleaned up: ${video.owner}/${video.permlink} (${ipfsHash})`);
        
        return {
          success: true,
          ipfsHash: ipfsHash
        };
      } else {
        return {
          success: false,
          error: `Failed to unpin ${ipfsHash} from local IPFS`
        };
      }
    } catch (error) {
      console.error(`❌ Cleanup failed for ${video.owner}/${video.permlink}:`, error);
      return {
        success: false,
        error: error.message
      };
    }
  }

  /**
   * Clean up orphaned temporary uploads (upload-first flow)
   * Removes uploads that expired without being finalized
   * @returns {Promise<{cleaned: number, errors: number, total: number}>}
   */
  async cleanupOrphanedUploads() {
    try {
      const TempUpload = require('../models/TempUpload')();
      const orphaned = await TempUpload.findOrphaned();
      
      console.log(`🔍 Found ${orphaned.length} orphaned uploads to clean`);
      
      if (orphaned.length === 0) {
        return { cleaned: 0, errors: 0, total: 0 };
      }

      let cleaned = 0;
      let errors = 0;
      const fs = require('fs');

      for (const upload of orphaned) {
        try {
          // Delete temp file if exists
          if (upload.tus_file_path && fs.existsSync(upload.tus_file_path)) {
            fs.unlinkSync(upload.tus_file_path);
            console.log(`🗑️ Deleted orphaned file: ${upload.tus_file_path}`);
          }
          
          // Delete database entry
          await TempUpload.deleteOne({ _id: upload._id });
          cleaned++;
          
          console.log(`✅ Cleaned orphaned upload: ${upload.upload_id} (${upload.owner})`);
        } catch (error) {
          console.error(`❌ Failed to clean upload ${upload.upload_id}:`, error.message);
          errors++;
        }
      }

      console.log(`✅ Orphaned upload cleanup: ${cleaned} cleaned, ${errors} errors`);
      
      return { cleaned, errors, total: orphaned.length };
    } catch (error) {
      console.error('❌ Orphaned upload cleanup error:', error);
      throw error;
    }
  }

  /**
   * Get cleanup statistics
   * @returns {Promise<Object>} Cleanup stats
   */
  async getCleanupStats() {
    try {
      const stats = await this.Video.aggregate([
        { $match: { upload_service_id: this.serviceId } },
        {
          $group: {
            _id: null,
            total: { $sum: 1 },
            fallback_uploads: { $sum: { $cond: ['$fallback_mode', 1, 0] } },
            published: { $sum: { $cond: [{ $eq: ['$status', 'published'] }, 1, 0] } },
            cleaned: { $sum: { $cond: ['$cleanup_eligible', 1, 0] } },
            total_size: { $sum: '$size' },
            fallback_size: { 
              $sum: { 
                $cond: ['$fallback_mode', '$size', 0] 
              } 
            }
          }
        }
      ]);

      const result = stats[0] || { 
        total: 0, 
        fallback_uploads: 0, 
        published: 0, 
        cleaned: 0,
        total_size: 0,
        fallback_size: 0
      };

      // Calculate additional metrics
      const eligibleVideos = await this.findEligibleVideos();
      result.eligible_for_cleanup = eligibleVideos.length;
      
      // Calculate storage savings
      const cleanedSize = await this.Video.aggregate([
        { 
          $match: { 
            upload_service_id: this.serviceId,
            cleanup_eligible: true,
            fallback_mode: true
          } 
        },
        { $group: { _id: null, total: { $sum: '$size' } } }
      ]);
      
      result.storage_cleaned_bytes = cleanedSize[0]?.total || 0;
      result.storage_cleaned_gb = Math.round((result.storage_cleaned_bytes / (1024 * 1024 * 1024)) * 100) / 100;
      
      // Add scheduler status
      result.scheduler_running = this.isSchedulerRunning;
      result.retention_days = this.retentionDays;
      result.service_id = this.serviceId;

      return result;
    } catch (error) {
      console.error('Failed to get cleanup stats:', error);
      return { 
        total: 0, 
        fallback_uploads: 0, 
        published: 0, 
        cleaned: 0, 
        error: error.message 
      };
    }
  }

  /**
   * Force cleanup of specific video
   * @param {string} videoId - MongoDB video ID
   * @returns {Promise<Object>} Cleanup result
   */
  async forceCleanupVideo(videoId) {
    try {
      const video = await this.Video.findById(videoId);
      if (!video) {
        throw new Error('Video not found');
      }
      
      if (video.upload_service_id !== this.serviceId) {
        throw new Error('Video not created by this service');
      }
      
      if (!video.fallback_mode) {
        throw new Error('Video not using fallback storage');
      }
      
      return await this.cleanupVideo(video);
    } catch (error) {
      console.error(`Failed to force cleanup video ${videoId}:`, error);
      throw error;
    }
  }

  /**
   * Health check for cleanup service
   * @returns {Promise<{healthy: boolean, scheduler_running: boolean, stats?: Object, error?: string}>}
   */
  async healthCheck() {
    try {
      const stats = await this.getCleanupStats();
      
      return {
        healthy: true,
        scheduler_running: this.isSchedulerRunning,
        stats: stats,
        timestamp: new Date().toISOString()
      };
    } catch (error) {
      return {
        healthy: false,
        scheduler_running: this.isSchedulerRunning,
        error: error.message,
        timestamp: new Date().toISOString()
      };
    }
  }

  /**
   * Get recent cleanup history (for monitoring)
   * @param {number} days - Number of days to look back
   * @returns {Promise<Array>} Recent cleanup activities
   */
  async getRecentCleanupHistory(days = 7) {
    try {
      const cutoffDate = new Date();
      cutoffDate.setDate(cutoffDate.getDate() - days);
      
      const recentlyCleanedVideos = await this.Video.find({
        upload_service_id: this.serviceId,
        cleanup_eligible: true,
        // Note: We don't have cleanup timestamp, so this is based on video creation
        created: { $gte: cutoffDate }
      }).select('owner permlink created size status cleanup_eligible')
        .sort({ created: -1 })
        .limit(100);
      
      return recentlyCleanedVideos.map(video => ({
        video: `${video.owner}/${video.permlink}`,
        created: video.created,
        size: video.size,
        status: video.status
      }));
    } catch (error) {
      console.error('Failed to get cleanup history:', error);
      return [];
    }
  }
}

module.exports = new CleanupService();