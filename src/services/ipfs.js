const axios = require('axios');
const FormData = require('form-data');
const fs = require('fs');
const path = require('path');

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
   * Upload file to IPFS with fallback strategy
   * @param {string} filePath - Path to file to upload
   * @returns {Promise<{hash: string, fallbackMode: boolean, gatewayUrl: string}>}
   */
  async uploadFile(filePath) {
    if (!fs.existsSync(filePath)) {
      throw new Error(`File not found: ${filePath}`);
    }

    // Try primary supernode first
    try {
      const result = await this._uploadToSupernode(filePath);
      console.log(`✅ Uploaded to supernode: ${result.hash}`);
      return {
        hash: result.hash,
        fallbackMode: false,
        gatewayUrl: `${this.primaryGateway}/ipfs/${result.hash}`
      };
    } catch (supernodeError) {
      console.error(`❌ Supernode upload failed: ${supernodeError.message}`);
      
      // Fallback to local IPFS
      try {
        const result = await this._uploadToFallback(filePath);
        console.log(`⚠️ Fallback upload successful: ${result.hash}`);
        return {
          hash: result.hash,
          fallbackMode: true,
          gatewayUrl: `${this.fallbackGateway}/ipfs/${result.hash}`
        };
      } catch (fallbackError) {
        throw new Error(`Both uploads failed. Supernode: ${supernodeError.message}, Fallback: ${fallbackError.message}`);
      }
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
   * Upload thumbnail image
   * @param {string} filePath - Path to thumbnail file
   * @returns {Promise<{hash: string, fallbackMode: boolean, gatewayUrl: string}>}
   */
  async uploadThumbnail(filePath) {
    return this.uploadFile(filePath);
  }

  /**
   * Upload base64 thumbnail
   * @param {string} base64Data - Base64 encoded image data (with data:image/... prefix)
   * @returns {Promise<{hash: string, fallbackMode: boolean, gatewayUrl: string}>}
   */
  async uploadThumbnailBase64(base64Data) {
    // Parse base64 data
    const matches = base64Data.match(/^data:image\/([a-z]+);base64,(.+)$/);
    if (!matches) {
      throw new Error('Invalid base64 image data format');
    }
    
    const [, extension, data] = matches;
    const buffer = Buffer.from(data, 'base64');
    
    // Create temporary file
    const tempDir = '/tmp';
    const tempFile = path.join(tempDir, `thumb_${Date.now()}.${extension}`);
    
    try {
      fs.writeFileSync(tempFile, buffer);
      const result = await this.uploadFile(tempFile);
      return result;
    } finally {
      // Clean up temp file
      if (fs.existsSync(tempFile)) {
        fs.unlinkSync(tempFile);
      }
    }
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