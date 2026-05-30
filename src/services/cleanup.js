const cron = require('node-cron');
const ipfsService = require('./ipfs');

class CleanupService {
  constructor() {
    this.serviceId = process.env.UPLOAD_SERVICE_ID || 'simplified-upload-service';
    this.retentionDays = parseFloat(process.env.CLEANUP_RETENTION_DAYS) || 0.25; // 6 hours for raw files
    this.isSchedulerRunning = false;
    this.scheduledTask = null;
    this.statusHealerTask = null;
    this.isStatusHealerRunning = false;
    
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
    console.log('✅ Cleanup scheduler stopped');
  }
   
  /**
   * Start scheduled status healer for scheduled videos
   */
  startStatusHealer() {
    if (this.isStatusHealerRunning) {
      console.log('⚠️ Status healer is already running');
      return;
    }

    const schedule = process.env.SCHEDULED_VIDEO_CHECK_CRON || '0 * * * *'; // Every hour by default
    
    console.log(`📅 Scheduling status healer: ${schedule}`);
    
    this.statusHealerTask = cron.schedule(schedule, async () => {
      console.log('🔧 Running scheduled video status check...');
      try {
        await this.correctScheduledVideoStatus();
      } catch (error) {
        console.error('❌ Status healer failed:', error);
      }
    }, {
      scheduled: true,
      timezone: 'UTC'
    });

    this.isStatusHealerRunning = true;
    console.log('✅ Status healer started');
  }

  /**
   * Stop scheduled status healer
   */
  stopStatusHealer() {
    if (this.statusHealerTask) {
      this.statusHealerTask.stop();
      this.statusHealerTask = null;
    }
    this.isStatusHealerRunning = false;
    console.log('✅ Status healer stopped');
  }

