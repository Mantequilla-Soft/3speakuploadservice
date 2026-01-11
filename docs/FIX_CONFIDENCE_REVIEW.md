# Fix Review: 404 Upload Error

## Confidence Level: 🟡 **MEDIUM (60%)**

While the fix addresses the most likely cause, there are several gaps in my analysis that need verification.

---

## ✅ What I'm Confident About

### 1. The Problem is Real
- **Evidence:** Logs show `status: 404` for both TUS callback and finalize endpoints
- **Evidence:** Log message confirms: "Upload not found for upload_id: shiftrox_1768151958919..."
- **Evidence:** Routes exist and are properly mounted at `/api/upload/*`

### 2. Timing Analysis
- Upload ID timestamp: `1768151958919` = **17:39:18 UTC**
- Failed at: **18:37:54 UTC** = **~58 minutes later**
- Original expiration: **1 hour** (3600 seconds)
- **Conclusion:** Upload was close to timeout but SHOULDN'T have expired yet

### 3. The Fix Makes Sense
- Increasing expiration to 4 hours gives more buffer
- Better error messages help with debugging
- Diagnostic tools help investigate similar issues

---

## ⚠️ What I'm NOT Confident About (Potential Issues)

### Issue #1: **The Record May Never Have Been Created** 🔴 HIGH RISK

**The Problem:**
- If shiftrox's frontend never called `/api/upload/init`, no temp record would exist
- My fix won't help if the problem is missing initialization

**Evidence Gaps:**
- ❌ No logs showing successful `/init` call for this upload_id
- ❌ Logs are truncated - can't see full request history
- ❌ Don't know which frontend shiftrox is using

**How to Verify:**
```bash
# Check logs for init call
sudo journalctl -u 3speak-upload.service | grep "shiftrox_1768151958919"
sudo journalctl -u 3speak-upload.service | grep "Initializing upload-first for shiftrox"
```

**If This is the Issue:**
- Need to verify shiftrox is using the correct upload flow
- Check if production frontend is calling `/init` endpoint
- May need to add `/init` logging to track initialization

---

### Issue #2: **MongoDB TTL Index Auto-Deletion** 🟠 MEDIUM RISK

**The Problem:**
- MongoDB TTL indexes can auto-delete documents INDEPENDENTLY of application code
- If there's a TTL index on `expires` field, it might be deleting records too early
- Application expiration time won't matter if MongoDB is deleting first

**Current State:**
```javascript
// In TempUpload.js
tempUploadSchema.index({ expires: 1 }); // For TTL cleanup
```

**The Comment Says "For TTL cleanup" but:**
- ❌ Not clear if this is a MongoDB TTL index or just a regular index
- ❌ If it IS a TTL index, it might have its own expiration setting
- ❌ MongoDB TTL can have 60-second granularity issues

**How to Verify:**
```bash
node scripts/check-db-indexes.js
```

**If This is the Issue:**
- Need to remove or reconfigure TTL index
- Rely on cleanup service instead of MongoDB auto-deletion
- Or ensure TTL time matches application expiration

---

### Issue #3: **Cleanup Service Too Aggressive** 🟡 MEDIUM RISK

**The Problem:**
- Cleanup service runs every 6 hours: `'0 */6 * * *'`
- Calls `cleanupOrphanedUploads()` which deletes expired temp uploads
- If there's a timing bug, it might delete records before they expire

**Current Logic:**
```javascript
tempUploadSchema.statics.findOrphaned = async function() {
  return this.find({
    expires: { $lt: new Date() },  // Less than NOW
    finalized: false
  });
};
```

**Potential Issues:**
- ✅ Logic looks correct (only deletes if `expires < NOW`)
- ⚠️  But: clock skew between app server and DB server?
- ⚠️  Race condition: upload expires while being processed?

**How to Verify:**
```bash
# Check cleanup logs around the failure time
sudo journalctl -u 3speak-upload.service | grep -A5 -B5 "cleanupOrphanedUploads"
sudo journalctl -u 3speak-upload.service | grep "Cleaned orphaned upload: shiftrox"
```

---

### Issue #4: **Database Connection/Query Issue** 🟡 LOW-MEDIUM RISK

**The Problem:**
- MongoDB replica set lag
- Connection timeout
- Query running on wrong database instance
- Collection doesn't exist

**How to Verify:**
```bash
# Check if collection exists and has data
node scripts/check-temp-uploads.js shiftrox

# Check database connection
mongo $MONGO_URI --eval "db.temp_uploads.count()"
```

