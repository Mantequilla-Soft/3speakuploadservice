# Upload-First with Auto-Submit Pattern

## The Best User Experience for Video Uploads

This guide explains how to implement the **optimal upload flow** where:
1. Upload starts **immediately** when file is selected
2. User fills form **while upload happens** in background
3. User clicks "Save" at **any time** (even before upload finishes)
4. System **auto-submits** as soon as upload completes

**Result:** Zero waiting. User never stares at a progress bar doing nothing.

---

## 🎯 Why This Pattern?

### Traditional Flow (Bad UX)
```
Select File → Fill Form → Click Submit → Wait for upload → Wait for processing
                                         ^^^^^^^^^^^^^^^^
                                         User waits here doing nothing!
```

### Upload-First with Auto-Submit (Great UX)
```
Select File → Upload starts immediately
     ↓
Fill Form (upload happening in background)
     ↓
Click "Save" at any time
     ↓
If upload done → Submit immediately
If upload not done → Auto-submit when ready
     ↓
Video processing → Published! 🎉
```

**Key insight:** The upload takes time anyway. Let users be productive during that time!

---

## 📐 Architecture

### State Machine

```
                    ┌─────────────────────────────────────────┐
                    │           COMPONENT STATE               │
                    ├─────────────────────────────────────────┤
                    │  uploadId: string | null                │
                    │  uploadComplete: boolean                │
                    │  uploadProgress: number (0-100)         │
                    │  userWantsToSubmit: boolean             │
                    │  formData: object | null                │
                    │  videoId: string | null (after submit)  │
                    └─────────────────────────────────────────┘

                              STATE TRANSITIONS

    ┌──────────────┐     file selected      ┌──────────────────┐
    │   INITIAL    │ ─────────────────────► │  UPLOADING       │
    │              │                        │  uploadId set    │
    └──────────────┘                        │  progress: 0-99  │
                                            └────────┬─────────┘
                                                     │
                      ┌──────────────────────────────┼───────────────────┐
                      │                              │                   │
                      ▼                              ▼                   │
           ┌─────────────────────┐      ┌─────────────────────┐         │
           │  USER CLICKS SAVE   │      │  UPLOAD COMPLETES   │         │
           │  (upload not done)  │      │  (user hasn't saved)│         │
           │                     │      │                     │         │
           │  userWantsToSubmit  │      │  uploadComplete     │         │
           │  = true             │      │  = true             │         │
           │  formData saved     │      │                     │         │
           └──────────┬──────────┘      └──────────┬──────────┘         │
                      │                            │                    │
                      │     WAITING FOR OTHER      │                    │
                      │         CONDITION          │                    │
                      │                            │                    │
                      └────────────┬───────────────┘                    │
                                   │                                    │
                                   ▼                                    │
                      ┌─────────────────────────────┐                   │
                      │  BOTH CONDITIONS MET        │                   │
                      │  uploadComplete = true      │                   │
                      │  userWantsToSubmit = true   │                   │
                      │                             │                   │
                      │  → AUTO-SUBMIT NOW! 🚀      │                   │
                      └──────────────┬──────────────┘                   │
                                     │                                  │
                                     ▼                                  │
                      ┌─────────────────────────────┐                   │
                      │  PROCESSING                 │◄──────────────────┘
                      │  videoId set                │   (user saved after
                      │  polling for status         │    upload complete)
                      └──────────────┬──────────────┘
                                     │
                                     ▼
                      ┌─────────────────────────────┐
                      │  PUBLISHED! 🎉              │
                      │  video.status = 'published' │
                      └─────────────────────────────┘
```

---

## 🔧 Complete Implementation

### Full Class Implementation

