# 3Speak Upload API - Frontend Integration Guide

**For:** 3Speak frontend developers  
**Service URL:** `https://video.3speak.tv`  
**Hosted by:** [@meno](https://peakd.com/@meno)

---

## 🎯 What This API Does

I'm hosting a production-ready upload service that handles **everything**:

✅ Video database entries  
✅ IPFS uploads  
✅ Encoding job creation  
✅ Hive blockchain publishing  
✅ Real-time progress tracking  

**You just call my endpoints. I handle all the complexity.**

---

## 🚀 Quick Start

### 1. Get API Token

Contact @meno to get your `UPLOAD_SECRET_TOKEN`

### 2. Install TUS Client

```bash
npm install tus-js-client
```

### 3. Use the Integration Code

Copy the complete example below into your project.

---

## 📡 API Endpoints

**Base URL:** `https://video.3speak.tv`

### Traditional Flow (Current Method)

| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/api/upload/prepare` | POST | Create video entry |
| `/api/upload/thumbnail/:video_id` | POST | Upload thumbnail (optional) |
| `/files` | TUS | Upload video (resumable) |
| `/api/upload/video/:id/status` | GET | Get encoding status |

### Upload-First Flow (NEW - Recommended)

| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/api/upload/init` | POST | Initialize upload, get upload_id |
| `/files` | TUS | Upload video immediately (resumable) |
| `/api/upload/finalize` | POST | Create video entry after upload |
| `/api/upload/video/:id/status` | GET | Get encoding status |

**Why use Upload-First?**
- ✅ Better UX: Upload starts immediately when file selected
- ✅ User can fill form while video uploads
- ✅ Submit button enabled only when upload completes (safety)
- ✅ No waiting after clicking "Submit"

### Progress Tracking

| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/api/upload/in-progress` | GET | Get user's videos currently encoding |

**Use Case:** User uploads video, navigates to homepage. Show "Videos being processed" banner with encoding progress.

**Returns:** List of videos with `job_id` for each, so frontend can poll gateway for real-time encoding progress.

---

## 💻 Complete Integration Code

```javascript
import * as tus from 'tus-js-client';

class ThreeSpeakUploader {
  constructor(apiToken) {
    this.apiToken = apiToken;
    this.baseUrl = 'https://video.3speak.tv';
  }

  /**
   * STEP 1: Prepare Upload
   * Creates video entry in database
   */
  async prepareUpload(videoData) {
    const response = await fetch(`${this.baseUrl}/api/upload/prepare`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${this.apiToken}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        owner: videoData.owner,              // Hive username
        title: videoData.title,              // Video title
        description: videoData.description,  // Description (max 50,000 chars)
        tags: videoData.tags,                // Array: ["tag1", "tag2"]
        size: videoData.file.size,           // File size in bytes
        duration: videoData.duration,        // Duration in seconds
        originalFilename: videoData.file.name,
        community: videoData.community,      // Optional: "hive-181335"
        declineRewards: videoData.declineRewards || false
      })
    });

    const result = await response.json();
    if (!result.success) throw new Error(result.error);
    return result.data; // { video_id, permlink, metadata }
  }

  /**
   * STEP 2: Upload Thumbnail (Optional)
   */
  async uploadThumbnail(videoId, thumbnailFile) {
    const formData = new FormData();
    formData.append('thumbnail', thumbnailFile);

    const response = await fetch(
      `${this.baseUrl}/api/upload/thumbnail/${videoId}`,
      {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${this.apiToken}` },
        body: formData
      }
    );

    const result = await response.json();
    if (!result.success) throw new Error(result.error);
    return result.data; // { thumbnail: "ipfs://Qm...", ipfs_hash: "Qm..." }
  }

  /**
   * STEP 3: Upload Video via TUS
   * Resumable uploads with progress
   */
  uploadVideo(videoFile, metadata, callbacks = {}) {
    return new Promise((resolve, reject) => {
      const upload = new tus.Upload(videoFile, {
        endpoint: `${this.baseUrl}/files`,
        retryDelays: [0, 3000, 5000, 10000, 20000],
        metadata: {
          video_id: metadata.video_id,
          owner: metadata.owner,
          permlink: metadata.permlink,
          filename: videoFile.name,
          filetype: videoFile.type
        },
        onProgress: (bytesUploaded, bytesTotal) => {
          const percentage = ((bytesUploaded / bytesTotal) * 100).toFixed(2);
          if (callbacks.onProgress) {
            callbacks.onProgress(percentage, bytesUploaded, bytesTotal);
          }
        },
        onSuccess: () => {
          if (callbacks.onSuccess) callbacks.onSuccess();
          resolve();
        },
        onError: (error) => {
          if (callbacks.onError) callbacks.onError(error);
          reject(error);
        }
      });

      upload.start();
    });
  }

  /**
   * STEP 4: Get Encoding Status
   */
  async getStatus(videoId) {
    const response = await fetch(
      `${this.baseUrl}/api/upload/video/${videoId}/status`,
      { headers: { 'Authorization': `Bearer ${this.apiToken}` } }
    );

    const result = await response.json();
    if (!result.success) throw new Error(result.error);
    return result.data; // { video, job }
  }

  /**
   * Poll status until published or failed
   * Returns { video, job } data with real-time progress
   */
  pollUntilPublished(videoId, onUpdate, intervalMs = 5000) {
    const interval = setInterval(async () => {
      try {
        const status = await this.getStatus(videoId);
        const { video, job } = status;
        
        // Calculate display info
        const progress = job?.progress?.pct || 0;
        const statusLabel = this.getStatusLabel(video, job);
        
        if (onUpdate) {
          onUpdate({
            video,
            job,
            progress,
            statusLabel,
            // Video is ONLY complete when video.status = "published"
            isComplete: video.status === 'published' || video.status === 'publish_manual',
            isFailed: video.status === 'failed' || video.status === 'encoding_failed' || job?.status === 'failed'
          });
        }

        // ONLY stop when video is published (final state)
        // Note: job.status === 'complete' means encoding done, but still need to wait for publish
        if (video.status === 'published' || video.status === 'publish_manual') {
          console.log('✅ Video published - stopping poll');
          clearInterval(interval);
        }
        
        // Stop on failure
        if (video.status === 'failed' || video.status === 'encoding_failed' || job?.status === 'failed') {
          console.log('❌ Failed - stopping poll');
          clearInterval(interval);
        }
      } catch (error) {
        console.error('Poll error:', error);
        clearInterval(interval);
      }
    }, intervalMs);

    return interval;
  }
  
  /**
   * Get human-readable status label
   * 
   * STATUS FLOW:
   * Phase 1: video.status = "uploaded" → waiting for job to be created
   * Phase 2: video.status = "encoding_ipfs" → track job.status:
   *          - job.status = "queued" → waiting in queue
   *          - job.status = "running" → show job.progress.pct
   *          - job.status = "complete" → encoding done, wait for publish
   * Phase 3: video.status = "published" → DONE!
   */
  getStatusLabel(video, job) {
    // PHASE 3: Final state - video is published
    if (video.status === 'published' || video.status === 'publish_manual') {
      return '🎉 Published to Hive!';
    }
    
    // Check for failures
    if (video.status === 'failed' || video.status === 'encoding_failed' || job?.status === 'failed') {
      return '❌ Encoding Failed';
    }
    
    // PHASE 1: Waiting for job creation
    if (video.status === 'uploaded') {
      return '⏳ Waiting for encoding...';
    }
    
    // PHASE 2: Job exists - track job status
    if (job) {
      switch (job.status) {
        case 'queued':
          return '⏳ Queued for encoding...';
        case 'running':
          const pct = Math.round(job.progress?.pct || 0);
          return `🔄 Encoding: ${pct}%`;
        case 'complete':
          return '✅ Encoding complete! Publishing...';
      }
    }
    
    // Fallback for encoding states without job info
    if (video.status === 'encoding_ipfs' || video.status === 'encoding_preparing' || 
        video.status === 'encoding_progress') {
      return '🔄 Processing...';
    }
    
    return video.status;
  }
}

// =====================================
// USAGE EXAMPLE
// =====================================

async function uploadVideo(videoFile, thumbnailFile, metadata) {
  const uploader = new ThreeSpeakUploader('YOUR_API_TOKEN');

  try {
    // Get video duration
    const duration = await getVideoDuration(videoFile);
    
    // Step 1: Prepare
    console.log('Creating video entry...');
    const prepared = await uploader.prepareUpload({
      owner: metadata.owner,
      title: metadata.title,
      description: metadata.description,
      tags: metadata.tags,
      file: videoFile,
      duration: Math.round(duration),
      community: metadata.community,
      declineRewards: metadata.declineRewards
    });
    
    console.log('✅ Video ID:', prepared.video_id);
    console.log('✅ Permlink:', prepared.permlink);

    // Step 2: Upload thumbnail (optional)
    if (thumbnailFile) {
      console.log('Uploading thumbnail...');
      const thumb = await uploader.uploadThumbnail(
        prepared.video_id,
        thumbnailFile
      );
      console.log('✅ Thumbnail:', thumb.thumbnail);
    }

    // Step 3: Upload video
    console.log('Uploading video...');
    await uploader.uploadVideo(
      videoFile,
      prepared.metadata,
      {
        onProgress: (pct, uploaded, total) => {
          updateProgressBar(pct);
          console.log(`Progress: ${pct}%`);
        },
        onSuccess: () => {
          console.log('✅ Upload complete!');
        }
      }
    );

    // Step 4: Monitor encoding
    console.log('Monitoring encoding...');
    uploader.pollUntilPublished(prepared.video_id, (status) => {
      // Update UI with status
      console.log('Status:', status.statusLabel);
      console.log('Progress:', Math.round(status.progress), '%');
      
      // Update progress bar
      updateProgressBar(status.progress);
      updateStatusText(status.statusLabel);
      
      if (status.isComplete) {
        console.log('🎉 Encoding complete!');
        console.log('IPFS:', status.video.filename);
        // Redirect to video page or show success
        window.location.href = `/@${metadata.owner}/${prepared.permlink}`;
      }
      
      if (status.isFailed) {
        console.error('❌ Encoding failed');
        alert('Video encoding failed. Please try again.');
      }
    });

  } catch (error) {
    console.error('❌ Upload failed:', error);
    alert('Upload failed: ' + error.message);
  }
}

// Helper: Get video duration from file
function getVideoDuration(file) {
  return new Promise((resolve) => {
    const video = document.createElement('video');
    video.preload = 'metadata';
    video.onloadedmetadata = () => {
      window.URL.revokeObjectURL(video.src);
      resolve(video.duration || 60);
    };
    video.onerror = () => {
      window.URL.revokeObjectURL(video.src);
      resolve(60); // Fallback
    };
    video.src = window.URL.createObjectURL(file);
  });
}

function updateProgressBar(percentage) {
  const bar = document.getElementById('progress-bar');
  if (bar) {
    bar.style.width = percentage + '%';
    bar.textContent = percentage + '%';
  }
}
```

---

## 📋 API Reference

### POST /api/upload/prepare

**Request:**
```http
POST /api/upload/prepare
Authorization: Bearer YOUR_TOKEN
Content-Type: application/json

{
  "owner": "coolmole",
  "title": "My Video",
  "description": "Description here",
  "tags": ["test", "video"],
  "size": 123456789,
  "duration": 180,
  "originalFilename": "video.mp4",
  "community": "hive-181335",  // String OR object with 'name' property
  "declineRewards": false
}
```

**Note:** The `community` field accepts:
- **String:** `"hive-181335"` (community name)
- **Object:** `{ name: "hive-181335", title: "Threespeak", ... }` (name auto-extracted)

**Response:**
```json
{
  "success": true,
  "data": {
    "video_id": "507f1f77bcf86cd799439011",
    "permlink": "abc123def",
    "owner": "coolmole",
    "metadata": {
      "video_id": "507f1f77bcf86cd799439011",
      "owner": "coolmole",
      "permlink": "abc123def",
      "filename": "video.mp4",
      "filetype": "video/mp4"
    }
  }
}
```

### POST /api/upload/thumbnail/:video_id

**Request:**
```http
POST /api/upload/thumbnail/507f1f77bcf86cd799439011
Authorization: Bearer YOUR_TOKEN
Content-Type: multipart/form-data

thumbnail: [file]
```

**Response:**
```json
{
  "success": true,
  "data": {
    "video_id": "507f1f77bcf86cd799439011",
    "thumbnail": "ipfs://QmXXX...",
    "thumbnail_url": "ipfs://QmXXX...",
    "ipfs_hash": "QmXXX..."
  }
}
```

### TUS /files

Uses TUS resumable upload protocol.

**Endpoint:** `https://video.3speak.tv/files`

**Required Metadata:**
- `video_id` - From prepare response
- `owner` - Hive username
- `permlink` - From prepare response
- `filename` - Original filename
- `filetype` - MIME type (e.g., "video/mp4")

See code example above for TUS integration.

### GET /api/upload/video/:id/status

**Request:**
```http
GET /api/upload/video/507f1f77bcf86cd799439011/status
Authorization: Bearer YOUR_TOKEN
```

**Response:**
```json
{
  "success": true,
  "data": {
    "video": {
      "_id": "507f1f77bcf86cd799439011",
      "owner": "coolmole",
      "permlink": "abc123def",
      "status": "encoding_ipfs",
      "filename": "ipfs://QmXXX...",
      "thumbnail": "ipfs://QmYYY...",
      "encodingProgress": 45,
      "duration": 180
    },
    "job": {
      "id": "uuid-here",
      "status": "running",
      "progress": {
        "pct": 45,
        "download_pct": 100
      }
    }
  }
}
```

### GET /api/upload/in-progress

**Purpose:** Get all info about user's videos currently being processed - **ONE call, everything you need!**

**🚀 This endpoint returns:**
- Video info (title, thumbnail, permlink)
- Job status and progress
- Display-ready labels with emojis
- Summary statistics
- Recommended poll interval

**Use Case:**
```javascript
// On homepage load - this is ALL you need!
const response = await fetch('/api/upload/in-progress', {
  headers: { 'X-Hive-Username': 'coolmole' }
});

const { data } = await response.json();

if (data.count > 0) {
  // Show banner - everything is in the response!
  showBanner(data.message); // "2 videos being processed"
  showOverallProgress(data.overall_progress); // 45
  
  data.videos.forEach(video => {
    // Use display-ready fields directly!
    showProgressCard({
      title: video.title,
      thumbnail: video.thumbnail,
      label: video.status_label,      // "🎬 Encoding: 68%"
      progress: video.progress_percent, // 70.5
      isComplete: video.is_complete,
      isFailed: video.is_failed
    });
  });
}

// Poll this same endpoint for updates
setInterval(() => checkInProgressVideos(), 5000);
```

**Request:**
```http
GET /api/upload/in-progress
X-Hive-Username: coolmole
```

**Response (videos in progress):**
```json
{
  "success": true,
  "data": {
    "videos": [
      {
        "video_id": "507f1f77bcf86cd799439011",
        "owner": "coolmole",
        "permlink": "abc123de",
        "title": "My Awesome Video",
        "thumbnail": "ipfs://QmXxx...",
        "created": "2025-12-01T14:00:00.000Z",
        "elapsed_minutes": 5,
        
        "video_status": "encoding_ipfs",
        "job_id": "uuid-job-123",
        "job_status": "running",
        "job_progress": { "pct": 67.5, "download_pct": 100 },
        
        "display": {
          "phase": 2,
          "label": "🎬 Encoding: 68%",
          "shortLabel": "Encoding",
          "progress": 70.5,
          "isComplete": false,
          "isFailed": false
        },
        
        "progress_percent": 70.5,
        "status_label": "🎬 Encoding: 68%",
        "status_short": "Encoding",
        "is_complete": false,
        "is_failed": false
      }
    ],
    "count": 1,
    "summary": { "queued": 0, "encoding": 1, "finishing": 0, "failed": 0 },
    "overall_progress": 71,
    "message": "1 video being processed",
    "poll_interval_ms": 5000
  }
}
```

**Response (no videos in progress):**
```json
{
  "success": true,
  "data": {
    "videos": [],
    "count": 0,
    "summary": { "queued": 0, "encoding": 0, "finishing": 0 }
  }
}
```

**Key Response Fields:**

| Field | Description |
|-------|-------------|
| `status_label` | Display-ready label like "🎬 Encoding: 68%" |
| `progress_percent` | Overall progress 0-100 |
| `is_complete` | True when published |
| `is_failed` | True on failure |
| `summary` | Count by status (queued/encoding/finishing/failed) |
| `overall_progress` | Average progress of all videos |
| `poll_interval_ms` | Recommended polling interval (5000ms) |

**Implementation Tips:**
1. Call on homepage/dashboard load
2. Use `status_label` directly in UI - no parsing needed!
3. Use `progress_percent` for progress bars
4. Poll this same endpoint every 5 seconds
5. Stop polling when `count === 0`

📖 **Full documentation:** See [IN_PROGRESS_TRACKING.md](IN_PROGRESS_TRACKING.md)

---

## 🔄 Upload Flow

```
1. POST /api/upload/prepare
   ↓
2. POST /api/upload/thumbnail/:video_id (optional)
   ↓
3. TUS upload to /files
   ↓
4. GET /api/upload/video/:id/status (poll every 5 sec)
   ↓
5. status: uploaded → encoding_ipfs → published ✅
```

**Video Status Values:**
- `uploaded` - Video uploaded to IPFS, encoding job created
- `encoding_ipfs` - Encoder is processing
- `encoding_preparing` - Encoder preparing job
- `encoding_progress` - Actively encoding
- `encoding_completed` - Encoding done, ready to publish
- `published` - Live on Hive blockchain! ✅
- `failed` - Something went wrong

**Job Status Values:**
The job object has its own status that tracks encoding progress more granularly:
- `queued` - Waiting for encoder to pick up
- `running` - Encoder is actively processing
- `complete` - Encoding finished successfully
- `failed` - Encoding failed

---

## 📊 Status Polling - The 3-Phase Flow

Understanding the status flow is critical for a good user experience:

### Phase 1: Waiting for Job Creation
After upload completes, `video.status = "uploaded"`. The system creates an encoding job.

### Phase 2: Encoding (Track Job Status)
Once encoding starts, `video.status = "encoding_ipfs"`. Now track `job.status`:
- `queued` → Waiting in encoder queue
- `running` → Show `job.progress.pct` (0-100%)
- `complete` → Encoding done, wait for Phase 3

### Phase 3: Publishing to Hive
After `job.status = "complete"`, wait for `video.status = "published"`.
**IMPORTANT:** `job.status === 'complete'` does NOT mean the video is ready. Keep polling until `video.status === 'published'`.

```
Timeline:
video.status: uploaded → encoding_ipfs → encoding_ipfs → encoding_ipfs → published ✅
job.status:   null     → queued       → running       → complete       → complete
job.pct:      0        → 0            → 45%           → 100%           → 100%
```

The `/api/upload/video/:id/status` endpoint returns both `video` and `job` objects. **Use BOTH to determine the true status:**

```javascript
/**
 * Get human-readable status - follows the 3-phase flow
 */
function getStatusLabel(video, job) {
  // PHASE 3: Final state
  if (video.status === 'published' || video.status === 'publish_manual') {
    return '🎉 Published to Hive!';
  }
  
  // Check for failures
  if (video.status === 'failed' || video.status === 'encoding_failed' || job?.status === 'failed') {
    return '❌ Encoding Failed';
  }
  
  // PHASE 1: Waiting for job
  if (video.status === 'uploaded') {
    return '⏳ Waiting for encoding to start...';
  }
  
  // PHASE 2: Track job status
  if (job) {
    switch (job.status) {
      case 'queued':
        return '⏳ Queued for encoding...';
      case 'running':
        const progress = job.progress?.pct || 0;
        return `🔄 Encoding: ${Math.round(progress)}%`;
      case 'complete':
        // Job done but video not published yet
        return '✅ Encoding complete! Publishing to Hive...';
    }
  }
  
  // Fallback
  return `Processing (${video.status})...`;
}

/**
 * Poll status with progress updates
 * IMPORTANT: Only stop when video.status === 'published'
 */
async function pollVideoStatus(videoId, onUpdate) {
  const maxAttempts = 120; // 10 minutes at 5 second intervals
  let attempts = 0;
  let lastProgress = -1;
  
  while (attempts < maxAttempts) {
    attempts++;
    
    try {
      const response = await fetch(`/api/upload/video/${videoId}/status`, {
        headers: { 'Authorization': `Bearer ${apiToken}` }
      });
      
      const { data } = await response.json();
      const { video, job } = data;
      
      // Get current progress
      const currentProgress = job?.progress?.pct || 0;
      
      // Call update callback with status info
      onUpdate({
        label: getStatusLabel(video, job),
        video,
        job,
        progress: currentProgress,
        // IMPORTANT: Only truly complete when video.status === 'published'
        isComplete: video.status === 'published' || video.status === 'publish_manual',
        isFailed: video.status === 'failed' || video.status === 'encoding_failed' || job?.status === 'failed'
      });
      
      // ONLY stop when video is published (the final state)
      // Note: job.status === 'complete' means encoding done, but must wait for publish!
      if (video.status === 'published' || video.status === 'publish_manual') {
        console.log('✅ Video published to Hive!');
        return { success: true, video, job };
      }
      
      // Stop on failure
      if (video.status === 'failed' || video.status === 'encoding_failed' || job?.status === 'failed') {
        console.error('❌ Encoding failed');
        return { success: false, video, job };
      }
      
      lastProgress = currentProgress;
      
    } catch (error) {
      console.error('Status poll error:', error);
    }
    
    // Wait 5 seconds before next poll
    await new Promise(resolve => setTimeout(resolve, 5000));
  }
  
  console.warn('Status polling timeout');
  return { success: false, timeout: true };
}

// Usage example:
pollVideoStatus(videoId, ({ label, progress, isComplete, video }) => {
  document.getElementById('status-text').textContent = label;
  document.getElementById('progress-bar').style.width = `${progress}%`;
  
  if (isComplete) {
    showSuccessMessage('Video published successfully!');
    // Redirect to video page
    window.location.href = `/@${video.owner}/${video.permlink}`;
  }
});
```

---

## 🎬 Working Demo

**See it live:** https://video.3speak.tv/demo.html

**Source code:** `public/js/demo-app.js` in this repo

The demo shows complete integration including:
- Hive Keychain authentication
- Video duration detection
- Thumbnail upload with fallback
- Real-time TUS progress
- Status polling
- Error handling

**Use it as your reference!**

---

## ⚡ Rate Limits

- **General API:** 100 requests / 15 minutes
- **Uploads:** 10 uploads / hour per user

Need higher limits? Contact @meno.

---

## 🐛 Troubleshooting

**CORS errors?**  
API is configured for `*.3speak.tv` domains. Make sure you're calling from your 3Speak domain.

**Upload stuck at "uploaded"?**  
Wait 30-60 seconds. Encoder picks up jobs from queue. Poll status every 5 seconds.

**Thumbnail not showing?**  
Default thumbnail is automatically set if none uploaded. Check response from `/thumbnail` endpoint.

**Wrong video duration?**  
Use the `getVideoDuration()` helper to read actual duration from video metadata.

**Community object causing errors?**  
You can send the entire community object! The backend automatically extracts the `name` property. Just ensure the object has a `name` field (like `"hive-181335"`).

---

## 📞 Support

**Built by:** [@meno](https://peakd.com/@meno)

**Questions?**
1. Check demo: https://video.3speak.tv/demo.html
2. Review source: `public/js/demo-app.js`
3. Contact @meno on Hive

---

## ✅ Migration Checklist

- [ ] Get API token from @meno
- [ ] Install TUS: `npm install tus-js-client`
- [ ] Copy integration code above
- [ ] Replace old upload calls
- [ ] Test with sample video
- [ ] Monitor first uploads
- [ ] Verify Hive publishing
- [ ] Roll out to production

**That's it!** The backend (MongoDB, IPFS, encoding, Hive) is handled by my service. You just call the API.
