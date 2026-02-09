# Hive Image Upload - Deployment Guide

**Branch:** `hive-image-upload`  
**Date:** February 9, 2026  
**Status:** ✅ Ready for Testing

---

## What's New

This branch adds **Hive image hosting** for video thumbnails with automatic IPFS fallback.

### Key Features

1. **Primary Hive Upload** - Thumbnails uploaded to `images.hive.blog` (free, permanent hosting)
2. **IPFS Fallback** - Automatic fallback to IPFS if Hive is unavailable
3. **Circuit Breaker** - Auto-disables Hive after 5 consecutive failures (60s cooldown)
4. **Backward Compatible** - Existing IPFS-only thumbnails continue to work
5. **Dual Format Support** - Stores either Hive URLs or `ipfs://` URIs in database

---

## Deployment Steps

### 1. Pull the Branch on VPS

```bash
cd /path/to/3speakupload
git fetch origin
git checkout hive-image-upload
git pull origin hive-image-upload
```

### 2. Install Dependencies

```bash
npm install
```

**New dependency added:** `@hiveio/dhive` (for Hive signing)

### 3. Configure Environment Variables

Add/verify these in your `.env` file:

```bash
# Hive Image Upload Configuration
HIVE_IMAGE_ACCOUNT=threespeak-app
HIVE_IMAGE_POSTING_KEY=5JTxsjygz6h5xxcnQ5UaMLW8wNV2f5vcz35tTBjMxsdk1vM96un

# Optional: Custom temp directory (default: /tmp)
HIVE_TEMP_DIR=/tmp

# Optional: Max retry attempts (default: 2)
HIVE_MAX_RETRIES=2
```

**IMPORTANT:** Verify the `HIVE_IMAGE_POSTING_KEY` is correct for the `threespeak-app` account. The key must:
- Start with `5`
- Be the **posting key** (not active/owner key)
- Have permission to upload to images.hive.blog

### 4. Test the Service

```bash
# Test Hive configuration
node test/test-hive-upload.js

# Check health endpoint
curl http://localhost:8080/health | jq
```

Expected health response:
```json
{
  "success": true,
  "status": "healthy",
  "features": {
    "hiveImageUpload": {
      "enabled": true,
      "available": true,
      "circuitBreaker": {
        "isOpen": false,
        "failureCount": 0
      }
    }
  }
}
```

### 5. Start the Service

```bash
# Development
npm run dev

# Production (or use PM2)
npm start
```

---

## How It Works

### Upload Flow

```
1. User uploads thumbnail
   ↓
2. Try Hive upload (primary)
   ├─ Success → Store Hive URL in DB
   └─ Failure → Try IPFS (fallback)
       ├─ Success → Store ipfs:// URI in DB
       └─ Failure → Use default thumbnail
```

### Database Storage

Thumbnails now stored in two formats:

1. **Hive URL** (new):
   ```
   https://images.hive.blog/DQmSiPnAC1JVcPu3S8Q61tMqqCykvQsQHj9rU3WhNnAnQtt/image.png
   ```

2. **IPFS URI** (existing):
   ```
   ipfs://QmXxxx...
   ```

Both formats work with existing frontend/encoder code.

### Circuit Breaker Pattern

- After **5 consecutive failures**, Hive upload is disabled for **60 seconds**
- During this time, all uploads go directly to IPFS
- Automatic recovery after timeout
- Prevents cascading failures during Hive outages

---

## Testing Checklist

### Manual Tests

- [ ] Upload video with file thumbnail
- [ ] Upload video with base64 thumbnail
- [ ] Verify thumbnail URL in MongoDB (check format)
- [ ] Confirm image loads in browser
- [ ] Test with Hive unavailable (should fallback to IPFS)
- [ ] Check `/health` endpoint shows Hive status

### Automated Test

```bash
node test/test-hive-upload.js
```

This will:
- ✅ Verify Hive configuration
- ✅ Test base64 image upload
- ✅ Check circuit breaker status
- ✅ Validate fallback behavior

---

## Monitoring

### Log Messages to Watch

**Success:**
```
✅ Hive upload successful: https://images.hive.blog/...
```

**Fallback:**
```
⚠️ Hive upload failed, falling back to IPFS
```

**Circuit Breaker:**
```
🔴 Hive upload circuit breaker opened after 5 consecutive failures
```

### Metrics to Track

1. **Hive vs IPFS ratio** - How many thumbnails use Hive vs IPFS
2. **Circuit breaker events** - How often does it open?
3. **Failure reasons** - Why are Hive uploads failing?

---

## Troubleshooting

### Issue: "invalid_signature" error

**Cause:** Incorrect posting key or key doesn't have upload permissions

**Fix:**
1. Verify `HIVE_IMAGE_POSTING_KEY` is correct for `threespeak-app`
2. Ensure it's the **posting key** (not active key)
3. Check account has upload permissions

### Issue: Circuit breaker always open

**Cause:** Persistent Hive upload failures

**Fix:**
1. Check Hive posting key is valid
2. Verify images.hive.blog is accessible
3. Check network connectivity to Hive
4. Review logs for specific error messages

### Issue: Thumbnails not loading

**Cause:** Mixed format confusion (Hive URL vs IPFS URI)

**Fix:**
- Hive URLs should be stored as-is (no `ipfs://` prefix)
- IPFS hashes should use `ipfs://` prefix
- Frontend should handle both formats

---

## Rollback Plan

If issues arise, rollback is simple:

```bash
git checkout main
npm install  # Restore original dependencies
pm2 restart 3speak-upload
```

The service will continue using IPFS-only uploads (original behavior).

---

## Next Steps

1. **Deploy to test VPS** - Validate with real credentials
2. **Monitor for 24 hours** - Check success rate and errors
3. **Adjust circuit breaker** - Tune thresholds if needed
4. **Production rollout** - Deploy to main VPS after validation

---

## Questions?

- Test script: `test/test-hive-upload.js`
- Service implementation: `src/services/hive-image.js`
- Integration: `src/services/ipfs.js` (see `_uploadThumbnailWithFallback`)
- Health check: `GET /health`

Good luck with the deployment! 🚀
