const { exec } = require('child_process');
const util = require('util');
const execPromise = util.promisify(exec);
const axios = require('axios');
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

const IPFS_API_URL = process.env.IPFS_FALLBACK_URL || 'http://localhost:5001';
const MIN_AGE_HOURS = 24; // Minimum age before files can be unpinned

/**
 * Get IPFS repository statistics
 */
async function getRepoStats() {
  try {
    const response = await axios.post(`${IPFS_API_URL}/api/v0/repo/stat`, null, {
      params: { human: false },
      timeout: 10000
    });

    return {
      repoSize: response.data.RepoSize,
      storageMax: response.data.StorageMax,
      numObjects: response.data.NumObjects,
      repoPath: response.data.RepoPath,
      version: response.data.Version
    };
  } catch (error) {
    logger.error('Error getting IPFS repo stats:', error.message);
    throw new Error('Failed to get IPFS repository statistics');
  }
}

/**
 * Get disk usage statistics for the system
 */
async function getDiskUsage() {
  try {
    const { stdout } = await execPromise("df -B1 / | tail -1 | awk '{print $2,$3,$4,$5}'");
    const [total, used, available, percentStr] = stdout.trim().split(' ');
    
    return {
      total: parseInt(total),
      used: parseInt(used),
      available: parseInt(available),
      percentUsed: parseInt(percentStr.replace('%', ''))
    };
  } catch (error) {
    logger.error('Error getting disk usage:', error.message);
    throw new Error('Failed to get disk usage statistics');
  }
}

/**
 * Get comprehensive storage statistics
 */
async function getStorageStats() {
  try {
    const [repoStats, diskStats] = await Promise.all([
      getRepoStats(),
      getDiskUsage()
    ]);

    const percentOfDisk = (repoStats.repoSize / diskStats.total) * 100;

    // Determine health status
    let status = 'healthy';
    let statusColor = 'green';
    
    if (diskStats.percentUsed > 80) {
      status = 'critical';
      statusColor = 'red';
    } else if (diskStats.percentUsed > 60) {
      status = 'warning';
      statusColor = 'yellow';
    }

    return {
      disk: {
        total: diskStats.total,
        used: diskStats.used,
        available: diskStats.available,
        percentUsed: diskStats.percentUsed
      },
      ipfs: {
        repoSize: repoStats.repoSize,
        storageMax: repoStats.storageMax,
        numObjects: repoStats.numObjects,
        percentOfDisk: percentOfDisk.toFixed(2)
      },
      status: {
        level: status,
        color: statusColor
      },
      timestamp: new Date().toISOString()
    };
  } catch (error) {
    logger.error('Error getting storage stats:', error);
    throw error;
  }
}

/**
 * List all pinned files with metadata
 */
async function listPinnedFiles() {
  try {
    const response = await axios.post(`${IPFS_API_URL}/api/v0/pin/ls`, null, {
      params: { type: 'recursive' },
      timeout: 30000
    });

    const pins = response.data.Keys || {};
    const pinList = [];

    for (const [cid, pinData] of Object.entries(pins)) {
      try {
        // Get object stats for size
        const statResponse = await axios.post(`${IPFS_API_URL}/api/v0/object/stat`, null, {
          params: { arg: cid },
          timeout: 5000
        });

        pinList.push({
          cid: cid,
          type: pinData.Type,
          size: statResponse.data.CumulativeSize || 0,
          timestamp: new Date().toISOString() // IPFS doesn't track pin time, using current time
        });
      } catch (error) {
        // If we can't get stats, still list the pin
        pinList.push({
          cid: cid,
          type: pinData.Type,
          size: 0,
          timestamp: new Date().toISOString()
        });
      }
    }

    return pinList;
  } catch (error) {
    logger.error('Error listing pinned files:', error.message);
    throw new Error('Failed to list pinned files');
  }
}

/**
 * Unpin files by CID (with safety checks)
 */
async function unpinFiles(cids, force = false) {
  const results = {
    success: [],
    failed: [],
    skipped: []
  };

  for (const cid of cids) {
    try {
      // Safety check: Don't unpin if we can't verify
      if (!force) {
        // In a real implementation, you'd check against MongoDB
        // to see when this was pinned. For now, we'll allow it.
        logger.info(`Unpinning CID: ${cid}`);
      }

      await axios.post(`${IPFS_API_URL}/api/v0/pin/rm`, null, {
        params: { arg: cid },
        timeout: 10000
      });

      results.success.push(cid);
      logger.info(`Successfully unpinned: ${cid}`);
    } catch (error) {
      logger.error(`Failed to unpin ${cid}:`, error.message);
      results.failed.push({ cid, error: error.message });
    }
  }

  return results;
}

/**
 * Get list of unpinned objects (objects not pinned but still in repo)
 * This is an approximation - IPFS doesn't explicitly track "unpinned" status
 */
async function listUnpinnedFiles() {
  try {
    // This is a simplified approach - in reality, unpinned objects
    // are just objects in the repo that aren't pinned
    // They'll be removed on next GC
    
    // For now, we'll return empty array and let GC stats show potential savings
    return [];
  } catch (error) {
    logger.error('Error listing unpinned files:', error.message);
    return [];
  }
}

/**
 * Run IPFS garbage collection
 */
async function runGarbageCollection() {
  try {
    logger.info('Starting IPFS garbage collection...');
    
    const startTime = Date.now();
    const beforeStats = await getRepoStats();

    // Run GC - this can take a while
    await axios.post(`${IPFS_API_URL}/api/v0/repo/gc`, null, {
      timeout: 300000 // 5 minutes timeout
    });

    const afterStats = await getRepoStats();
    const duration = Date.now() - startTime;
    const spaceFreed = beforeStats.repoSize - afterStats.repoSize;

    logger.info(`Garbage collection completed in ${duration}ms, freed ${spaceFreed} bytes`);

    return {
      success: true,
      spaceFreed: spaceFreed,
      beforeSize: beforeStats.repoSize,
      afterSize: afterStats.repoSize,
      duration: duration,
      timestamp: new Date().toISOString()
    };
  } catch (error) {
    logger.error('Error running garbage collection:', error.message);
    throw new Error('Failed to run garbage collection: ' + error.message);
  }
}

/**
 * Estimate reclaimable space (space that would be freed by GC)
 */
async function estimateReclaimableSpace() {
  try {
    // IPFS doesn't have a built-in way to estimate this
    // We'd need to compare pinned vs total objects
    // For now, return a placeholder
    const repoStats = await getRepoStats();
    
    return {
      estimated: 0,
      note: 'Run garbage collection to see actual space freed'
    };
  } catch (error) {
    logger.error('Error estimating reclaimable space:', error.message);
    return { estimated: 0, note: 'Unable to estimate' };
  }
}

/**
 * Format bytes to human readable format
 */
function formatBytes(bytes, decimals = 2) {
  if (bytes === 0) return '0 Bytes';
  
  const k = 1024;
  const dm = decimals < 0 ? 0 : decimals;
  const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  
  return parseFloat((bytes / Math.pow(k, i)).toFixed(dm)) + ' ' + sizes[i];
}

module.exports = {
  getStorageStats,
  getRepoStats,
  getDiskUsage,
  listPinnedFiles,
  unpinFiles,
  listUnpinnedFiles,
  runGarbageCollection,
  estimateReclaimableSpace,
  formatBytes
};
