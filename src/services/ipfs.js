const axios = require('axios');
const FormData = require('form-data');
const fs = require('fs');
const path = require('path');
const hiveImageService = require('./hive-image');
const threeSpeakImageService = require('./threespeak-image');

class IPFSService {
  constructor() {
    // Primary: 3Speak's IPFS supernode
    this.supernodeUrl = process.env.IPFS_SUPERNODE_URL || 'http://65.21.201.94:5002';
    
    // Fallback: Local IPFS daemon  
    this.fallbackUrl = process.env.IPFS_FALLBACK_URL || 'http://localhost:5001';
    this.fallbackGateway = process.env.IPFS_FALLBACK_GATEWAY || 'https://ipfs.yourdomain.com';
    
    // Gateways
    this.primaryGateway = process.env.THREESPEAK_IPFS_GATEWAY || 'https://ipfs.3speak.tv';
  }

  /**
   * Upload file to IPFS - LOCAL FIRST strategy
   * Pins to local IPFS node immediately (fast), then syncs to supernode in background
   * @param {string} filePath - Path to file to upload
   * @returns {Promise<{hash: string, fallbackMode: boolean, gatewayUrl: string}>}
   */
  async uploadFile(filePath) {
    if (!fs.existsSync(filePath)) {
      throw new Error(`File not found: ${filePath}`);
    }

    // INVERTED STRATEGY: Pin locally FIRST (instant, reliable)
    try {
      const result = await this._uploadToLocal(filePath);
      console.log(`✅ Pinned locally: ${result.hash}`);
      
      // Announce to DHT immediately (helps encoders find content faster)
      this._announceToLocalDHT(result.hash).catch(err => {
        console.warn(`⚠️ Local DHT announcement failed (non-critical): ${err.message}`);
      });
      
      // Background sync to supernode (fire and forget - not critical path)
      this._syncToSupernodeBackground(filePath, result.hash).catch(err => {
        console.warn(`⚠️ Background supernode sync failed (non-critical): ${err.message}`);
      });
      
      return {
        hash: result.hash,
        fallbackMode: false, // Local is now PRIMARY
        gatewayUrl: `${this.primaryGateway}/ipfs/${result.hash}` // Encoders will fetch via DHT
      };
    } catch (localError) {
      console.error(`❌ Local IPFS pin failed: ${localError.message}`);
      
      // Fallback to direct supernode upload (old behavior)
      try {
        const result = await this._uploadToSupernode(filePath);
        console.log(`⚠️ Supernode direct upload successful: ${result.hash}`);
        
        // Announce to supernode DHT
        this._announceToSupernodeDHT(result.hash).catch(err => {
          console.warn(`⚠️ Supernode DHT announcement failed (non-critical): ${err.message}`);
        });
        
        return {
          hash: result.hash,
          fallbackMode: true,
          gatewayUrl: `${this.primaryGateway}/ipfs/${result.hash}`
        };
      } catch (supernodeError) {
        throw new Error(`Both uploads failed. Local: ${localError.message}, Supernode: ${supernodeError.message}`);
      }
    }
  }

  /**
   * Upload to LOCAL IPFS node (fast, reliable)
   * @private
   */
  async _uploadToLocal(filePath) {
    const form = new FormData();
    const fileName = path.basename(filePath);
    form.append('file', fs.createReadStream(filePath), fileName);
    
    const response = await axios.post(`${this.fallbackUrl}/api/v0/add`, form, {
      headers: { ...form.getHeaders() },
      params: {
        'wrap-with-directory': false,
        'recursive': false,
        'pin': true // Pin locally so encoders can fetch via DHT
      },
      timeout: 120000, // 2 minutes - local should be fast
      maxContentLength: 8 * 1024 * 1024 * 1024,
      maxBodyLength: 8 * 1024 * 1024 * 1024
    });
    
    console.log('📊 Local IPFS response:', response.data);
    
    // Handle different response formats
    if (typeof response.data === 'object' && response.data.Hash) {
      return { hash: response.data.Hash };
    }
    
    let responseText = typeof response.data === 'string' ? response.data : JSON.stringify(response.data);
    const lines = responseText.trim().split('\n');
    const result = JSON.parse(lines[lines.length - 1]);
    
    if (!result.Hash) {
      throw new Error('No hash returned from local IPFS');
    }
    
    return { hash: result.Hash };
  }