```javascript
import * as tus from 'tus-js-client';

/**
 * Upload-First with Auto-Submit
 * 
 * This class handles the complete upload flow:
 * 1. Initialize upload when file selected (upload starts immediately)
 * 2. Track upload progress in background
 * 3. Accept "Save" click at any time
 * 4. Auto-submit when both upload complete AND user wants to submit
 * 5. Poll encoding status until published
 */
class UploadFirstAutoSubmit {
  constructor(options = {}) {
    // Configuration
    this.baseUrl = options.baseUrl || 'https://video.3speak.tv';
    this.apiToken = options.apiToken || null;
    this.owner = options.owner || null;
    
    // State
    this.reset();
    
    // Callbacks
    this.onUploadProgress = options.onUploadProgress || (() => {});
    this.onUploadComplete = options.onUploadComplete || (() => {});
    this.onSubmitting = options.onSubmitting || (() => {});
    this.onSubmitted = options.onSubmitted || (() => {});
    this.onEncodingProgress = options.onEncodingProgress || (() => {});
    this.onPublished = options.onPublished || (() => {});
    this.onError = options.onError || ((err) => console.error(err));
    this.onStateChange = options.onStateChange || (() => {});
  }

  /**
   * Reset all state (call before starting new upload)
   */
  reset() {
    // Upload state
    this.uploadId = null;
    this.uploadComplete = false;
    this.uploadProgress = 0;
    this.tusUpload = null;
    this.videoFile = null;
    this.videoDuration = null;
    
    // Submit state
    this.userWantsToSubmit = false;
    this.formData = null;
    this.isSubmitting = false;
    
    // Result state
    this.videoId = null;
    this.permlink = null;
    this.encodingStatus = null;
    
    // Error state
    this.error = null;
    
    this._notifyStateChange();
  }

  /**
   * Get current state (useful for React/Vue reactivity)
   */
  getState() {
    return {
      // Upload
      uploadId: this.uploadId,
      uploadComplete: this.uploadComplete,
      uploadProgress: this.uploadProgress,
      isUploading: this.uploadId !== null && !this.uploadComplete,
      
      // Submit
      userWantsToSubmit: this.userWantsToSubmit,
      isWaitingForUpload: this.userWantsToSubmit && !this.uploadComplete,
      isSubmitting: this.isSubmitting,
      canSave: this.uploadId !== null && !this.isSubmitting,
      
      // Result
      videoId: this.videoId,
      permlink: this.permlink,
      encodingStatus: this.encodingStatus,
      isPublished: this.encodingStatus?.video?.status === 'published',
      
      // Error
      error: this.error
    };
  }

  _notifyStateChange() {
    this.onStateChange(this.getState());
  }

  // =========================================
  // STEP 1: FILE SELECTION & UPLOAD START
  // =========================================

  /**
   * Call this when user selects a video file
   * Upload starts IMMEDIATELY
   * 
   * @param {File} videoFile - The video file from input
   * @returns {Promise<void>}
   */
  async onFileSelected(videoFile) {
    if (!videoFile) return;
    if (!this.owner) throw new Error('Owner not set. Call setOwner() first.');
    
    // Reset any previous state
    this.reset();
    this.videoFile = videoFile;
    
    // Detect video duration (async, but don't block)
    this._detectDuration(videoFile);
    
    try {
      // Step 1: Initialize upload on server
      const initResponse = await fetch(`${this.baseUrl}/api/upload/init`, {
        method: 'POST',
        headers: {
          'Authorization': this.apiToken ? `Bearer ${this.apiToken}` : undefined,
          'X-Hive-Username': this.owner,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          owner: this.owner,
          originalFilename: videoFile.name
        })
      });
      
      const result = await initResponse.json();
      
      if (!result.success) {
        throw new Error(result.error || 'Failed to initialize upload');
      }
      
      this.uploadId = result.data.upload_id;
      this._notifyStateChange();
      
      // Step 2: Start TUS upload immediately
      this._startTusUpload(videoFile, result.data);
      
    } catch (error) {
      this.error = error.message;
      this.onError(error);
      this._notifyStateChange();
      throw error;
    }
  }

  /**
   * Detect video duration from file
   */
  async _detectDuration(file) {
    return new Promise((resolve) => {
      const video = document.createElement('video');
      video.preload = 'metadata';
      
      video.onloadedmetadata = () => {
        this.videoDuration = video.duration || 60;
        window.URL.revokeObjectURL(video.src);
        resolve(this.videoDuration);
      };
      
      video.onerror = () => {
        this.videoDuration = 60; // Fallback
        window.URL.revokeObjectURL(video.src);
        resolve(60);
      };
      
      video.src = window.URL.createObjectURL(file);
    });
  }

  /**
   * Start TUS resumable upload
   */
  _startTusUpload(videoFile, initData) {
    this.tusUpload = new tus.Upload(videoFile, {
      endpoint: `${this.baseUrl}/files`,
      retryDelays: [0, 3000, 5000, 10000, 20000],
      metadata: {
        upload_id: initData.upload_id,
        owner: initData.owner,
        filename: videoFile.name,
        filetype: videoFile.type
      },
      
      onProgress: (bytesUploaded, bytesTotal) => {
        this.uploadProgress = (bytesUploaded / bytesTotal) * 100;
        this.onUploadProgress(this.uploadProgress, bytesUploaded, bytesTotal);
        this._notifyStateChange();
      },
      
      onSuccess: () => {
        console.log('✅ TUS upload complete');
        this.uploadComplete = true;
        this.uploadProgress = 100;
        this.onUploadComplete();
        this._notifyStateChange();
        
        // 🔑 KEY LOGIC: Check if user is waiting to submit
        this._checkAutoSubmit();
      },
      
      onError: (error) => {
        console.error('❌ TUS upload error:', error);
        this.error = 'Upload failed: ' + error.message;
        this.onError(error);
        this._notifyStateChange();
      }
    });
    
    // Start the upload
    this.tusUpload.start();
  }

  // =========================================
  // STEP 2: USER SAVES FORM
  // =========================================

  /**
   * Call this when user clicks "Save" button
   * Can be called BEFORE or AFTER upload completes
   * 
   * @param {Object} formData - The form data
   * @param {string} formData.title - Video title
   * @param {string} formData.description - Video description
   * @param {string[]} formData.tags - Array of tags
   * @param {string} formData.community - Community ID (optional)
   * @param {boolean} formData.declineRewards - Decline rewards flag
   * @param {File} formData.thumbnailFile - Thumbnail file (optional)
   */
  async onSaveClicked(formData) {
    if (!this.uploadId) {
      throw new Error('No upload in progress. Select a file first.');
    }
    
    if (this.isSubmitting) {
      console.warn('Already submitting, ignoring duplicate save click');
      return;
    }
    
    // Store form data
    this.formData = {
      title: formData.title,
      description: formData.description,
      tags: formData.tags || [],
      community: formData.community || null,
      declineRewards: formData.declineRewards || false,
      thumbnailFile: formData.thumbnailFile || null
    };
    
    // Mark that user wants to submit
    this.userWantsToSubmit = true;
    this._notifyStateChange();
    
    // Check if we can submit now
    this._checkAutoSubmit();
  }

  /**
   * Check if both conditions are met for auto-submit
   */
  _checkAutoSubmit() {
    if (this.uploadComplete && this.userWantsToSubmit && !this.isSubmitting) {
      console.log('🚀 Both conditions met - auto-submitting!');
      this._finalizeUpload();
    }
  }

  // =========================================
  // STEP 3: FINALIZE (AUTO-SUBMIT)
  // =========================================

  /**
   * Finalize the upload - creates video entry and starts encoding
   * Called automatically when both conditions are met
   */
  async _finalizeUpload() {
    if (this.isSubmitting) return;
    
    this.isSubmitting = true;
    this.onSubmitting();
    this._notifyStateChange();
    
    try {
      // Wait for duration detection if not ready
      if (!this.videoDuration) {
        await this._detectDuration(this.videoFile);
      }
      
      // Finalize the upload
      const response = await fetch(`${this.baseUrl}/api/upload/finalize`, {
        method: 'POST',
        headers: {
          'Authorization': this.apiToken ? `Bearer ${this.apiToken}` : undefined,
          'X-Hive-Username': this.owner,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          upload_id: this.uploadId,
          owner: this.owner,
          title: this.formData.title,
          description: this.formData.description,
          tags: this.formData.tags,
          community: this.formData.community,
          declineRewards: this.formData.declineRewards,
          duration: Math.round(this.videoDuration),
          size: this.videoFile.size,
          originalFilename: this.videoFile.name
        })
      });
      
      const result = await response.json();
      
      if (!result.success) {
        throw new Error(result.error || 'Failed to finalize upload');
      }
      
      this.videoId = result.data.video_id;
      this.permlink = result.data.permlink;
      
      console.log('✅ Video created:', this.videoId);
      this.onSubmitted(result.data);
      this._notifyStateChange();
      
      // Upload thumbnail if provided
      if (this.formData.thumbnailFile) {
        await this._uploadThumbnail(this.formData.thumbnailFile);
      }
      
      // Start polling for encoding status
      this._startEncodingPolling();
      
    } catch (error) {
      console.error('❌ Finalize error:', error);
      this.error = error.message;
      this.isSubmitting = false;
      this.onError(error);
      this._notifyStateChange();
      throw error;
    }
  }

  /**
   * Upload thumbnail
   */
  async _uploadThumbnail(thumbnailFile) {
    const formData = new FormData();
    formData.append('thumbnail', thumbnailFile);
    
    const response = await fetch(
      `${this.baseUrl}/api/upload/thumbnail/${this.videoId}`,
      {
        method: 'POST',
        headers: {
          'Authorization': this.apiToken ? `Bearer ${this.apiToken}` : undefined,
          'X-Hive-Username': this.owner
        },
        body: formData
      }
    );
    
    const result = await response.json();
    if (!result.success) {
      console.warn('Thumbnail upload failed:', result.error);
    }
  }

  // =========================================
  // STEP 4: ENCODING STATUS POLLING
  // =========================================

  /**
   * Poll encoding status until published
   */
  _startEncodingPolling() {
    const poll = async () => {
      try {
        const response = await fetch(
          `${this.baseUrl}/api/upload/video/${this.videoId}/status`,
          {
            headers: {
              'Authorization': this.apiToken ? `Bearer ${this.apiToken}` : undefined,
              'X-Hive-Username': this.owner
            }
          }
        );
        
        const result = await response.json();
        
        if (!result.success) {
          throw new Error(result.error);
        }
        
        const { video, job } = result.data;
        
        // Calculate display status
        this.encodingStatus = {
          video,
          job,
          label: this._getStatusLabel(video, job),
          progress: job?.progress?.pct || 0,
          isComplete: video.status === 'published' || video.status === 'publish_manual',
          isFailed: video.status === 'failed' || job?.status === 'failed'
        };
        
        this.onEncodingProgress(this.encodingStatus);
        this._notifyStateChange();
        
        // Check for completion
        if (this.encodingStatus.isComplete) {
          console.log('🎉 Video published!');
          this.onPublished(video);
          return; // Stop polling
        }
        
        // Check for failure
        if (this.encodingStatus.isFailed) {
          console.error('❌ Encoding failed');
          this.error = 'Encoding failed';
          this.onError(new Error('Encoding failed'));
          return; // Stop polling
        }
        
        // Continue polling
        setTimeout(poll, 5000);
        
      } catch (error) {
        console.error('Status poll error:', error);
        // Retry after delay
        setTimeout(poll, 5000);
      }
    };
    
    // Start polling
    poll();
  }

  /**
   * Get human-readable status label
   */
  _getStatusLabel(video, job) {
    if (video.status === 'published' || video.status === 'publish_manual') {
      return '🎉 Published to Hive!';
    }
    
    if (video.status === 'failed' || job?.status === 'failed') {
      return '❌ Encoding Failed';
    }
    
    if (job) {
      switch (job.status) {
        case 'queued':
          return '⏳ Queued for encoding...';
        case 'running':
          const downloadPct = job.progress?.download_pct || 0;
          const encodePct = job.progress?.pct || 0;
          if (downloadPct < 100) {
            return `📥 Downloading: ${Math.round(downloadPct)}%`;
          }
          return `🎬 Encoding: ${Math.round(encodePct)}%`;
        case 'complete':
          return '✅ Publishing to Hive...';
      }
    }
    
    if (video.status === 'uploaded') {
      return '⏳ Waiting for encoder...';
    }
    
    return '🔄 Processing...';
  }

  // =========================================
  // PUBLIC UTILITIES
  // =========================================

  /**
   * Set the owner (Hive username)
   */
  setOwner(owner) {
    this.owner = owner;
  }

  /**
   * Set API token (optional - can use X-Hive-Username instead)
   */
  setApiToken(token) {
    this.apiToken = token;
  }

  /**
   * Cancel current upload
   */
  cancelUpload() {
    if (this.tusUpload) {
      this.tusUpload.abort();
    }
    this.reset();
  }

  /**
   * Check if save button should be disabled
   */
  isSaveDisabled() {
    return !this.uploadId || this.isSubmitting;
  }

  /**
   * Get save button text based on state
   */
  getSaveButtonText() {
    if (!this.uploadId) {
      return 'Select a video first';
    }
    
    if (this.isSubmitting) {
      return 'Submitting...';
    }
    
    if (this.userWantsToSubmit && !this.uploadComplete) {
      return `Waiting for upload... ${Math.round(this.uploadProgress)}%`;
    }
    
    if (this.uploadComplete) {
      return 'Save & Publish';
    }
    
    return `Save (uploading ${Math.round(this.uploadProgress)}%)`;
  }
}

export default UploadFirstAutoSubmit;
```

