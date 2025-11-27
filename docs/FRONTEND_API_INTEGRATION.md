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

| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/api/upload/prepare` | POST | Create video entry |
| `/api/upload/thumbnail/:video_id` | POST | Upload thumbnail (optional) |
| `/files` | TUS | Upload video (resumable) |
| `/api/upload/video/:id/status` | GET | Get encoding status |

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
   * Poll status until published
   */
  pollUntilPublished(videoId, onUpdate, intervalMs = 5000) {
    const interval = setInterval(async () => {
      try {
        const status = await this.getStatus(videoId);
        if (onUpdate) onUpdate(status);

        // Stop when published
        if (status.video.status === 'published') {
          clearInterval(interval);
        }
      } catch (error) {
        console.error('Poll error:', error);
        clearInterval(interval);
      }
    }, intervalMs);

    return interval;
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
      console.log('Status:', status.video.status);
      console.log('Progress:', status.video.encodingProgress, '%');
      
      if (status.video.status === 'published') {
        console.log('🎉 Published to Hive!');
        console.log('IPFS:', status.video.filename);
        window.location.href = `/@${metadata.owner}/${prepared.permlink}`;
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

**Status Values:**
- `uploaded` - On IPFS, encoding job created
- `encoding_ipfs` - Encoder processing
- `published` - Live on Hive blockchain!

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
