# In-Progress Video Tracking

## Overview

The `/api/upload/in-progress` endpoint allows the frontend to discover which videos a user has that are currently being processed. This enables a "Videos Being Processed" UI on the homepage or dashboard.

## Problem Solved

**Scenario:**
1. User uploads a video and clicks "Publish"
2. Video is uploaded, encoding starts
3. User navigates away to homepage/feed
4. **Question:** How does homepage know to show "You have 1 video encoding"?

**Solution:**
Call `/api/upload/in-progress` to get list of user's videos that haven't finished encoding yet, along with their `job_id` values for polling.

## How It Works

### Backend Logic

```javascript
// Find videos that are still being processed
Videos.find({
  owner: username,
  status: {
    $in: [
      'uploaded',           // Just uploaded, encoder picking up
      'encoding_ipfs',      // Uploading to IPFS
      'encoding_preparing', // Encoder preparing
      'encoding_progress'   // Actively encoding
    ]
  }
})
```

**Statuses Excluded:**
- `encoding_completed` - Done encoding
- `published` - Live on Hive
- `failed` - Failed (handle separately)

### Frontend Integration

```javascript
// On homepage load
async function checkInProgressVideos(username) {
  const response = await fetch('/api/upload/in-progress', {
    headers: {
      'X-Hive-Username': username
    }
  });
  
  const { success, data } = await response.json();
  
  if (!success) {
    console.error('Failed to check in-progress videos');
    return;
  }
  
  const { videos, count } = data;
  
  if (count === 0) {
    // No videos being processed
    hideProgressBanner();
    return;
  }
  
  // Show progress banner/widget
  showProgressBanner(videos);
  
  // Poll each video's encoding progress
  videos.forEach(video => {
    pollEncodingProgress(video.job_id, video.title);
  });
}

function showProgressBanner(videos) {
  const banner = document.getElementById('progress-banner');
  banner.innerHTML = `
    <div class="banner">
      <h3>🎬 ${videos.length} Video(s) Being Processed</h3>
      <div id="progress-widgets"></div>
    </div>
  `;
  banner.classList.remove('hidden');
}

function pollEncodingProgress(jobId, title) {
  const pollInterval = setInterval(async () => {
    // Poll gateway or your status endpoint
    const status = await getEncodingStatus(jobId);
    
    updateProgressWidget(jobId, {
      title,
      progress: status.progress.pct,
      status: status.status
    });
    
    // Stop polling when complete
    if (status.status === 'completed' || status.status === 'published') {
      clearInterval(pollInterval);
      removeProgressWidget(jobId);
    }
  }, 5000); // Poll every 5 seconds
}
```

## API Reference

### GET /api/upload/in-progress

**Authentication:** Required (X-Hive-Username header)

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
        "video_id": "674c8f1a2b3c4d5e6f7a8b9c",
        "owner": "coolmole",
        "permlink": "abc123de",
        "title": "My Awesome Video",
        "status": "encoding_progress",
        "job_id": "uuid-job-123-456",
        "encoding_progress": 67,
        "created": "2025-12-01T14:00:00.000Z"
      },
      {
        "video_id": "674c8f1a2b3c4d5e6f7a8b9d",
        "owner": "coolmole",
        "permlink": "def456gh",
        "title": "Another Video",
        "status": "encoding_ipfs",
        "job_id": "uuid-job-789-012",
        "encoding_progress": 23,
        "created": "2025-12-01T13:30:00.000Z"
      }
    ],
    "count": 2
  }
}
```

**Response (no videos in progress):**
```json
{
  "success": true,
  "data": {
    "videos": [],
    "count": 0
  }
}
```

**Response (error):**
```json
{
  "success": false,
  "error": "Username required"
}
```

## Response Fields

| Field | Type | Description |
|-------|------|-------------|
| `video_id` | String | MongoDB ObjectId of video entry |
| `owner` | String | Hive username |
| `permlink` | String | 8-character permlink |
| `title` | String | Video title |
| `status` | String | Current processing status |
| `job_id` | String | Encoding job ID (for gateway polling) |
| `encoding_progress` | Number | 0-100 encoding progress percentage |
| `created` | Date | When video was uploaded |

## Status Values

| Status | Meaning | Typical Duration |
|--------|---------|-----------------|
| `uploaded` | Just uploaded, encoder picking up job | 10-30 seconds |
| `encoding_ipfs` | Currently uploading to IPFS | 1-5 minutes |
| `encoding_preparing` | Encoder preparing transcode job | 10-30 seconds |
| `encoding_progress` | Actively encoding video | 5-30 minutes |

## Use Cases

### 1. Homepage Banner

```javascript
// Show banner if user has videos encoding
if (count > 0) {
  document.getElementById('encoding-banner').innerHTML = `
    <div class="alert alert-info">
      🎬 You have ${count} video(s) currently being processed.
      <a href="/my-videos">View Progress</a>
    </div>
  `;
}
```

### 2. Dashboard Widget

```javascript
// Show detailed progress for each video
videos.forEach(video => {
  const widget = createProgressWidget({
    title: video.title,
    status: getStatusLabel(video.status),
    progress: video.encoding_progress,
    thumbnail: getThumbnailUrl(video.video_id)
  });
  
  document.getElementById('dashboard-widgets').appendChild(widget);
});
```

### 3. My Videos Page

```javascript
// Show "Processing" section above published videos
const processingSection = `
  <section class="processing-videos">
    <h2>Videos Being Processed (${count})</h2>
    ${videos.map(v => renderProcessingVideo(v)).join('')}
  </section>
`;
```

### 4. Notification Badge

```javascript
// Show badge count on navigation
if (count > 0) {
  document.getElementById('videos-badge').textContent = count;
  document.getElementById('videos-badge').classList.remove('hidden');
}
```

## Polling Strategy

### Recommended Approach

```javascript
class InProgressTracker {
  constructor(username) {
    this.username = username;
    this.pollInterval = null;
  }
  
