# 3Speak Simplified Upload Service

A production-ready, streamlined upload service for 3Speak that bypasses the legacy gateway by directly injecting video entries and encoding jobs into MongoDB. Fully compatible with existing 3Speak infrastructure.

🚀 **Live Demo:** http://localhost:8080/demo.html (after setup)

## 🎯 Features

- ✅ **Single Token Authentication** - Simple bearer token or Hive username auth
- ✅ **TUS Resumable Uploads** - Large file support with resume capability
- ✅ **Upload-First Flow** - NEW! Upload starts immediately when file selected
- ✅ **Direct MongoDB Integration** - Bypasses legacy gateway completely
- ✅ **IPFS Supernode Upload** - Direct to 3Speak supercluster (65.21.201.94:5002)
- ✅ **Auto-Encoding & Auto-Publish** - Automatic job creation and Hive publishing
- ✅ **Hive Keychain Integration** - Demo with proper account authentication
- ✅ **Configurable Default Thumbnail** - Set via environment variable
- ✅ **Real-time Progress Tracking** - Upload → IPFS → Encoding → Published
- ✅ **100% Legacy Compatible** - Uses exact 3Speak video/job schemas
- ✅ **Zero Local Storage** - Immediate cleanup after IPFS upload
- ✅ **Production Security** - Rate limiting, validation, error handling
- ✅ **Duplicate Job Prevention** - Race condition protection
- ✅ **Dual Upload Methods** - Traditional (form-first) and Upload-First flows

## 📋 Prerequisites

- Node.js 16+ 
- MongoDB access (3Speak databases: `threespeak` + `spk-encoder-gateway`)
- IPFS access (3Speak supernode or local node)
- TUS server binary (`tusd`)

## 🚀 Quick Start

### 1. Clone & Install

```bash
git clone <repository-url>
cd 3speakupload
npm install
```

### 2. Configure Environment

```bash
cp .env.example .env
nano .env  # Edit with your settings
```

