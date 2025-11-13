/**
 * 3Speak Upload Demo - Upload Client
 * 
 * Handles video uploads with TUS protocol and real-time progress tracking.
 * Polls backend for encoding status updates.
 */

class UploadClient {
    constructor(apiBaseUrl = '') {
        this.apiBaseUrl = apiBaseUrl || window.location.origin;
        this.tusEndpoint = null;
        this.currentUpload = null;
        this.statusPollingInterval = null;
        this.videoId = null;
    }

    /**
     * Prepare upload by creating video entry in database
     */
    async prepareUpload(username, videoData) {
        const response = await fetch(`${this.apiBaseUrl}/api/upload/prepare`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'X-Hive-Username': username // Use Hive username for auth
            },
            body: JSON.stringify(videoData)
        });

        if (!response.ok) {
            const error = await response.json();
            throw new Error(error.error || 'Failed to prepare upload');
        }

        const result = await response.json();
        this.videoId = result.data.video_id;
        this.tusEndpoint = result.data.tus_endpoint;
        
        return result.data;
    }

    /**
     * Upload thumbnail image to IPFS
     */
    async uploadThumbnail(username, videoId, thumbnailFile) {
        const formData = new FormData();
        formData.append('thumbnail', thumbnailFile);

        const response = await fetch(`${this.apiBaseUrl}/api/upload/thumbnail/${videoId}`, {
            method: 'POST',
            headers: {
                'X-Hive-Username': username
            },
            body: formData
        });

        if (!response.ok) {
            const error = await response.json();
            throw new Error(error.error || 'Failed to upload thumbnail');
        }

        return await response.json();
    }

    /**
     * Upload video file using TUS resumable upload protocol
     */
    uploadVideo(file, metadata, onProgress, onSuccess, onError) {
        // Create TUS upload instance
        const upload = new tus.Upload(file, {
            endpoint: this.tusEndpoint,
            retryDelays: [0, 3000, 5000, 10000, 20000],
            // Performance optimization: larger chunks = faster uploads
            chunkSize: 10 * 1024 * 1024, // 10MB chunks (up from default 5MB)
            parallelUploads: 3, // Upload 3 chunks simultaneously
            metadata: {
                filename: file.name,
                filetype: file.type,
                video_id: metadata.video_id,
                owner: metadata.owner,
                permlink: metadata.permlink
            },
            onError: (error) => {
                console.error('TUS upload failed:', error);
                onError(error);
            },
            onProgress: (bytesUploaded, bytesTotal) => {
                const percentage = ((bytesUploaded / bytesTotal) * 100).toFixed(2);
                onProgress(percentage, bytesUploaded, bytesTotal);
            },
            onSuccess: () => {
                console.log('TUS upload completed successfully');
                onSuccess();
            }
        });

        // Start upload
        upload.start();
        this.currentUpload = upload;

        return upload;
    }

    /**
     * Get video and encoding job status
     */
    async getStatus(videoId, username) {
        const response = await fetch(`${this.apiBaseUrl}/api/upload/video/${videoId}/status`, {
            method: 'GET',
            headers: {
                'X-Hive-Username': username
            }
        });

        if (!response.ok) {
            throw new Error('Failed to fetch status');
        }

        return await response.json();
    }

    /**
     * Start polling for encoding status updates
     */
    startStatusPolling(videoId, username, onUpdate, interval = 5000) {
        // Clear any existing polling
        this.stopStatusPolling();

        // Poll immediately
        this.pollStatus(videoId, username, onUpdate);

        // Set up interval polling
        this.statusPollingInterval = setInterval(() => {
            this.pollStatus(videoId, username, onUpdate);
        }, interval);
    }

    /**
     * Poll status once
     */
    async pollStatus(videoId, username, onUpdate) {
        try {
            const status = await this.getStatus(videoId, username);
            onUpdate(status);

            // Stop polling if encoding is complete
            if (status.data.video.status === 'publish_manual' || 
                status.data.video.status === 'published') {
                this.stopStatusPolling();
            }
        } catch (error) {
            console.error('Status polling error:', error);
        }
    }

    /**
     * Stop status polling
     */
    stopStatusPolling() {
        if (this.statusPollingInterval) {
            clearInterval(this.statusPollingInterval);
            this.statusPollingInterval = null;
        }
    }

    /**
     * Cancel current upload
     */
    cancelUpload() {
        if (this.currentUpload) {
            this.currentUpload.abort();
            this.currentUpload = null;
        }
        this.stopStatusPolling();
    }

    /**
     * Format bytes to human readable size
     */
    formatBytes(bytes) {
        if (bytes === 0) return '0 Bytes';
        const k = 1024;
        const sizes = ['Bytes', 'KB', 'MB', 'GB'];
        const i = Math.floor(Math.log(bytes) / Math.log(k));
        return Math.round(bytes / Math.pow(k, i) * 100) / 100 + ' ' + sizes[i];
    }

    /**
     * Format duration to human readable time
     */
    formatDuration(seconds) {
        const hours = Math.floor(seconds / 3600);
        const minutes = Math.floor((seconds % 3600) / 60);
        const secs = Math.floor(seconds % 60);
        
        if (hours > 0) {
            return `${hours}:${minutes.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
        }
        return `${minutes}:${secs.toString().padStart(2, '0')}`;
    }
}

// Export for use in other modules
window.UploadClient = UploadClient;
