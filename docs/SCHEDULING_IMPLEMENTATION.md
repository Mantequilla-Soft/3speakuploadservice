# Post Scheduling Implementation

**Date:** January 3, 2026  
**Status:** ✅ Complete - Ready for Testing

---

## Summary

Implemented minimal backend and frontend changes to support scheduled posts. The upload service now accepts scheduling parameters and stores them in the database. The actual publishing at the scheduled time is handled by a separate service (out of scope for this implementation).

---

## Changes Made

### 1. Backend - Video Schema ([src/models/Video.js](../src/models/Video.js))

**Added Fields:**
```javascript
publish_data: {
  type: Date,
  required: false // Only required when publish_type === 'schedule'
}
```

**Updated Status Enum:**
```javascript
status: {
  enum: [
    'uploaded', 
    'encoding_ipfs', 
    'encoding_preparing',
    'encoding_progress',
    'encoding_completed',
    'published',
    'scheduled',  // ✨ NEW
    'failed'
  ]
}
```

### 2. Backend - Upload Routes ([src/routes/upload.js](../src/routes/upload.js))

#### Added Validation
Both `/api/upload/prepare` and `/api/upload/finalize` endpoints now accept:

```javascript
publish_type: String   // Optional, default: "publish", allowed: "publish" | "schedule"
publish_data: Number   // Optional, Unix timestamp in seconds
```

#### Validation Logic
- If `publish_type === "schedule"` but `publish_data` is missing or invalid → fallback to "publish"
- `publish_data` must be at least 1 hour in the future
- `publish_data` must be maximum 90 days in the future
- Past dates automatically fallback to immediate publish

#### No Breaking Changes
- Both parameters are optional
- Default behavior is unchanged (`publish_type: "publish"`)
- Existing API calls work without modification

### 3. Frontend - Demo Page ([public/demo.html](../public/demo.html))

**Added to Both Traditional and Upload-First Forms:**

```html
<!-- Scheduling Checkbox -->
<div class="form-group">
  <label class="checkbox-label">
    <input type="checkbox" id="schedule-post">
    <span>📅 Schedule for Later</span>
  </label>
</div>

<!-- Date/Time Picker (Hidden by default) -->
<div id="schedule-datetime-group" class="form-group hidden">
  <label for="schedule-datetime">Publish Date & Time</label>
  <input type="datetime-local" id="schedule-datetime">
  <small>Must be at least 1 hour in future, maximum 90 days</small>
</div>
```

### 4. Frontend - JavaScript ([public/js/demo-app.js](../public/js/demo-app.js))

**Added Helper Methods:**
- `toggleScheduleDateTime(groupId, show)` - Show/hide date picker
- `formatDateTimeLocal(date)` - Format date for HTML5 input
- `getSchedulingParams(checkboxId, datetimeId)` - Extract scheduling data

**Updated Upload Handlers:**
- Traditional flow includes scheduling params in `prepareUpload()`
- Upload-first flow includes scheduling params in finalize FormData

**Automatic Validation:**
- Sets minimum datetime to 1 hour from now
- Sets maximum datetime to 90 days from now
- Falls back gracefully if invalid

---

## API Examples

### Immediate Publish (Default - Backwards Compatible)
```javascript
POST /api/upload/finalize
{
  "upload_id": "abc123",
  "title": "My Video",
  "description": "...",
  // No scheduling params = immediate publish
}
```

### Scheduled Post
```javascript
POST /api/upload/finalize
{
  "upload_id": "abc123",
  "title": "My Video",
  "description": "...",
  "publish_type": "schedule",
  "publish_data": 1736524800  // Unix timestamp (Jan 10, 2026 3PM UTC)
}
```

### Invalid Schedule (Falls Back to Immediate)
```javascript
POST /api/upload/finalize
{
  "upload_id": "abc123",
  "title": "My Video",
  "description": "...",
  "publish_type": "schedule",
  "publish_data": 1704067200  // Past date → automatic fallback
}
// Result: Video publishes immediately with publish_type: "publish"
```

---

## Testing Checklist

- [x] Video schema accepts `publish_data` field
- [x] Status enum includes `'scheduled'`
- [x] API accepts `publish_type` parameter
- [x] API accepts `publish_data` parameter
- [x] Validation rejects past dates (falls back to publish)
- [x] Validation requires 1 hour minimum (falls back to publish)
- [x] Validation enforces 90 day maximum (falls back to publish)
- [x] Demo page shows scheduling checkbox
- [x] Demo page shows date/time picker when enabled
- [x] Date picker enforces min/max constraints
- [x] Traditional flow sends scheduling params
- [x] Upload-first flow sends scheduling params
- [x] Backwards compatibility preserved (no breaking changes)

### Manual Testing Steps

1. **Start the service:**
   ```bash
   npm start
   ```

2. **Open demo page:**
   ```
   http://localhost:8080/demo.html
   ```

3. **Test Immediate Publish (Default):**
   - Login with Hive Keychain
   - Upload a video without checking "Schedule for Later"
   - Verify `publish_type: "publish"` in database

4. **Test Scheduled Post:**
   - Upload a video
   - Check "📅 Schedule for Later"
   - Select date/time at least 1 hour in future
   - Submit
   - Verify `publish_type: "schedule"` and `publish_data` in database

5. **Test Validation:**
   - Try to schedule for past date → should fallback to publish
   - Try to schedule for <1 hour → should fallback to publish
   - Try to schedule for >90 days → should fallback to publish

---

## Database Queries

### Find All Scheduled Posts
```javascript
db.videos.find({
  publish_type: "schedule",
  status: "scheduled"
}).sort({ publish_data: 1 })
```

### Find Posts Ready to Publish (For Scheduler Service)
```javascript
db.videos.find({
  status: "scheduled",
  publish_data: { $lte: new Date() }
})
```

---

## Out of Scope

The following are **NOT** implemented (handled by separate service):

- Scheduled publisher cron job
- Automatic publishing at scheduled time
- Status transition from `"scheduled"` to `"published"`
- Retry logic for failed scheduled publishes
- User endpoints to list/manage scheduled posts

---

## Notes

- **No Breaking Changes**: Existing uploads work without modification
- **Graceful Fallbacks**: Invalid scheduling always falls back to immediate publish
- **Frontend Validation**: HTML5 datetime-local provides built-in UX
- **Backend Validation**: Server always validates and sanitizes input
- **Logging**: Console logs show scheduling validation results

---

## Future Enhancements (If Needed)

1. Add `/api/video/scheduled` endpoint to list user's scheduled videos
2. Add `/api/video/:id/reschedule` endpoint to change schedule time
3. Add `/api/video/:id/cancel-schedule` endpoint to publish immediately
4. Add timezone display/conversion in UI
5. Add scheduling notifications

---

**Implementation complete and ready for testing!** 🎉
