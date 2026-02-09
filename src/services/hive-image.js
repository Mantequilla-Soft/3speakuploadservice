const axios = require('axios');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const FormData = require('form-data');
const dhive = require('@hiveio/dhive');

/**
 * Hive Image Upload Service
 * Uploads images to images.hive.blog with proper authentication
 * Uses circuit breaker pattern for resilience
 */
class HiveImageService {
  constructor() {
    this.account = process.env.HIVE_IMAGE_ACCOUNT;
    this.postingKey = process.env.HIVE_IMAGE_POSTING_KEY;
    this.uploadUrl = 'https://images.hive.blog';
    this.tempDir = process.env.HIVE_TEMP_DIR || '/tmp';
    this.maxRetries = parseInt(process.env.HIVE_MAX_RETRIES || '2', 10);
    this.maxFileSize = 10 * 1024 * 1024; // 10MB limit
    
    // Initialize Hive private key
    this.privateKey = null;
    
    // Circuit breaker state
    this.circuitBreaker = {
      failureCount: 0,
      maxFailures: 5,
      isOpen: false,
      openedAt: null,
      resetTimeout: 60000 // 60 seconds
    };
    
    // Validate configuration at startup
    if (this.account && this.postingKey) {
      this._initializeKey();
      console.log(`✅ Hive image upload enabled for account: ${this.account}`);
    } else {
      console.warn('⚠️ Hive image upload disabled - missing HIVE_IMAGE_ACCOUNT or HIVE_IMAGE_POSTING_KEY');
    }
  }

  /**
   * Initialize and validate Hive private key
   * @private
   */
  _initializeKey() {
    try {
      // Validate key format
      if (!this.postingKey || !this.postingKey.startsWith('5')) {
        throw new Error('Invalid HIVE_IMAGE_POSTING_KEY format - must start with "5"');
      }
      
      // Create PrivateKey instance
      this.privateKey = dhive.PrivateKey.fromString(this.postingKey);
      
      console.log('✅ Hive posting key validated successfully');
    } catch (error) {
      console.error('❌ Failed to initialize Hive posting key:', error.message);
      throw new Error(`Invalid HIVE_IMAGE_POSTING_KEY: ${error.message}`);
    }
  }

  /**
   * Check if Hive upload is configured and available
   * @returns {boolean}
   */
  isEnabled() {
    if (!this.account || !this.postingKey) {
      return false;
    }
    
    // Check circuit breaker
    if (this.circuitBreaker.isOpen) {
      const now = Date.now();
      const timeSinceOpened = now - this.circuitBreaker.openedAt;
      
      if (timeSinceOpened >= this.circuitBreaker.resetTimeout) {
        // Try to reset circuit breaker
        console.log('🔄 Circuit breaker reset timeout reached, attempting to close');
        this.circuitBreaker.isOpen = false;
        this.circuitBreaker.failureCount = 0;
        return true;
      }
      
      console.log(`🔴 Hive upload circuit breaker is open (${Math.round(timeSinceOpened / 1000)}s/${this.circuitBreaker.resetTimeout / 1000}s)`);
      return false;
    }
    
    return true;
  }

  /**
   * Record a failure and potentially open circuit breaker
   * @private
   */
  _recordFailure() {
    this.circuitBreaker.failureCount++;
    
    if (this.circuitBreaker.failureCount >= this.circuitBreaker.maxFailures) {
      this.circuitBreaker.isOpen = true;
      this.circuitBreaker.openedAt = Date.now();
      console.error(`🔴 Hive upload circuit breaker opened after ${this.circuitBreaker.failureCount} consecutive failures`);
    }
  }

  /**
   * Reset circuit breaker on successful upload
   * @private
   */
  _recordSuccess() {
    if (this.circuitBreaker.failureCount > 0) {
      console.log(`✅ Hive upload successful - resetting failure count (was ${this.circuitBreaker.failureCount})`);
    }
    this.circuitBreaker.failureCount = 0;
  }

  /**
   * Generate signature for Hive image upload
   * Based on hivesnaps implementation
   * @private
   * @param {Buffer} imageBuffer - Image file buffer
   * @returns {string} Hex signature
   */
  _generateSignature(imageBuffer) {
    // Create SHA-256 hash of the image content
    const hash = crypto.createHash('sha256').update(imageBuffer).digest('hex');
    
    // Sign the hash buffer with the Hive private key
    const hashBuffer = Buffer.from(hash, 'hex');
    const signature = this.privateKey.sign(hashBuffer);
    
    // Convert signature to hex string
    const signatureHex = signature.toString('hex');
    
    console.log(`🔐 Signature debug - Hash: ${hash.substring(0, 16)}..., Sig: ${signatureHex.substring(0, 16)}...`);
    
    // Return signature as hex string
    return signatureHex;
  }