  start() {
    // Initial check
    this.check();
    
    // Poll every 30 seconds
    this.pollInterval = setInterval(() => {
      this.check();
    }, 30000);
  }
  
  stop() {
    if (this.pollInterval) {
      clearInterval(this.pollInterval);
      this.pollInterval = null;
    }
  }
  
  async check() {
    const response = await fetch('/api/upload/in-progress', {
      headers: { 'X-Hive-Username': this.username }
    });
    
    const { data } = await response.json();
    const { videos, count } = data;
    
    if (count === 0) {
      this.hideProgressUI();
      this.stop(); // Stop polling when no videos in progress
      return;
    }
    
    this.updateProgressUI(videos);
  }
  
  updateProgressUI(videos) {
    // Update UI with latest progress
    videos.forEach(video => {
      updateVideoProgress(video.video_id, video.encoding_progress);
    });
  }
  
  hideProgressUI() {
    document.getElementById('progress-banner')?.classList.add('hidden');
  }
}

// Usage
const tracker = new InProgressTracker('coolmole');
tracker.start();

// Stop tracking when user logs out or navigates away
window.addEventListener('beforeunload', () => tracker.stop());
```

## Performance Considerations

### Query Optimization

The endpoint is optimized:
- Uses indexed fields (`owner`, `status`)
- Limits to 10 results (reasonable max)
- Only selects needed fields (not full video document)
- Sorted by newest first

### Caching Strategy

Consider client-side caching:

```javascript
const cache = {
  data: null,
  timestamp: null,
  ttl: 30000 // 30 seconds
};

async function getInProgress(username) {
  const now = Date.now();
  
  // Return cached data if still valid
  if (cache.data && cache.timestamp && (now - cache.timestamp < cache.ttl)) {
    return cache.data;
  }
  
  // Fetch fresh data
  const response = await fetch('/api/upload/in-progress', {
    headers: { 'X-Hive-Username': username }
  });
  
  const data = await response.json();
  
  // Update cache
  cache.data = data;
  cache.timestamp = now;
  
  return data;
}
```

## Error Handling

```javascript
async function checkInProgress(username) {
  try {
    const response = await fetch('/api/upload/in-progress', {
      headers: { 'X-Hive-Username': username }
    });
    
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }
    
    const { success, data, error } = await response.json();
    
    if (!success) {
      console.error('API error:', error);
      return { videos: [], count: 0 };
    }
    
    return data;
    
  } catch (err) {
    console.error('Failed to check in-progress videos:', err);
    // Graceful degradation - hide progress UI
    return { videos: [], count: 0 };
  }
}
```

## Testing

### Manual Test

```bash
# Check in-progress videos for a user
curl -X GET http://localhost:8080/api/upload/in-progress \
  -H "X-Hive-Username: coolmole"
```

### Integration Test

```javascript
describe('In-Progress Tracking', () => {
  it('should return empty array when no videos encoding', async () => {
    const response = await fetch('/api/upload/in-progress', {
      headers: { 'X-Hive-Username': 'testuser' }
    });
    
    const { data } = await response.json();
    expect(data.count).toBe(0);
    expect(data.videos).toEqual([]);
  });
  
  it('should return videos with job_id', async () => {
    // Upload a test video first
    // ...
    
    const response = await fetch('/api/upload/in-progress', {
      headers: { 'X-Hive-Username': 'testuser' }
    });
    
    const { data } = await response.json();
    expect(data.count).toBeGreaterThan(0);
    expect(data.videos[0]).toHaveProperty('job_id');
  });
});
```

## Migration from Old System

If you're currently tracking uploads differently:

### Before
```javascript
// Storing upload state in localStorage or Redux
localStorage.setItem('currentUpload', JSON.stringify({
  video_id: 'xxx',
  status: 'uploading'
}));
```

### After
```javascript
// Server-side tracking via /in-progress endpoint
// No client-side state management needed
const { videos } = await getInProgress(username);
// Videos automatically tracked across page loads and devices
```

## Summary

The `/api/upload/in-progress` endpoint provides:

✅ **Server-side tracking** - Works across devices and page reloads  
✅ **Zero client state** - No localStorage or Redux needed  
✅ **Real job IDs** - Poll gateway for actual encoding progress  
✅ **Automatic cleanup** - Videos removed when published/failed  
✅ **Simple integration** - One API call on homepage load  

This enables a seamless UX where users can upload videos, navigate away, and return later to check progress without losing tracking state.
