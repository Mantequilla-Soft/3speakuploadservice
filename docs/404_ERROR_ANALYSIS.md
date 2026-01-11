# 404 Upload Error - Root Cause Analysis

**Date:** January 11, 2026  
**Reported by:** shiftrox  
**Issue:** Video upload failing with 404 error

## HTTP Status Codes Explained

### 304 - Not Modified ✅ (Normal)
- This is **good and expected**!
- Happens when the frontend polls for updates
- Server says "nothing changed, use your cached version"
- Efficient - saves bandwidth

### 404 - Not Found ❌ (The Problem)
- Upload record doesn't exist in database
- Causes upload to fail

## Root Cause

The 404 errors are happening because the **temporary upload record expired or was deleted** before the upload completed.

### Upload Flow (Upload-First):
1. User clicks upload → `/api/upload/init` creates `temp_upload` record
2. User uploads video → TUS stores file
3. TUS finishes → `/api/upload/tus-callback` marks record as complete
4. User submits form → `/api/upload/finalize` creates video entry

### What Went Wrong:
Looking at the logs:
- Upload ID: `shiftrox_1768151958919_efcea25629e0f166`
- Started: ~17:39 UTC (from timestamp in ID)
- Failed: 18:37 UTC (from logs)
- **Duration: ~58 minutes** (just under the 1-hour limit)

The temp upload record was configured to expire after **1 hour**, but:
1. Upload took nearly 1 hour
2. Cleanup service may have removed it early
3. Database query timing issues

## Solutions Implemented

### 1. Increased Expiration Time ✅
**Changed:** 1 hour → 4 hours

**File:** `src/models/TempUpload.js`
```javascript
expires: {
  type: Date,
  default: () => new Date(Date.now() + 4 * 60 * 60 * 1000), // 4 hours from now
  index: true
}
```

**Benefits:**
- Users on slower connections have more time
- Large video files (> 1GB) can complete
- Reduces frustration from timeout errors

### 2. Better Error Messages ✅
**File:** `src/routes/upload.js`

Added detailed logging when upload not found:
- Explains why 404 happened
- Lists possible causes
- Shows user's recent uploads
- Gives actionable advice

### 3. Database Diagnostic Tool ✅
**File:** `scripts/check-temp-uploads.js`

Usage:
```bash
node scripts/check-temp-uploads.js shiftrox
```

Shows:
- All temp uploads for user
- Expiration status
- TUS completion status
- Stuck uploads

## Instructions for shiftrox

### If Upload Fails Again:

1. **Don't refresh the page** during upload
2. **Complete within 4 hours** (new limit)
3. **Check your connection** - slow upload = timeout risk
4. **Use demo page first** to test: `http://video.3speak.tv/demo.html`

### To Restart:
1. Close the upload page
2. Open fresh page
3. Start new upload (will get new `upload_id`)

## Server Restart Required

The changes won't take effect until the server is restarted:

```bash
# On production server
sudo systemctl restart 3speak-upload.service

# Or with PM2
pm2 restart 3speak-upload
```

## Monitoring

Check for similar issues:
```bash
# Find all 404 errors
sudo journalctl -u 3speak-upload.service | grep "status\":404"

# Check temp uploads for any user
node scripts/check-temp-uploads.js <username>

# Monitor cleanup service
sudo journalctl -u 3speak-upload.service | grep "🗑️"
```

## Prevention

### Future Improvements:
1. ✅ Increase expiration (done)
2. ✅ Better error messages (done)
3. Consider: Resume upload from where it left off
4. Consider: Warn user when approaching timeout
5. Consider: Store upload_id in localStorage as backup

## Summary

**Problem:** 1-hour expiration too short for large videos/slow connections  
**Solution:** Increased to 4 hours + better error handling  
**Action Required:** Restart server, ask shiftrox to try again

---

**Next Steps:**
1. Restart production server
2. Test with shiftrox
3. Monitor logs for any more 404s
4. Consider further increasing if needed