  /**
   * Correct status for scheduled videos that were incorrectly marked as "published"
   * This happens when encoders force jobs or bypass the normal gateway flow
   */
  async correctScheduledVideoStatus() {
    try {
      const now = new Date();
      
      // Find videos that should be "scheduled" but are marked as "published"
      const incorrectVideos = await this.Video.find({
        publish_type: 'schedule',
        status: 'published',
        publish_data: { $gt: now } // Scheduled for future
      });

      if (incorrectVideos.length === 0) {
        return;
      }

      console.log(`🔧 Found ${incorrectVideos.length} scheduled video(s) with incorrect status`);

      let corrected = 0;
      for (const video of incorrectVideos) {
        video.status = 'scheduled';
        await video.save();
        console.log(`✅ Corrected ${video.owner}/${video.permlink} → scheduled (publishes ${video.publish_data.toISOString()})`);
        corrected++;
      }

      console.log(`✅ Status correction complete: ${corrected} video(s) fixed`);
    } catch (error) {
      console.error('❌ Failed to correct scheduled video status:', error);
    }
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

      // Run GC after unpinning to actually reclaim disk space
      if (cleaned > 0) {
        ipfsService.runGarbageCollection().catch(err => {
          console.warn(`⚠️ Post-cleanup GC failed: ${err.message}`);
        });
      }

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
    }).select('_id owner permlink filename fallback_mode created status size').limit(200);
  }

  /**
   * Clean up individual video
   * @param {Object} video - Video document
   * @returns {Promise<{success: boolean, ipfsHash?: string, error?: string}>}
   */
  async cleanupVideo(video) {
    try {
      console.log(`🗑️ Cleaning up video: ${video.owner}/${video.permlink}`);

      // Videos without an IPFS filename have nothing to unpin — mark done and move on
      if (!video.filename || !video.filename.startsWith('ipfs://')) {
        video.cleanup_eligible = true;
        await video.save();
        console.log(`⏭️ Skipped (no IPFS hash): ${video.owner}/${video.permlink}`);
        return { success: true, ipfsHash: null, skipped: true };
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

      let cleaned = 0;
      let errors = 0;
      const fs = require('fs');

      for (const upload of orphaned) {
        try {
          if (upload.tus_file_path && fs.existsSync(upload.tus_file_path)) {
            fs.unlinkSync(upload.tus_file_path);
            // Also remove the companion .info file
            const infoPath = upload.tus_file_path + '.info';
            if (fs.existsSync(infoPath)) fs.unlinkSync(infoPath);
            console.log(`🗑️ Deleted orphaned file: ${upload.tus_file_path}`);
          }

          await TempUpload.deleteOne({ _id: upload._id });
          cleaned++;

          console.log(`✅ Cleaned orphaned upload: ${upload.upload_id} (${upload.owner})`);
        } catch (error) {
          console.error(`❌ Failed to clean upload ${upload.upload_id}:`, error.message);
          errors++;
        }
      }

      // Sweep the TUS upload directory for stale files with no active session.
      // This catches files from: failed traditional-TUS uploads, partial uploads
      // whose TempUpload record was already deleted, and pre-existing legacy files.
      const tusDir = process.env.TUS_UPLOAD_DIR || '/var/uploads/3speak';
      const staleTusResult = await this._cleanStaleTusFiles(tusDir, fs);
      cleaned += staleTusResult.cleaned;
      errors  += staleTusResult.errors;

      console.log(`✅ Orphaned upload cleanup: ${cleaned} cleaned, ${errors} errors`);

      return { cleaned, errors, total: orphaned.length + staleTusResult.total };
    } catch (error) {
      console.error('❌ Orphaned upload cleanup error:', error);
      throw error;
    }
  }

  /**
   * Delete TUS files (upload + .info) from tusDir that have not been touched
   * in the last 24 hours and are not referenced by any non-finalized TempUpload.
   * @private
   */
  async _cleanStaleTusFiles(tusDir, fs) {
    const result = { cleaned: 0, errors: 0, total: 0 };
    try {
      if (!fs.existsSync(tusDir)) return result;

      const TempUpload = require('../models/TempUpload')();
      // TempUpload records expire after 4 hours, so anything older than 6 hours
      // in the upload directory is guaranteed to have no active session.
      const cutoff = Date.now() - 6 * 60 * 60 * 1000; // 6 hours ago

      // Build set of TUS IDs still referenced by active (non-finalized) TempUploads
      const active = await TempUpload.find({ finalized: false }).select('tus_file_path');
      const activePaths = new Set(active.map(u => u.tus_file_path).filter(Boolean));

      const entries = fs.readdirSync(tusDir);
      // Only look at data files (no .info extension)
      const dataFiles = entries.filter(e => !e.endsWith('.info'));

      for (const name of dataFiles) {
        const filePath = require('path').join(tusDir, name);
        try {
          const stat = fs.statSync(filePath);
          if (stat.mtimeMs > cutoff) continue; // recently modified — skip
          if (activePaths.has(filePath)) continue; // still needed — skip

          result.total++;
          fs.unlinkSync(filePath);
          const infoPath = filePath + '.info';
          if (fs.existsSync(infoPath)) fs.unlinkSync(infoPath);
          result.cleaned++;
          console.log(`🗑️ Swept stale TUS file: ${name}`);
        } catch (err) {
          console.error(`❌ Failed to sweep TUS file ${name}: ${err.message}`);
          result.errors++;
        }
      }

      if (result.total > 0) {
        console.log(`🧹 Stale TUS sweep: ${result.cleaned}/${result.total} files removed`);
      }
    } catch (err) {
      console.error('❌ Stale TUS sweep error:', err.message);
    }
    return result;
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

  /**
   * Get status healer health
   */
  getStatusHealerHealth() {
    return {
      running: this.isStatusHealerRunning,
      schedule: process.env.SCHEDULED_VIDEO_CHECK_CRON || '0 * * * *'
    };
  }
}

module.exports = new CleanupService();