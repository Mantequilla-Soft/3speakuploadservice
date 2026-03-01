const axios = require('axios');
const fs = require('fs');
const path = require('path');
const FormData = require('form-data');

/**
 * 3Speak Image Upload Service
 * Uploads images to images.3speak.tv with Bearer token authentication
 * Uses circuit breaker pattern for resilience
 */
class ThreeSpeakImageService {
  constructor() {
    this.apiUrl = process.env.THREESPEAK_IMAGE_URL || 'https://images.3speak.tv';
    this.apiKey = process.env.THREESPEAK_IMAGE_API_KEY;
    this.tempDir = process.env.THREESPEAK_TEMP_DIR || '/tmp';
    this.maxRetries = parseInt(process.env.THREESPEAK_MAX_RETRIES || '2', 10);
    this.maxFileSize = 10 * 1024 * 1024; // 10MB limit (per API spec)
    this.timeout = 30000; // 30 second timeout
    
    // Circuit breaker state
    this.circuitBreaker = {
      failureCount: 0,
      maxFailures: 5,
      isOpen: false,
      openedAt: null,
      resetTimeout: 60000 // 60 seconds
    };
    
    // Stats tracking
    this.stats = {
      totalUploads: 0,
      successfulUploads: 0,
      failedUploads: 0,
      totalBytes: 0
    };
    
    // Validate configuration at startup
    if (this.apiKey) {
      console.log(`✅ 3Speak image upload enabled (${this.apiUrl})`);
    } else {
      console.warn('⚠️  3Speak image upload disabled - missing THREESPEAK_IMAGE_API_KEY');
    }
  }