---

## 🎨 UI Implementation Examples

### Vanilla JavaScript

```html
<!DOCTYPE html>
<html>
<head>
  <title>Upload Video</title>
  <style>
    .upload-form {
      max-width: 600px;
      margin: 0 auto;
      padding: 20px;
    }
    
    .progress-container {
      margin: 20px 0;
      display: none;
    }
    
    .progress-bar {
      height: 20px;
      background: #e0e0e0;
      border-radius: 10px;
      overflow: hidden;
    }
    
    .progress-fill {
      height: 100%;
      background: linear-gradient(90deg, #4CAF50, #8BC34A);
      transition: width 0.3s ease;
    }
    
    .waiting-overlay {
      background: rgba(0,0,0,0.8);
      color: white;
      padding: 40px;
      border-radius: 10px;
      text-align: center;
      margin: 20px 0;
    }
    
    .status-badge {
      display: inline-block;
      padding: 5px 15px;
      border-radius: 20px;
      font-size: 14px;
      margin: 10px 0;
    }
    
    .status-uploading { background: #2196F3; color: white; }
    .status-waiting { background: #FF9800; color: white; }
    .status-encoding { background: #9C27B0; color: white; }
    .status-complete { background: #4CAF50; color: white; }
    .status-error { background: #f44336; color: white; }
    
    button:disabled {
      opacity: 0.6;
      cursor: not-allowed;
    }
    
    .hidden { display: none !important; }
  </style>
</head>
<body>
  <div class="upload-form">
    <h1>Upload Video</h1>
    
    <!-- File Selection -->
    <div class="form-group">
      <label>Video File</label>
      <input type="file" id="video-input" accept="video/*">
    </div>
    
    <!-- Upload Progress -->
    <div id="progress-container" class="progress-container">
      <div class="progress-bar">
        <div id="progress-fill" class="progress-fill" style="width: 0%"></div>
      </div>
      <span id="progress-text">0%</span>
      <span id="status-badge" class="status-badge status-uploading">Uploading</span>
    </div>
    
    <!-- Form Fields -->
    <div class="form-group">
      <label>Title</label>
      <input type="text" id="title" placeholder="Video title" required>
    </div>
    
    <div class="form-group">
      <label>Description</label>
      <textarea id="description" rows="4" placeholder="Describe your video"></textarea>
    </div>
    
    <div class="form-group">
      <label>Tags (comma-separated)</label>
      <input type="text" id="tags" placeholder="tag1, tag2, tag3">
    </div>
    
    <div class="form-group">
      <label>Thumbnail (optional)</label>
      <input type="file" id="thumbnail-input" accept="image/*">
    </div>
    
    <!-- Waiting Overlay (shown when user saves but upload not complete) -->
    <div id="waiting-overlay" class="waiting-overlay hidden">
      <h3>✅ Your post is saved!</h3>
      <p>Waiting for upload to complete...</p>
      <div class="progress-bar">
        <div id="waiting-progress" class="progress-fill" style="width: 0%"></div>
      </div>
      <p id="waiting-text">0% uploaded</p>
    </div>
    
    <!-- Encoding Status (shown after submit) -->
    <div id="encoding-status" class="hidden">
      <h3>Processing Video</h3>
      <p id="encoding-label">⏳ Starting...</p>
      <div class="progress-bar">
        <div id="encoding-progress" class="progress-fill" style="width: 0%"></div>
      </div>
    </div>
    
    <!-- Save Button -->
    <button id="save-btn" disabled>Select a video first</button>
    
    <!-- Success Message -->
    <div id="success-message" class="hidden">
      <h2>🎉 Video Published!</h2>
      <p>Your video is now live on 3Speak!</p>
      <a id="video-link" href="#" target="_blank">View Video</a>
    </div>
  </div>

  <script src="https://cdn.jsdelivr.net/npm/tus-js-client@latest/dist/tus.min.js"></script>
  <script type="module">
    // Import the class (or include it inline)
    // import UploadFirstAutoSubmit from './upload-first-auto-submit.js';
    
    // For this example, assume the class is available globally
    
    const uploader = new UploadFirstAutoSubmit({
      baseUrl: 'https://video.3speak.tv',
      owner: 'coolmole', // Set from Keychain login
      
      onUploadProgress: (progress) => {
        document.getElementById('progress-container').style.display = 'block';
        document.getElementById('progress-fill').style.width = `${progress}%`;
        document.getElementById('progress-text').textContent = `${Math.round(progress)}%`;
      },
      
      onUploadComplete: () => {
        document.getElementById('status-badge').textContent = 'Upload Complete';
        document.getElementById('status-badge').className = 'status-badge status-complete';
      },
      
      onSubmitting: () => {
        document.getElementById('waiting-overlay').classList.add('hidden');
        document.getElementById('encoding-status').classList.remove('hidden');
      },
      
      onEncodingProgress: (status) => {
        document.getElementById('encoding-label').textContent = status.label;
        document.getElementById('encoding-progress').style.width = `${status.progress}%`;
      },
      
      onPublished: (video) => {
        document.getElementById('encoding-status').classList.add('hidden');
        document.getElementById('success-message').classList.remove('hidden');
        document.getElementById('video-link').href = `https://3speak.tv/@${video.owner}/${video.permlink}`;
      },
      
      onStateChange: (state) => {
        const btn = document.getElementById('save-btn');
        btn.disabled = state.isSubmitting || !state.uploadId;
        btn.textContent = uploader.getSaveButtonText();
        
        // Show waiting overlay if user saved but upload not complete
        if (state.isWaitingForUpload) {
          document.getElementById('waiting-overlay').classList.remove('hidden');
          document.getElementById('waiting-progress').style.width = `${state.uploadProgress}%`;
          document.getElementById('waiting-text').textContent = `${Math.round(state.uploadProgress)}% uploaded`;
        }
      },
      
      onError: (error) => {
        alert('Error: ' + error.message);
      }
    });
    
    // File selection handler
    document.getElementById('video-input').addEventListener('change', async (e) => {
      const file = e.target.files[0];
      if (file) {
        try {
          await uploader.onFileSelected(file);
        } catch (error) {
          console.error('File selection error:', error);
        }
      }
    });
    
    // Save button handler
    document.getElementById('save-btn').addEventListener('click', async () => {
      const formData = {
        title: document.getElementById('title').value,
        description: document.getElementById('description').value,
        tags: document.getElementById('tags').value.split(',').map(t => t.trim()).filter(t => t),
        thumbnailFile: document.getElementById('thumbnail-input').files[0] || null
      };
      
      if (!formData.title) {
        alert('Please enter a title');
        return;
      }
      
      try {
        await uploader.onSaveClicked(formData);
      } catch (error) {
        console.error('Save error:', error);
      }
    });
  </script>