  /**
   * Background sync to supernode (non-blocking)
   * @private
   */
  async _syncToSupernodeBackground(filePath, expectedHash) {
    console.log(`🔄 Background: Syncing ${expectedHash} to supernode...`);
    try {
      const result = await this._uploadToSupernode(filePath);
      if (result.hash === expectedHash) {
        console.log(`✅ Background: Supernode sync complete for ${expectedHash}`);
        // Announce on supernode too
        this._announceToSupernodeDHT(expectedHash).catch(err => {
          console.warn(`⚠️ Background supernode DHT announcement failed: ${err.message}`);
        });
      } else {
        console.warn(`⚠️ Background: Hash mismatch! Local: ${expectedHash}, Supernode: ${result.hash}`);
      }
    } catch (error) {
      console.error(`❌ Background: Supernode sync failed for ${expectedHash}:`, error.message);
      // Don't throw - this is non-critical background operation
    }
  }

  /**
   * Announce hash to local IPFS DHT
   * Forces immediate DHT propagation for faster encoder discovery
   * @private
   */
  async _announceToLocalDHT(hash) {
    try {
      console.log(`📢 Announcing ${hash} to local DHT...`);
      await axios.post(`${this.fallbackUrl}/api/v0/dht/provide`, null, {
        params: { arg: hash },
        timeout: 30000 // 30 seconds
      });
      console.log(`✅ DHT announcement complete (local): ${hash}`);
    } catch (error) {
      // Non-critical - pinning alone will eventually announce
      console.warn(`⚠️ Local DHT announcement failed for ${hash}:`, error.message);
    }
  }

  /**
   * Announce hash to supernode IPFS DHT
   * @private
   */
  async _announceToSupernodeDHT(hash) {
    try {
      console.log(`📢 Announcing ${hash} to supernode DHT...`);
      await axios.post(`${this.supernodeUrl}/api/v0/dht/provide`, null, {
        params: { arg: hash },
        timeout: 30000 // 30 seconds
      });
      console.log(`✅ DHT announcement complete (supernode): ${hash}`);
    } catch (error) {
      // Non-critical - pinning alone will eventually announce
      console.warn(`⚠️ Supernode DHT announcement failed for ${hash}:`, error.message);
    }
  }


  /**
   * Upload file to 3Speak supernode
   * @private
   */
  async _uploadToSupernode(filePath) {
    const form = new FormData();
    const fileName = path.basename(filePath);
    form.append('file', fs.createReadStream(filePath), fileName);
    
    const response = await axios.post(`${this.supernodeUrl}/api/v0/add`, form, {
      headers: { ...form.getHeaders() },
      params: {
        'wrap-with-directory': 'false',
        'recursive': 'false',
        'pin': 'true'
      },
      timeout: 1800000, // 30 minutes for large video files
      maxContentLength: 8 * 1024 * 1024 * 1024, // 8GB max
      maxBodyLength: 8 * 1024 * 1024 * 1024
    });
    
    console.log('📊 Supernode response type:', typeof response.data);
    console.log('📊 Supernode response:', response.data);
    
    // Handle different response formats
    let responseText;
    if (typeof response.data === 'string') {
      responseText = response.data;
    } else if (typeof response.data === 'object') {
      // If it's already an object, check if it has Hash property
      if (response.data.Hash) {
        return { hash: response.data.Hash };
      }
      // Otherwise stringify it
      responseText = JSON.stringify(response.data);
    } else {
      responseText = String(response.data);
    }
    
    // Parse IPFS response (could be multiple JSON lines)
    const lines = responseText.trim().split('\n');
    const result = JSON.parse(lines[lines.length - 1]);
    
    if (!result.Hash) {
      throw new Error('No hash returned from supernode');
    }
    
    return { hash: result.Hash };
  }

  /**
   * Upload file to local IPFS fallback
   * @private
   */
  async _uploadToFallback(filePath) {
    const form = new FormData();
    const fileName = path.basename(filePath);
    form.append('file', fs.createReadStream(filePath), fileName);
    
    const response = await axios.post(`${this.fallbackUrl}/api/v0/add`, form, {
      headers: { ...form.getHeaders() },
      params: {
        'wrap-with-directory': false,
        'recursive': false,
        'pin': true
      },
      timeout: 1800000, // 30 minutes for large video files
      maxContentLength: 8 * 1024 * 1024 * 1024,
      maxBodyLength: 8 * 1024 * 1024 * 1024
    });
    
    console.log('📊 Fallback response type:', typeof response.data);
    console.log('📊 Fallback response:', response.data);
    
    // Handle different response formats (same as supernode)
    let responseText;
    if (typeof response.data === 'string') {
      responseText = response.data;
    } else if (typeof response.data === 'object') {
      // If it's already an object, check if it has Hash property
      if (response.data.Hash) {
        return { hash: response.data.Hash };
      }
      // Otherwise stringify it
      responseText = JSON.stringify(response.data);
    } else {
      responseText = String(response.data);
    }
    
    // Parse IPFS response (could be multiple JSON lines)
    const lines = responseText.trim().split('\n');
    const result = JSON.parse(lines[lines.length - 1]);
    
    if (!result.Hash) {
      throw new Error('No hash returned from fallback');
    }
    
    return { hash: result.Hash };
  }