---

### Issue #5: **User Refreshed Page** 🟢 LOW RISK (But User Error)

**The Problem:**
- If shiftrox refreshed the browser during upload, JavaScript context lost
- `upload_id` stored in memory would be lost
- TUS might continue uploading with old `upload_id`
- Frontend loses reference to the upload

**Evidence:**
- Frontend polls constantly (all those 304s)
- If page refreshed, new session starts but TUS continues

**My Fix Won't Help With This**

---

## 🔍 Missing Information

To be more confident, I need:

1. **Full logs** - especially around 17:39 when upload started
2. **Init call verification** - did `/init` succeed?
3. **MongoDB indexes** - is there a TTL index?
4. **Cleanup service logs** - did it delete this record?
5. **Database query** - does ANY record exist for shiftrox?
6. **Frontend version** - which upload flow is shiftrox using?

---

## 🎯 Recommended Action Plan

### Immediate (Before Restart):

```bash
# 1. Check if TTL index exists (CRITICAL)
node scripts/check-db-indexes.js

# 2. Check current temp uploads for shiftrox
node scripts/check-temp-uploads.js shiftrox

# 3. Search logs for the specific upload_id
sudo journalctl -u 3speak-upload.service | grep "shiftrox_1768151958919" > /tmp/shiftrox_upload.log
cat /tmp/shiftrox_upload.log

# 4. Check for /init calls
sudo journalctl -u 3speak-upload.service --since "2026-01-11 17:30" --until "2026-01-11 17:45" | grep "init"

# 5. Check for cleanup around failure time
sudo journalctl -u 3speak-upload.service --since "2026-01-11 18:30" --until "2026-01-11 18:40" | grep -i "clean"
```

### After Verification:

1. **If TTL index exists:** Remove it or sync with 4-hour expiration
2. **If no /init call found:** Fix frontend integration
3. **If cleanup deleted it:** Review cleanup service logic
4. **If none of above:** My fix should work ✅

### After Restart:

1. Ask shiftrox to try again **with monitoring**
2. Watch logs in real-time: `sudo journalctl -u 3speak-upload.service -f`
3. Verify `/init` call succeeds
4. Verify TUS callback finds the record
5. Verify finalize succeeds

---

## 📊 Risk Assessment

| Issue | Probability | Impact | Fixed? |
|-------|-------------|--------|--------|
| Upload took too long | 40% | High | ✅ Yes (4h timeout) |
| /init never called | 30% | High | ❌ No |
| TTL index auto-delete | 15% | High | ❓ Need to check |
| Cleanup too aggressive | 10% | Medium | ⚠️  Maybe |
| User refreshed page | 5% | Medium | ❌ No |

**Overall Success Probability: ~60-70%** if my primary hypothesis is correct.

---

## 💡 Better Fix (If I Had More Time)

### 1. Add Upload Resumption
```javascript
// Store upload_id in localStorage as backup
localStorage.setItem('current_upload_id', upload_id);

// On page load, check for interrupted upload
if (localStorage.getItem('current_upload_id')) {
  // Offer to resume
}
```

### 2. Add Progress Warnings
```javascript
// Warn user when approaching timeout
if (timeElapsed > 3 * 60 * 60 * 1000) { // 3 hours
  showWarning("Upload will expire in 1 hour!");
}
```

### 3. Remove TTL Index (If Exists)
```javascript
// Let application handle cleanup, not MongoDB
// More predictable and debuggable
```

### 4. Add Comprehensive Logging
```javascript
// Log every state change
console.log('🎬 Upload lifecycle:', {
  event: 'init|tus_start|tus_complete|finalize',
  upload_id,
  timestamp,
  elapsed_time
});
```

---

## ✅ What to Tell shiftrox

> "I've increased the upload timeout from 1 hour to 4 hours, which should fix the issue if your upload was taking too long. 
> 
> However, before you try again, I need to verify a few things on the server to make sure the root cause is what I think it is.
> 
> Can you try one more upload while I watch the logs in real-time? That way I can see exactly what's happening."

---

## 🎯 Bottom Line

**My fix WILL help IF:**
- The problem is timeout-related (likely)
- No TTL index is interfering (unknown)
- Frontend is calling `/init` correctly (assumed)

**My fix WON'T help IF:**
- Frontend not calling `/init`
- TTL index auto-deleting
- User keeps refreshing page

**Confidence: 60%** - I'd like to run those verification scripts before declaring victory.
