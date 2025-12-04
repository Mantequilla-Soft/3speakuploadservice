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

The `/in-progress` endpoint returns **everything you need** - no additional API calls required!

```javascript
// On homepage/dashboard load
async function checkInProgressVideos(username) {
  const response = await fetch('/api/upload/in-progress', {
    headers: { 'X-Hive-Username': username }
  });
  
  const { success, data } = await response.json();
  
  if (!success || data.count === 0) {
    hideProgressBanner();
    return;
  }
  
  // Show the banner with all video progress
  showProgressBanner(data);
  
  // Start polling for updates
  startPolling(username);
}

function showProgressBanner(data) {
  const { videos, message, overall_progress, summary } = data;
  
  const banner = document.getElementById('progress-banner');
  banner.innerHTML = `
    <div class="encoding-banner">
      <div class="banner-header">
        <h3>🎬 ${message}</h3>
        <span class="overall-progress">${overall_progress}% complete</span>
      </div>
      
      <div class="summary-badges">
        ${summary.queued > 0 ? `<span class="badge queued">${summary.queued} queued</span>` : ''}
        ${summary.encoding > 0 ? `<span class="badge encoding">${summary.encoding} encoding</span>` : ''}
        ${summary.finishing > 0 ? `<span class="badge finishing">${summary.finishing} publishing</span>` : ''}
      </div>
      
      <div class="video-progress-list">
        ${videos.map(video => createVideoProgressCard(video)).join('')}
      </div>
    </div>
  `;
  banner.classList.remove('hidden');
}

function createVideoProgressCard(video) {
  // Everything you need is already in the response!
  const {
    video_id,
    title,
    thumbnail,
    elapsed_minutes,
    progress_percent,
    status_label,
    status_short,
    is_complete,
    is_failed,
    display
  } = video;
  
  const statusClass = is_failed ? 'failed' : (is_complete ? 'complete' : 'encoding');
  
  return `
    <div class="video-card ${statusClass}" data-video-id="${video_id}">
      ${thumbnail ? `<img src="${thumbnail}" class="thumbnail" />` : ''}
      <div class="video-info">
        <h4>${title}</h4>
        <div class="status">${status_label}</div>
        <div class="progress-bar">
          <div class="progress-fill" style="width: ${progress_percent}%"></div>
        </div>
        <div class="meta">
          <span>${elapsed_minutes} min ago</span>
          <span>${Math.round(progress_percent)}%</span>
        </div>
      </div>
    </div>
  `;
}

// Poll the same endpoint - it always returns fresh data
let pollingInterval = null;

function startPolling(username) {
  // Clear any existing polling
  if (pollingInterval) clearInterval(pollingInterval);
  
  pollingInterval = setInterval(async () => {
    const response = await fetch('/api/upload/in-progress', {
      headers: { 'X-Hive-Username': username }
    });
    
    const { success, data } = await response.json();
    
    if (!success) return;
    
    if (data.count === 0) {
      // All videos complete!
      hideProgressBanner();
      stopPolling();
      showCompletionToast('All videos published! 🎉');
      return;
    }
    
    // Update the UI
    showProgressBanner(data);
    
    // Check for any completed videos
    data.videos.forEach(video => {
      if (video.is_complete) {
        showCompletionToast(`"${video.title}" is now live!`);
      }
    });
    
  }, 5000); // Poll every 5 seconds (as recommended in response)
}

function stopPolling() {
  if (pollingInterval) {
    clearInterval(pollingInterval);
    pollingInterval = null;
  }
}
````
```

## API Reference

### GET /api/upload/in-progress

**Authentication:** Required (X-Hive-Username header)

**🚀 This is the ONE endpoint you need!** Returns everything: video info, job status, progress percentages, and display-ready labels. No need to make additional API calls.

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
        "thumbnail": "ipfs://QmXxx...",
        "created": "2025-12-01T14:00:00.000Z",
        "elapsed_minutes": 5,
        
        "video_status": "encoding_ipfs",
        "job_id": "uuid-job-123-456",
        "job_status": "running",
        "job_progress": {
          "pct": 67.5,
          "download_pct": 100
        },
        
        "display": {
          "phase": 2,
          "label": "🎬 Encoding: 68%",
          "shortLabel": "Encoding",
          "progress": 70.5,
          "downloadProgress": 100,
          "encodeProgress": 67.5,
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
    "summary": {
      "queued": 0,
      "encoding": 1,
      "finishing": 0,
      "failed": 0
    },
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
    "summary": {
      "queued": 0,
      "encoding": 0,
      "finishing": 0
    }
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

### Video Object Fields

| Field | Type | Description |
|-------|------|-------------|
| `video_id` | String | MongoDB ObjectId of video entry |
| `owner` | String | Hive username |
| `permlink` | String | 8-character permlink |
| `title` | String | Video title |
| `thumbnail` | String | Thumbnail IPFS URL (if set) |
| `created` | Date | When video was uploaded |
| `elapsed_minutes` | Number | Minutes since upload started |

### Status Fields (Raw)

| Field | Type | Description |
|-------|------|-------------|
| `video_status` | String | Raw video.status from database |
| `job_id` | String | Encoding job UUID |
| `job_status` | String | Raw job.status: `queued`, `running`, `complete`, `failed` |
| `job_progress` | Object | `{ pct: 0-100, download_pct: 0-100 }` |

### Display Fields (Use These!)

| Field | Type | Description |
|-------|------|-------------|
| `display.phase` | Number | 1=waiting, 2=encoding, 2.5=publishing, 3=done |
| `display.label` | String | Full status with emoji (e.g., "🎬 Encoding: 68%") |
| `display.shortLabel` | String | Short status (e.g., "Encoding") |
| `display.progress` | Number | Overall progress 0-100 |
| `display.downloadProgress` | Number | IPFS download progress 0-100 |
| `display.encodeProgress` | Number | Encoding progress 0-100 |
| `display.isComplete` | Boolean | True when video.status = "published" |
| `display.isFailed` | Boolean | True on any failure |

### Convenience Fields

| Field | Type | Description |
|-------|------|-------------|
| `progress_percent` | Number | Same as display.progress |
| `status_label` | String | Same as display.label |
| `status_short` | String | Same as display.shortLabel |
| `is_complete` | Boolean | Same as display.isComplete |
| `is_failed` | Boolean | Same as display.isFailed |

### Summary Object

| Field | Type | Description |
|-------|------|-------------|
| `summary.queued` | Number | Videos waiting for encoder |
| `summary.encoding` | Number | Videos actively encoding |
| `summary.finishing` | Number | Videos publishing to Hive |
| `summary.failed` | Number | Failed videos |
| `overall_progress` | Number | Average progress of all videos |
| `message` | String | Human-readable summary |
| `poll_interval_ms` | Number | Recommended polling interval (5000ms) |

## Status Phases

| Phase | Meaning | Progress Range |
|-------|---------|----------------|
| 1 | Waiting for encoder to pick up job | 5-10% |
| 2 | Actively encoding (download → transcode) | 10-90% |
| 2.5 | Encoding done, publishing to Hive | 95% |
| 3 | Published! Complete. | 100% |

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