  /**
   * Upload thumbnail image with Hive → IPFS fallback strategy
   * @param {string} filePath - Path to thumbnail file
   * @returns {Promise<{hash: string, url: string, source: string, fallbackMode: boolean, gatewayUrl: string}>}
   */
  async uploadThumbnail(filePath) {
    return this._uploadThumbnailWithFallback(async () => {
      // For file uploads, pass the file path
      return { filePath };
    });
  }

  /**
   * Upload base64 thumbnail with Hive → IPFS fallback strategy
   * @param {string} base64Data - Base64 encoded image data (with data:image/... prefix)
   * @returns {Promise<{hash: string, url: string, source: string, fallbackMode: boolean, gatewayUrl: string}>}
   */
  async uploadThumbnailBase64(base64Data) {
    return this._uploadThumbnailWithFallback(async () => {
      // For base64, we need to pass the base64 data
      return { base64Data };
    });
  }

  /**
   * Unified thumbnail upload with Hive → 3Speak → IPFS fallback
   * @private
   * @param {Function} dataProvider - Async function that returns {filePath} or {base64Data}
   * @returns {Promise<{hash: string, url: string, source: string, fallbackMode: boolean, gatewayUrl: string}>}
   */
  async _uploadThumbnailWithFallback(dataProvider) {
    const data = await dataProvider();
    
    // Strategy 1: Try Hive first (if enabled)
    if (hiveImageService.isEnabled()) {
      try {
        console.log('🎯 Attempting Hive image upload (primary)...');
        let hiveResult;
        
        if (data.filePath) {
          hiveResult = await hiveImageService.uploadFile(data.filePath);
        } else if (data.base64Data) {
          hiveResult = await hiveImageService.uploadBase64(data.base64Data);
        }
        
        if (hiveResult && hiveResult.success) {
          console.log(`✅ Hive upload successful: ${hiveResult.url}`);
          return {
            hash: null, // Hive doesn't use IPFS hashes
            url: hiveResult.url,
            source: 'hive',
            fallbackMode: false,
            gatewayUrl: hiveResult.url
          };
        }
      } catch (hiveError) {
        console.warn(`⚠️ Hive upload failed, trying 3Speak fallback: ${hiveError.message}`);
      }
    } else {
      console.log('ℹ️ Hive upload not available, trying 3Speak');
    }
    
    // Strategy 2: Try 3Speak image server (middle fallback)
    if (threeSpeakImageService.isEnabled()) {
      try {
        console.log('🎯 Attempting 3Speak image upload (secondary)...');
        let threeSpeakUrl;
        
        if (data.filePath) {
          threeSpeakUrl = await threeSpeakImageService.uploadFile(data.filePath);
        } else if (data.base64Data) {
          threeSpeakUrl = await threeSpeakImageService.uploadBase64(data.base64Data);
        }
        
        if (threeSpeakUrl) {
          console.log(`✅ 3Speak upload successful: ${threeSpeakUrl}`);
          return {
            hash: null, // 3Speak returns direct URLs, not IPFS hashes
            url: threeSpeakUrl,
            source: '3speak',
            fallbackMode: false,
            gatewayUrl: threeSpeakUrl
          };
        }
      } catch (threeSpeakError) {
        console.warn(`⚠️ 3Speak upload failed, falling back to IPFS: ${threeSpeakError.message}`);
      }
    } else {
      console.log('ℹ️ 3Speak upload not available, using IPFS');
    }
    
    // Strategy 3: Fallback to IPFS (last resort)
    console.log('🔄 Uploading to IPFS (final fallback)...');
    let ipfsResult;
    
    if (data.filePath) {
      ipfsResult = await this.uploadFile(data.filePath);
    } else if (data.base64Data) {
      // Handle base64 for IPFS
      const matches = data.base64Data.match(/^data:image\/([a-z]+);base64,(.+)$/);
      if (!matches) {
        throw new Error('Invalid base64 image data format');
      }
      
      const [, extension, encodedData] = matches;
      const buffer = Buffer.from(encodedData, 'base64');
      
      // Create temporary file
      const tempDir = '/tmp';
      const tempFile = path.join(tempDir, `thumb_${Date.now()}.${extension}`);
      
      try {
        fs.writeFileSync(tempFile, buffer);
        ipfsResult = await this.uploadFile(tempFile);
      } finally {
        // Clean up temp file
        if (fs.existsSync(tempFile)) {
          fs.unlinkSync(tempFile);
        }
      }
    }
    
    console.log(`✅ IPFS upload successful: ${ipfsResult.hash}`);
    return {
      hash: ipfsResult.hash,
      url: null,
      source: 'ipfs',
      fallbackMode: ipfsResult.fallbackMode,
      gatewayUrl: ipfsResult.gatewayUrl
    };
  }