  /**
   * Check if 3Speak upload is configured and available
   * @returns {boolean}
   */
  isEnabled() {
    if (!this.apiKey) {
      return false;
    }
    
    // Check circuit breaker
    if (this.circuitBreaker.isOpen) {
      const now = Date.now();
      const timeSinceOpened = now - this.circuitBreaker.openedAt;
      
      if (timeSinceOpened >= this.circuitBreaker.resetTimeout) {
        // Try to reset circuit breaker
        console.log('🔄 3Speak circuit breaker reset timeout reached, attempting to close');
        this.circuitBreaker.isOpen = false;
        this.circuitBreaker.failureCount = 0;
        return true;
      }
      
      const remainingSeconds = Math.round((this.circuitBreaker.resetTimeout - timeSinceOpened) / 1000);
      console.warn(`🔴 3Speak upload circuit breaker is open (resets in ${remainingSeconds}s)`);
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
    this.stats.failedUploads++;
    
    if (this.circuitBreaker.failureCount >= this.circuitBreaker.maxFailures) {
      this.circuitBreaker.isOpen = true;
      this.circuitBreaker.openedAt = Date.now();
      console.error(`🔴 3Speak upload circuit breaker OPENED after ${this.circuitBreaker.failureCount} failures`);
    } else {
      console.warn(`⚠️  3Speak upload failure ${this.circuitBreaker.failureCount}/${this.circuitBreaker.maxFailures}`);
    }
  }

  /**
   * Record a successful upload
   * @private
   */
  _recordSuccess() {
    // Reset failure count on success
    if (this.circuitBreaker.failureCount > 0) {
      console.log(`✅ 3Speak upload recovered, resetting failure count from ${this.circuitBreaker.failureCount}`);
      this.circuitBreaker.failureCount = 0;
    }
    
    this.stats.successfulUploads++;
  }

  /**
   * Upload an image file to 3Speak image server
   * @param {string} filePath - Path to image file
   * @returns {Promise<string>} - URL of uploaded image
   */
  async uploadFile(filePath) {
    if (!this.isEnabled()) {
      throw new Error('3Speak image upload is not enabled or circuit breaker is open');
    }

    const startTime = Date.now();
    this.stats.totalUploads++;

    try {
      // Validate file exists
      if (!fs.existsSync(filePath)) {
        throw new Error(`File not found: ${filePath}`);
      }

      // Check file size
      const stats = fs.statSync(filePath);
      if (stats.size > this.maxFileSize) {
        throw new Error(`File too large: ${stats.size} bytes (max: ${this.maxFileSize})`);
      }

      console.log(`📤 Uploading to 3Speak: ${path.basename(filePath)} (${stats.size} bytes)`);

      // Create form data
      const form = new FormData();
      form.append('image', fs.createReadStream(filePath));

      // Make upload request with retry logic
      let lastError;
      for (let attempt = 1; attempt <= this.maxRetries; attempt++) {
        try {
          const response = await axios.post(`${this.apiUrl}/upload`, form, {
            headers: {
              ...form.getHeaders(),
              'Authorization': `Bearer ${this.apiKey}`
            },
            timeout: this.timeout,
            maxContentLength: Infinity,
            maxBodyLength: Infinity
          });

          // Validate response - API returns 200 or 201 for success
          if ((response.status === 200 || response.status === 201) && response.data && response.data.url) {
            const imageUrl = response.data.url;
            const duration = Date.now() - startTime;
            
            this.stats.totalBytes += stats.size;
            this._recordSuccess();
            
            console.log(`✅ 3Speak upload successful (${duration}ms): ${imageUrl}`);
            return imageUrl;
          } else {
            throw new Error(`Unexpected response format: ${JSON.stringify(response.data)}`);
          }
        } catch (error) {
          lastError = error;
          
          // Log full error for debugging
          console.error(`❌ 3Speak upload error:`, {
            message: error.message,
            code: error.code,
            hasResponse: !!error.response,
            status: error.response?.status,
            statusText: error.response?.statusText
          });
          
          // Don't retry on client errors (400, 401, 403, 413)
          if (error.response) {
            const status = error.response.status;
            if (status === 400 || status === 401 || status === 403 || status === 413) {
              throw this._createDetailedError(error);
            }
          }
          
          // Retry on network errors or server errors
          if (attempt < this.maxRetries) {
            const delay = Math.pow(2, attempt - 1) * 1000; // Exponential backoff
            console.warn(`⚠️  3Speak upload attempt ${attempt} failed, retrying in ${delay}ms...`);
            await new Promise(resolve => setTimeout(resolve, delay));
          }
        }
      }

      // All retries failed
      throw lastError;

    } catch (error) {
      this._recordFailure();
      const detailedError = this._createDetailedError(error);
      console.error(`❌ 3Speak upload failed: ${detailedError.message}`);
      throw detailedError;
    }
  }

  /**
   * Upload a base64-encoded image to 3Speak image server
   * @param {string} base64Data - Base64-encoded image data (with or without data URI prefix)
   * @returns {Promise<string>} - URL of uploaded image
   */
  async uploadBase64(base64Data) {
    if (!this.isEnabled()) {
      throw new Error('3Speak image upload is not enabled or circuit breaker is open');
    }

    let tempFilePath = null;

    try {
      // Extract mime type and strip data URI prefix if present
      const mimeMatch = base64Data.match(/^data:image\/(\w+);base64,/);
      const ext = mimeMatch ? (mimeMatch[1] === 'jpeg' ? 'jpg' : mimeMatch[1]) : 'jpg';
      const base64Clean = mimeMatch ? base64Data.slice(mimeMatch[0].length) : base64Data;

      // Decode base64
      const buffer = Buffer.from(base64Clean, 'base64');

      // Validate size
      if (buffer.length > this.maxFileSize) {
        throw new Error(`Image too large: ${buffer.length} bytes (max: ${this.maxFileSize})`);
      }

      // Create temporary file with correct extension so form-data sends the right Content-Type
      tempFilePath = path.join(this.tempDir, `threespeak-upload-${Date.now()}-${Math.random().toString(36).substr(2, 9)}.${ext}`);
      fs.writeFileSync(tempFilePath, buffer);

      console.log(`📤 Uploading base64 image to 3Speak (${buffer.length} bytes)`);

      // Upload the temporary file
      const imageUrl = await this.uploadFile(tempFilePath);
      
      return imageUrl;

    } catch (error) {
      console.error(`❌ 3Speak base64 upload failed: ${error.message}`);
      throw error;
    } finally {
      // Clean up temporary file
      if (tempFilePath && fs.existsSync(tempFilePath)) {
        try {
          fs.unlinkSync(tempFilePath);
          // Temp file cleanup successful
        } catch (cleanupError) {
          console.warn(`⚠️  Failed to cleanup temp file: ${cleanupError.message}`);
        }
      }
    }
  }

  /**
   * Create a detailed error with context
   * @private
   */
  _createDetailedError(error) {
    if (error.response) {
      const status = error.response.status;
      const data = error.response.data;
      
      let message = `HTTP ${status}`;
      
      switch (status) {
        case 400:
          message = 'Invalid image file or corrupted data';
          break;
        case 401:
          message = 'Missing Authorization header';
          break;
        case 403:
          message = 'Invalid API key';
          break;
        case 413:
          message = 'File too large (max 10MB)';
          break;
        case 507:
          message = 'Server storage full';
          break;
        case 500:
          message = 'Server error';
          break;
        default:
          message = data?.error || data?.message || `HTTP ${status}`;
      }
      
      const detailedError = new Error(`3Speak upload failed: ${message}`);
      detailedError.status = status;
      detailedError.response = data;
      return detailedError;
    }
    
    if (error.code === 'ECONNREFUSED') {
      return new Error('3Speak image server unavailable (connection refused)');
    }
    
    if (error.code === 'ETIMEDOUT' || error.code === 'ESOCKETTIMEDOUT') {
      return new Error('3Speak image server timeout');
    }
    
    return error;
  }

  /**
   * Get current service status and stats
   * @returns {Object}
   */
  getStatus() {
    return {
      enabled: this.isEnabled(),
      configured: !!this.apiKey,
      circuitBreaker: {
        isOpen: this.circuitBreaker.isOpen,
        failureCount: this.circuitBreaker.failureCount,
        maxFailures: this.circuitBreaker.maxFailures,
        openedAt: this.circuitBreaker.openedAt,
        resetTimeout: this.circuitBreaker.resetTimeout
      },
      stats: {
        ...this.stats,
        averageSize: this.stats.successfulUploads > 0 
          ? Math.round(this.stats.totalBytes / this.stats.successfulUploads)
          : 0
      },
      endpoint: this.apiUrl
    };
  }
}

// Create singleton instance
const threeSpeakImageService = new ThreeSpeakImageService();

module.exports = threeSpeakImageService;