</body>
</html>
```

### React Implementation

```jsx
import React, { useState, useCallback } from 'react';
import UploadFirstAutoSubmit from './upload-first-auto-submit';

function VideoUploadForm({ username }) {
  const [uploader] = useState(() => new UploadFirstAutoSubmit({
    baseUrl: 'https://video.3speak.tv',
    owner: username
  }));
  
  const [state, setState] = useState(uploader.getState());
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [tags, setTags] = useState('');
  const [thumbnail, setThumbnail] = useState(null);
  
  // Subscribe to state changes
  React.useEffect(() => {
    uploader.onStateChange = setState;
    uploader.onPublished = (video) => {
      window.location.href = `/@${video.owner}/${video.permlink}`;
    };
    uploader.onError = (error) => {
      alert('Error: ' + error.message);
    };
  }, [uploader]);
  
  const handleFileSelect = useCallback(async (e) => {
    const file = e.target.files[0];
    if (file) {
      await uploader.onFileSelected(file);
    }
  }, [uploader]);
  
  const handleSave = useCallback(async () => {
    await uploader.onSaveClicked({
      title,
      description,
      tags: tags.split(',').map(t => t.trim()).filter(t => t),
      thumbnailFile: thumbnail
    });
  }, [uploader, title, description, tags, thumbnail]);
  
  return (
    <div className="upload-form">
      {/* File Input */}
      <input
        type="file"
        accept="video/*"
        onChange={handleFileSelect}
        disabled={state.isUploading || state.isSubmitting}
      />
      
      {/* Upload Progress */}
      {state.isUploading && (
        <div className="progress">
          <div 
            className="progress-bar" 
            style={{ width: `${state.uploadProgress}%` }}
          />
          <span>{Math.round(state.uploadProgress)}%</span>
        </div>
      )}
      
      {/* Form Fields */}
      <input
        type="text"
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        placeholder="Video title"
        disabled={state.isSubmitting}
      />
      
      <textarea
        value={description}
        onChange={(e) => setDescription(e.target.value)}
        placeholder="Description"
        disabled={state.isSubmitting}
      />
      
      <input
        type="text"
        value={tags}
        onChange={(e) => setTags(e.target.value)}
        placeholder="Tags (comma-separated)"
        disabled={state.isSubmitting}
      />
      
      <input
        type="file"
        accept="image/*"
        onChange={(e) => setThumbnail(e.target.files[0])}
        disabled={state.isSubmitting}
      />
      
      {/* Waiting Overlay */}
      {state.isWaitingForUpload && (
        <div className="waiting-overlay">
          <h3>✅ Post saved!</h3>
          <p>Waiting for upload: {Math.round(state.uploadProgress)}%</p>
        </div>
      )}
      
      {/* Encoding Status */}
      {state.encodingStatus && (
        <div className="encoding-status">
          <p>{state.encodingStatus.label}</p>
          <div className="progress-bar" style={{ width: `${state.encodingStatus.progress}%` }} />
        </div>
      )}
      
      {/* Save Button */}
      <button
        onClick={handleSave}
        disabled={!state.canSave || !title}
      >
        {uploader.getSaveButtonText()}
      </button>
    </div>
  );
}