  /**
   * Check 3Speak supernode health
   * @returns {Promise<{healthy: boolean, data?: any, error?: string}>}
   */
  async checkSupernodeHealth() {
    try {
      const response = await axios.get(`${this.supernodeUrl}/api/v0/id`, { 
        timeout: 10000 
      });
      return { 
        healthy: true, 
        data: response.data,
        endpoint: this.supernodeUrl
      };
    } catch (error) {
      return { 
        healthy: false, 
        error: error.message,
        endpoint: this.supernodeUrl
      };
    }
  }

  /**
   * Check local IPFS fallback health
   * @returns {Promise<{healthy: boolean, data?: any, error?: string}>}
   */
  async checkFallbackHealth() {
    try {
      const response = await axios.get(`${this.fallbackUrl}/api/v0/id`, { 
        timeout: 5000 
      });
      return { 
        healthy: true, 
        data: response.data,
        endpoint: this.fallbackUrl
      };
    } catch (error) {
      return { 
        healthy: false, 
        error: error.message,
        endpoint: this.fallbackUrl
      };
    }
  }

  /**
   * Unpin file from fallback IPFS (for cleanup)
   * @param {string} hash - IPFS hash to unpin
   * @returns {Promise<boolean>}
   */
  async unpinFromFallback(hash) {
    try {
      await axios.post(`${this.fallbackUrl}/api/v0/pin/rm`, null, {
        params: { arg: hash, recursive: true },
        timeout: 10000
      });
      console.log(`📌 Unpinned from fallback: ${hash}`);
      return true;
    } catch (error) {
      // IPFS returns 500 with "not pinned" when the hash was already removed or
      // never pinned locally — treat this as success since the goal is achieved.
      const msg = error.response?.data?.Message || error.message || '';
      if (msg.includes('not pinned')) {
        console.log(`📌 Already unpinned (not in local pinset): ${hash}`);
        return true;
      }
      console.error(`Failed to unpin ${hash}: ${error.message}`);
      return false;
    }
  }

  /**
   * Get appropriate gateway URL for a CID
   * @param {string} cid - IPFS CID/hash
   * @param {boolean} fallbackMode - Whether to use fallback gateway
   * @returns {string}
   */
  getGatewayUrl(cid, fallbackMode = false) {
    return fallbackMode 
      ? `${this.fallbackGateway}/ipfs/${cid}`
      : `${this.primaryGateway}/ipfs/${cid}`;
  }

  /**
   * Check if a file exists on IPFS gateway
   * @param {string} hash - IPFS hash
   * @param {boolean} useFallback - Check fallback gateway instead
   * @returns {Promise<boolean>}
   */
  async checkFileExists(hash, useFallback = false) {
    const gatewayUrl = this.getGatewayUrl(hash, useFallback);
    
    try {
      const response = await axios.head(gatewayUrl, { timeout: 10000 });
      return response.status === 200;
    } catch (error) {
      return false;
    }
  }

  /**
   * Get file stats from IPFS
   * @param {string} hash - IPFS hash
   * @param {boolean} useFallback - Use fallback node
   * @returns {Promise<{size: number, hash: string, type: string}>}
   */
  async getFileStats(hash, useFallback = false) {
    const apiUrl = useFallback ? this.fallbackUrl : this.supernodeUrl;
    
    try {
      const response = await axios.post(`${apiUrl}/api/v0/object/stat`, null, {
        params: { arg: hash },
        timeout: 10000
      });
      
      return {
        size: response.data.CumulativeSize || response.data.DataSize,
        hash: hash,
        type: response.data.Type || 'file'
      };
    } catch (error) {
      throw new Error(`Failed to get file stats: ${error.message}`);
    }
  }

  /**
   * Get service status and stats
   * @returns {Promise<object>}
   */
  async getServiceStatus() {
    const [supernodeHealth, fallbackHealth] = await Promise.all([
      this.checkSupernodeHealth(),
      this.checkFallbackHealth()
    ]);

    return {
      timestamp: new Date().toISOString(),
      supernode: supernodeHealth,
      fallback: fallbackHealth,
      gateways: {
        primary: this.primaryGateway,
        fallback: this.fallbackGateway
      },
      status: (supernodeHealth.healthy || fallbackHealth.healthy) ? 'healthy' : 'degraded'
    };
  }
}

module.exports = new IPFSService();