  /**
   * Single upload attempt
   * @private
   */
  async _attemptUpload(filePath, imageBuffer, attemptNumber) {
    console.log(`🔄 Hive upload attempt ${attemptNumber}: ${path.basename(filePath)} (${imageBuffer.length} bytes)`);

    // Generate signature
    const signature = this._generateSignature(imageBuffer);

    const form = new FormData();
    form.append('file', fs.createReadStream(filePath));

    try {
      // Upload with signature in URL path
      const response = await axios.post(`${this.uploadUrl}/${this.account}/${signature}`, form, {
        headers: {
          ...form.getHeaders()
        },
        timeout: 30000, // 30 seconds
        maxContentLength: this.maxFileSize,
        maxBodyLength: this.maxFileSize
      });

      // Parse response
      if (response.data && response.data.url) {
        const imageUrl = response.data.url;
        console.log(`✅ Hive upload successful: ${imageUrl}`);
        return {
          url: imageUrl,
          success: true
        };
      } else {
        throw new Error(`Invalid response from Hive: ${JSON.stringify(response.data)}`);
      }
    } catch (error) {
      // Enhanced error logging
      if (error.response) {
        console.error(`❌ Hive API error (${error.response.status}):`, error.response.data);
        throw new Error(`Hive API error: ${error.response.status} - ${JSON.stringify(error.response.data)}`);
      } else if (error.request) {
        throw new Error(`Network error: ${error.message}`);
      } else {
        throw error;
      }
    }
  }

  /**
   * Upload image file to Hive
   * @param {string} filePath - Path to image file
   * @returns {Promise<{url: string, success: boolean}>}
   */
  async uploadFile(filePath) {
    if (!this.isEnabled()) {
      throw new Error('Hive image upload not available');
    }

    // Validate file exists
    if (!fs.existsSync(filePath)) {
      throw new Error(`File not found: ${filePath}`);
    }

    // Check file size
    const stats = fs.statSync(filePath);
    if (stats.size > this.maxFileSize) {
      throw new Error(`File too large: ${stats.size} bytes (max ${this.maxFileSize} bytes)`);
    }

    // Read file buffer
    const imageBuffer = fs.readFileSync(filePath);
    
    // Retry logic
    let lastError;
    for (let attempt = 1; attempt <= this.maxRetries + 1; attempt++) {
      try {
        const result = await this._attemptUpload(filePath, imageBuffer, attempt);
        this._recordSuccess();
        return result;
      } catch (error) {
        lastError = error;
        console.error(`❌ Hive upload attempt ${attempt}/${this.maxRetries + 1} failed:`, error.message);
        
        if (attempt <= this.maxRetries) {
          const backoffMs = Math.pow(2, attempt - 1) * 1000; // Exponential backoff
          console.log(`⏳ Retrying in ${backoffMs}ms...`);
          await new Promise(resolve => setTimeout(resolve, backoffMs));
        }
      }
    }

    // All attempts failed
    this._recordFailure();
    throw new Error(`Hive upload failed after ${this.maxRetries + 1} attempts: ${lastError.message}`);
  }

  /**
   * Upload base64 encoded image to Hive
   * @param {string} base64Data - Base64 encoded image (with data:image/... prefix)
   * @returns {Promise<{url: string, success: boolean}>}
   */
  async uploadBase64(base64Data) {
    if (!this.isEnabled()) {
      throw new Error('Hive image upload not available');
    }

    // Parse base64 data
    const matches = base64Data.match(/^data:image\/([a-z]+);base64,(.+)$/);
    if (!matches) {
      throw new Error('Invalid base64 image data format');
    }

    const [, extension, data] = matches;
    
    // Estimate size before decoding
    const estimatedSize = (data.length * 3) / 4; // Base64 overhead ~33%
    if (estimatedSize > this.maxFileSize) {
      throw new Error(`Image too large: ~${Math.round(estimatedSize / 1024 / 1024)}MB (max 10MB)`);
    }

    const buffer = Buffer.from(data, 'base64');

    // Double-check actual size
    if (buffer.length > this.maxFileSize) {
      throw new Error(`Image too large: ${buffer.length} bytes (max ${this.maxFileSize} bytes)`);
    }

    // Create temporary file with unique name
    const randomSuffix = crypto.randomBytes(4).toString('hex');
    const tempFile = path.join(this.tempDir, `hive_thumb_${Date.now()}_${randomSuffix}.${extension}`);

    try {
      fs.writeFileSync(tempFile, buffer);
      return await this.uploadFile(tempFile);
    } finally {
      // Clean up temp file
      try {
        if (fs.existsSync(tempFile)) {
          fs.unlinkSync(tempFile);
          console.log(`🧹 Cleaned up temp file: ${path.basename(tempFile)}`);
        }
      } catch (cleanupError) {
        console.warn(`⚠️ Failed to cleanup temp file ${tempFile}:`, cleanupError.message);
      }
    }
  }

  /**
   * Get circuit breaker status
   * @returns {object}
   */
  getStatus() {
    return {
      enabled: !!this.account && !!this.postingKey,
      available: this.isEnabled(),
      circuitBreaker: {
        isOpen: this.circuitBreaker.isOpen,
        failureCount: this.circuitBreaker.failureCount,
        maxFailures: this.circuitBreaker.maxFailures,
        openedAt: this.circuitBreaker.openedAt,
        resetTimeout: this.circuitBreaker.resetTimeout
      }
    };
  }
}

// Singleton instance
const hiveImageService = new HiveImageService();

module.exports = hiveImageService;