export default VideoUploadForm;
```

---

## ⚠️ Things to Consider

### 1. User Leaves Page Warning

```javascript
// Warn user if they try to leave during upload
window.addEventListener('beforeunload', (e) => {
  if (uploader.uploadId && !uploader.uploadComplete) {
    e.preventDefault();
    e.returnValue = 'Upload in progress. Are you sure you want to leave?';
    return e.returnValue;
  }
});
```

### 2. Network Disconnection Handling

```javascript
// TUS handles retries automatically, but you can add extra handling
window.addEventListener('online', () => {
  if (uploader.tusUpload && !uploader.uploadComplete) {
    console.log('Network restored - resuming upload');
    uploader.tusUpload.start(); // Resume
  }
});

window.addEventListener('offline', () => {
  console.log('Network lost - upload will resume when connection restored');
});
```

### 3. Form Validation Before Save

```javascript
function validateForm() {
  const errors = [];
  
  if (!title.trim()) errors.push('Title is required');
  if (title.length < 3) errors.push('Title must be at least 3 characters');
  if (title.length > 250) errors.push('Title must be less than 250 characters');
  if (description.length > 50000) errors.push('Description too long');
  if (tags.length > 25) errors.push('Maximum 25 tags allowed');
  
  return errors;
}

// In save handler
const errors = validateForm();
if (errors.length > 0) {
  alert(errors.join('\n'));
  return;
}
```

### 4. Duplicate Submit Prevention

The class already handles this with `isSubmitting` flag, but also consider:

```javascript
// Debounce save button clicks
let saveTimeout = null;
function handleSaveClick() {
  if (saveTimeout) return;
  saveTimeout = setTimeout(() => {
    saveTimeout = null;
  }, 1000);
  
  uploader.onSaveClicked(formData);
}
```

### 5. Mobile Considerations

```javascript
// On mobile, large files may cause memory issues
// Consider warning for files > 1GB
if (videoFile.size > 1024 * 1024 * 1024) {
  const confirm = window.confirm(
    'This is a large file. Upload may take a while. Continue?'
  );
  if (!confirm) return;
}
```

### 6. Session Persistence (Advanced)

```javascript
// Save upload state to localStorage for recovery
function saveUploadState() {
  if (uploader.uploadId) {
    localStorage.setItem('pendingUpload', JSON.stringify({
      uploadId: uploader.uploadId,
      formData: uploader.formData,
      timestamp: Date.now()
    }));
  }
}