**Required settings:**
- `MONGO_URI` - MongoDB connection for 3Speak main database
- `ENCODER_MONGO_URI` - MongoDB connection for encoder gateway
- `UPLOAD_SECRET_TOKEN` - Authentication token for API access
- `IPFS_SUPERNODE_URL` - IPFS supernode endpoint (default: http://65.21.201.94:5002)
- `DEFAULT_THUMBNAIL` - Default thumbnail IPFS CID when none provided

### 3. Setup TUS Server

```bash
# Create hooks directory
mkdir -p /tmp/tus-hooks
cp scripts/tus-post-finish-hook.sh /tmp/tus-hooks/post-finish
chmod +x /tmp/tus-hooks/post-finish

# Start TUS server (in separate terminal)
./tusd_linux_amd64/tusd \
  -upload-dir /tmp/uploads \
  -hooks-dir /tmp/tus-hooks \
  -hooks-enabled-events post-finish \
  -port 1080 \
  -verbose
```

### 4. Start Upload Service

```bash
# Development mode (with auto-reload)
npm run dev

# Production mode
npm start
```

### 5. Access Demo

Open browser to: **http://localhost:8080/demo.html**

## 📖 Documentation

- **[🎯 Frontend API Integration](docs/FRONTEND_API_INTEGRATION.md)** - **START HERE for 3Speak devs** - How to integrate with the hosted API service
- **[🚀 Upload-First Flow Guide](docs/UPLOAD_FIRST_GUIDE.md)** - **NEW!** Improved UX with immediate uploads
- **[Complete Specification](docs/3SPEAK_SPECIFICATION.md)** - Full technical spec
- **[Video Schema Reference](docs/VIDEO_SCHEMA_REFERENCE.md)** - MongoDB schema details
- **[Local Setup Guide](docs/LOCAL_SETUP.md)** - Detailed local development setup
- **[TUS Setup Guide](docs/TUSD-SETUP.md)** - TUS server systemd configuration
- **[Legacy Compatibility](docs/LEGACY_COMPATIBILITY_FIXES.md)** - Schema compatibility notes

## 🔌 API Endpoints

### Traditional Upload Flow

```
POST /api/upload/prepare
├─→ Creates video entry in MongoDB
└─→ Returns video_id, permlink, metadata

TUS Upload → /files (port 1080)
├─→ Resumable upload via TUS protocol
├─→ Triggers post-finish hook
├─→ Uploads to IPFS supernode
├─→ Creates encoding job
└─→ Auto-publishes to Hive blockchain

GET /api/upload/video/:id/status
├─→ Returns video status + job status + progress
└─→ Use job.status for accurate encoding state
```

### Upload-First Flow (NEW)

```
POST /api/upload/init
├─→ Creates temporary upload entry
└─→ Returns upload_id, tus_endpoint

TUS Upload → /files (port 1080)
├─→ Upload starts immediately
└─→ Marks temp entry as completed

POST /api/upload/finalize
├─→ Creates video entry with metadata
├─→ Links to completed upload
├─→ Uploads to IPFS supernode
├─→ Creates encoding job
└─→ Auto-publishes to Hive blockchain

GET /api/upload/video/:id/status
├─→ Returns video status + job status + progress
├─→ job.status: queued → running → complete
├─→ job.progress.pct: encoding percentage (0-100)
└─→ See FRONTEND_API_INTEGRATION.md for status handling
```

**Why Upload-First?**
- Upload starts when file selected (better UX)
- User fills form while video uploads
- Submit enabled only when upload complete (safety)
- No waiting after clicking submit

### Progress Tracking

```
GET /api/upload/in-progress
├─→ Returns user's videos currently encoding
├─→ Includes job_id for each video
└─→ Frontend can poll gateway for real-time progress

Use case: User uploads, navigates to homepage
Homepage shows "Videos being processed" banner
Poll gateway with job_id for encoding progress
```

### Authentication

**Option 1: Bearer Token**
```bash
curl -H "Authorization: Bearer YOUR_SECRET_TOKEN" \
  http://localhost:8080/api/upload/prepare
```

**Option 2: Hive Username (Demo)**
```bash
curl -H "X-Hive-Username: yourusername" \
  http://localhost:8080/api/upload/prepare
```

## 🎬 Demo Features

The included demo (`/demo.html`) showcases:

- ✅ **Method Tabs** - Switch between Traditional and Upload-First flows
- ✅ Hive Keychain authentication
- ✅ Form validation and metadata entry
- ✅ Thumbnail upload (with default fallback)
- ✅ Real-time TUS upload progress
- ✅ **Upload-First UI** - Upload starts on file selection
- ✅ **Submit Button Safety** - Disabled until upload completes
- ✅ Live encoding status polling
- ✅ Community selection (Threespeak, Snapie)
- ✅ Decline rewards option
- ✅ Automatic video duration detection
- ✅ Complete upload lifecycle visualization

## 🛠️ Development

```bash
# Run in development mode
npm run dev

# Run tests
npm test

# Check database connections
node test/test-db-connection.js

# Test full workflow
./test/test-upload.sh
```

## 🔒 Security

- ✅ Rate limiting: 100 requests/15min (general), 10 uploads/hour (per user)
- ✅ Input validation on all endpoints
- ✅ MongoDB injection protection via Mongoose
- ✅ CORS configured for production domains
- ✅ Helmet security headers
- ✅ No credentials in code (environment variables only)
- ✅ Automatic temp file cleanup

## 🐛 Troubleshooting

### TUS upload fails
- Check TUS server is running on port 1080
- Verify `/tmp/uploads` directory exists and is writable
- Check CSP headers allow `localhost:1080` in connectSrc

### Encoding job not created
- Verify TUS post-finish hook has execute permissions
- Check MongoDB encoder connection string
- Review logs in `logs/combined.log`

### Duplicate jobs created
- Latest version includes race condition protection
- Jobs are idempotent - duplicate callbacks are handled gracefully

### Video duration incorrect
- Demo automatically detects duration from video metadata
- Falls back to 60 seconds if detection fails
- Ensure video file is valid and not corrupted

## 📦 Deployment

### VPS Deployment

1. Install Node.js 16+ and MongoDB client
2. Clone repository to `/var/www/3speak-upload`
3. Configure `.env` with production settings
4. Setup systemd service or PM2
5. Configure Nginx reverse proxy
6. Install and configure TUS server
7. Setup SSL certificates
8. Point domain: `video.3speak.tv`

See detailed deployment guide in `docs/` (coming soon).

## 📝 License

See [LICENSE.txt](LICENSE.txt)

## 👨‍💻 Credits

Built by [@meno](https://peakd.com/@meno) as a reference implementation for 3Speak developers.

**Goal:** Demonstrate that video upload UX doesn't have to be complicated. This service proves that a clean, fast, reliable upload experience is achievable with existing 3Speak infrastructure.

---

**Need help?** Check the `/docs` folder or open an issue.