// Recover on page load
function recoverUpload() {
  const saved = localStorage.getItem('pendingUpload');
  if (saved) {
    const data = JSON.parse(saved);
    // Check if less than 6 hours old (temp uploads expire)
    if (Date.now() - data.timestamp < 6 * 60 * 60 * 1000) {
      // Could potentially resume...
      console.log('Found pending upload:', data);
    }
    localStorage.removeItem('pendingUpload');
  }
}
```

---

## 📊 State Flow Summary

```
┌────────────────────────────────────────────────────────────────┐
│                         USER ACTIONS                           │
├────────────────────────────────────────────────────────────────┤
│                                                                │
│  1. SELECT FILE ──────────────────────────────────────────►    │
│     • onFileSelected() called                                  │
│     • POST /api/upload/init                                    │
│     • TUS upload starts                                        │
│     • uploadId set, uploadProgress updates                     │
│                                                                │
│  2. FILL FORM (while upload happens) ─────────────────────►    │
│     • User types title, description, tags                      │
│     • Upload continues in background                           │
│     • Progress bar shows upload %                              │
│                                                                │
│  3. CLICK SAVE ───────────────────────────────────────────►    │
│     • onSaveClicked() called                                   │
│     • formData stored                                          │
│     • userWantsToSubmit = true                                 │
│     • IF uploadComplete → submit immediately                   │
│     • IF !uploadComplete → show waiting, auto-submit later     │
│                                                                │
│  4. AUTO-SUBMIT (when both conditions met) ───────────────►    │
│     • POST /api/upload/finalize                                │
│     • videoId returned                                         │
│     • Thumbnail uploaded if provided                           │
│     • Start encoding polling                                   │
│                                                                │
│  5. ENCODING ─────────────────────────────────────────────►    │
│     • Poll GET /api/upload/video/:id/status                    │
│     • Show encoding progress                                   │
│     • Wait for video.status === 'published'                    │
│                                                                │
│  6. PUBLISHED! 🎉 ────────────────────────────────────────►    │
│     • onPublished() callback                                   │
│     • Redirect to video page or show success                   │
│                                                                │
└────────────────────────────────────────────────────────────────┘
```

---

## 🎯 Quick Reference

### API Endpoints Used

| Endpoint | When | Purpose |
|----------|------|---------|
| `POST /api/upload/init` | File selected | Get upload_id for TUS |
| `TUS /files` | Immediately after | Upload video file |
| `POST /api/upload/finalize` | After save + upload done | Create video entry |
| `POST /api/upload/thumbnail/:id` | After finalize | Upload thumbnail |
| `GET /api/upload/video/:id/status` | Poll every 5s | Get encoding status |

### Key State Variables

| Variable | Type | Purpose |
|----------|------|---------|
| `uploadId` | string | Identifies the upload session |
| `uploadComplete` | boolean | TUS upload finished |
| `uploadProgress` | number | 0-100 upload percentage |
| `userWantsToSubmit` | boolean | User clicked Save |
| `formData` | object | Saved form data |
| `videoId` | string | Video ID after finalize |
| `isSubmitting` | boolean | Finalize in progress |

### Auto-Submit Condition

```javascript
if (uploadComplete && userWantsToSubmit && !isSubmitting) {
  // Submit now!
}
```

---

## ✅ Checklist

- [ ] Import `tus-js-client`
- [ ] Initialize uploader with `owner` (Hive username)
- [ ] Connect file input to `onFileSelected()`
- [ ] Show upload progress bar
- [ ] Build form (title, description, tags, thumbnail)
- [ ] Connect Save button to `onSaveClicked()`
- [ ] Show "waiting" UI when save clicked but upload not done
- [ ] Show encoding progress after submit
- [ ] Handle `onPublished` - redirect or show success
- [ ] Handle `onError` - show error message
- [ ] Add `beforeunload` warning during upload
- [ ] Validate form before allowing save
- [ ] Test with slow network (Chrome DevTools throttling)
- [ ] Test save before upload complete
- [ ] Test save after upload complete
- [ ] Test network disconnection/reconnection

---

**Built for the 3Speak Upload Service by [@meno](https://peakd.com/@meno)**
