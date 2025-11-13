/**
 * 3Speak Upload Demo - Main Application
 * 
 * Orchestrates the complete upload workflow:
 * 1. Keychain authentication
 * 2. Upload form handling
 * 3. TUS upload with progress
 * 4. Real-time encoding status
 * 
 * This is a reference implementation for 3speak.tv developers.
 */

class DemoApp {
    constructor() {
        // Initialize modules
        this.auth = new KeychainAuth();
        this.uploadClient = new UploadClient();
        
        // State
        this.currentVideoId = null;
        this.uploadStartTime = null;
        
        // Initialize
        this.init();
    }

    /**
     * Initialize application
     */
    init() {
        console.log('3Speak Upload Demo initialized');
        
        // Initialize auth
        this.auth.init();
        
        // Setup event listeners
        this.setupEventListeners();
        
        // Show login page
        this.showLoginPage();
    }

    /**
     * Setup all event listeners
     */
    setupEventListeners() {
        // Login form
        const loginForm = document.getElementById('login-form');
        loginForm.addEventListener('submit', (e) => {
            e.preventDefault();
            this.handleLogin();
        });

        // Logout button
        const logoutBtn = document.getElementById('logout-btn');
        logoutBtn.addEventListener('click', () => {
            this.handleLogout();
        });

        // Upload form
        const uploadForm = document.getElementById('upload-form');
        uploadForm.addEventListener('submit', (e) => {
            e.preventDefault();
            this.handleUpload();
        });

        // Upload another button
        const uploadAnotherBtn = document.getElementById('upload-another-btn');
        uploadAnotherBtn.addEventListener('click', () => {
            this.resetUploadForm();
        });

        // File input - show file info
        const videoFileInput = document.getElementById('video-file');
        videoFileInput.addEventListener('change', (e) => {
            this.handleFileSelect(e);
        });

        // Thumbnail input - show file info
        const thumbnailInput = document.getElementById('video-thumbnail');
        thumbnailInput.addEventListener('change', (e) => {
            this.handleThumbnailSelect(e);
        });
    }

    /**
     * Handle login with Keychain
     */
    async handleLogin() {
        const username = document.getElementById('username').value.trim();
        const loginBtn = document.getElementById('keychain-login-btn');
        
        // Disable button during login
        loginBtn.disabled = true;
        loginBtn.textContent = 'Connecting to Keychain...';
        loginBtn.classList.add('loading');

        try {
            await this.auth.login(username);
            
            // Login successful - show upload page
            setTimeout(() => {
                this.showUploadPage();
            }, 1000);
            
        } catch (error) {
            console.error('Login error:', error);
            // Error already displayed by KeychainAuth
        } finally {
            loginBtn.disabled = false;
            loginBtn.textContent = '🔑 Login with Keychain';
            loginBtn.classList.remove('loading');
        }
    }

    /**
     * Handle logout
     */
    handleLogout() {
        this.auth.logout();
        this.uploadClient.cancelUpload();
        this.currentVideoId = null;
        this.showLoginPage();
        
        // Reset forms
        document.getElementById('login-form').reset();
        document.getElementById('upload-form').reset();
    }

    /**
     * Handle file selection
     */
    handleFileSelect(event) {
        const file = event.target.files[0];
        if (!file) return;

        console.log('Video file selected:', {
            name: file.name,
            size: this.uploadClient.formatBytes(file.size),
            type: file.type
        });

        // Could add file validation here
        if (!file.type.startsWith('video/')) {
            alert('Please select a valid video file');
            event.target.value = '';
        }
    }

    /**
     * Handle thumbnail selection
     */
    handleThumbnailSelect(event) {
        const file = event.target.files[0];
        if (!file) return;

        console.log('Thumbnail file selected:', {
            name: file.name,
            size: this.uploadClient.formatBytes(file.size),
            type: file.type
        });

        // Validate image file
        if (!file.type.startsWith('image/')) {
            alert('Please select a valid image file (JPG, PNG, etc.)');
            event.target.value = '';
        }
    }

    /**
     * Get video duration from file
     * @param {File} file - Video file
     * @returns {Promise<number>} Duration in seconds
     */
    getVideoDuration(file) {
        return new Promise((resolve, reject) => {
            const video = document.createElement('video');
            video.preload = 'metadata';
            
            video.onloadedmetadata = function() {
                // Wait a bit for duration to be available
                setTimeout(() => {
                    window.URL.revokeObjectURL(video.src);
                    const duration = video.duration;
                    
                    if (isNaN(duration) || !isFinite(duration) || duration === 0) {
                        console.warn('Could not detect video duration, using default');
                        resolve(60); // Fallback to 60 seconds
                    } else {
                        console.log(`✅ Video duration detected: ${duration.toFixed(2)} seconds`);
                        resolve(duration);
                    }
                }, 200); // Small delay to ensure duration is loaded
            };
            
            video.onerror = function(e) {
                console.error('Error loading video metadata:', e);
                window.URL.revokeObjectURL(video.src);
                resolve(60); // Fallback to 60 seconds
            };
            
            // Set timeout in case metadata never loads
            setTimeout(() => {
                if (video.duration && isFinite(video.duration) && video.duration > 0) {
                    console.log(`✅ Video duration detected (timeout): ${video.duration.toFixed(2)} seconds`);
                    resolve(video.duration);
                } else {
                    console.warn('Timeout waiting for video duration, using default');
                    window.URL.revokeObjectURL(video.src);
                    resolve(60);
                }
            }, 5000); // 5 second timeout
            
            video.src = window.URL.createObjectURL(file);
        });
    }

    /**
     * Handle video upload
     */
    async handleUpload() {
        const username = this.auth.getCurrentUser();
        if (!username) {
            alert('Not authenticated');
            return;
        }

        // Get form data
        const videoFile = document.getElementById('video-file').files[0];
        const title = document.getElementById('video-title').value.trim();
        const description = document.getElementById('video-description').value.trim();
        const tagsInput = document.getElementById('video-tags').value.trim();
        const thumbnailFile = document.getElementById('video-thumbnail').files[0];
        const community = document.getElementById('video-community').value;
        const declineRewards = document.getElementById('decline-rewards').checked;

        // Validate
        if (!videoFile) {
            alert('Please select a video file');
            return;
        }

        if (!title || !description) {
            alert('Please fill in title and description');
            return;
        }

        // Parse tags
        const tags = tagsInput ? tagsInput.split(',').map(t => t.trim()).filter(t => t) : [];

        // Show progress section
        this.showProgressSection();
        this.updateStatus('Preparing upload...', 0);
        this.uploadStartTime = Date.now();

        try {
            // Get actual video duration
            this.addStatusMessage('Analyzing video file...');
            const duration = await this.getVideoDuration(videoFile);
            console.log(`📹 Video duration detected: ${duration} seconds`);
            
            const videoData = {
                owner: username,
                title: title,
                description: description,
                tags: tags,
                size: videoFile.size,
                duration: Math.round(duration), // Actual duration in seconds
                originalFilename: videoFile.name,
                community: community || undefined,
                declineRewards: declineRewards
            };            // Step 1: Prepare upload (create DB entry)
            this.addStatusMessage('Creating video entry...');
            const prepareResult = await this.uploadClient.prepareUpload(username, videoData);
            this.currentVideoId = prepareResult.video_id;
            
            this.addStatusMessage(`✅ Video entry created (ID: ${prepareResult.video_id})`);
            this.addStatusMessage(`📝 Permlink: ${prepareResult.permlink}`);

            // Step 2: Upload thumbnail if provided
            if (thumbnailFile) {
                this.updateStatus('Uploading thumbnail...', 5);
                this.addStatusMessage('Uploading thumbnail to IPFS...');
                console.log('📸 Uploading thumbnail file:', thumbnailFile.name);
                
                const thumbnailResult = await this.uploadClient.uploadThumbnail(
                    username,
                    this.currentVideoId,
                    thumbnailFile
                );
                
                this.addStatusMessage(`✅ Thumbnail uploaded: ${thumbnailResult.data.thumbnail_url}`);
            } else {
                console.warn('⚠️ No thumbnail file selected');
                this.addStatusMessage('ℹ️ No thumbnail selected - using 3Speak default');
            }

            // Step 3: Upload video file via TUS
            this.updateStatus('Uploading video...', 10);
            this.addStatusMessage('Starting TUS resumable upload...');

            this.uploadClient.uploadVideo(
                videoFile,
                prepareResult.metadata,
                // Progress callback
                (percentage, uploaded, total) => {
                    const progress = 10 + (percentage * 0.6); // 10-70% for upload
                    this.updateStatus(
                        `Uploading video... ${this.uploadClient.formatBytes(uploaded)} / ${this.uploadClient.formatBytes(total)}`,
                        progress
                    );
                },
                // Success callback
                () => {
                    this.updateStatus('Upload complete! Processing...', 75);
                    this.addStatusMessage('✅ Video upload completed');
                    this.addStatusMessage('🔄 Processing and uploading to IPFS...');
                    
                    // Start polling for encoding status
                    setTimeout(() => {
                        this.startEncodingStatusPolling();
                    }, 3000);
                },
                // Error callback
                (error) => {
                    this.updateStatus('Upload failed', 0);
                    this.addStatusMessage(`❌ Upload error: ${error.message}`, 'error');
                    console.error('Upload error:', error);
                }
            );

        } catch (error) {
            console.error('Upload preparation error:', error);
            this.addStatusMessage(`❌ Error: ${error.message}`, 'error');
            this.updateStatus('Upload failed', 0);
        }
    }

    /**
     * Start polling for encoding status
     */
    startEncodingStatusPolling() {
        const username = this.auth.getCurrentUser();
        
        this.uploadClient.startStatusPolling(
            this.currentVideoId,
            username,
            (statusData) => {
                this.handleStatusUpdate(statusData);
            },
            5000 // Poll every 5 seconds
        );
    }

    /**
     * Handle status update from polling
     */
    handleStatusUpdate(statusData) {
        const { video, job } = statusData.data;
        
        console.log('Status update:', video.status, video.encodingProgress);

        // Update based on status
        switch (video.status) {
            case 'encoding_ipfs':
                if (job && job.status === 'queued') {
                    this.updateStatus('Queued for encoding...', 80);
                    this.addStatusMessage('⏳ Waiting for encoder...');
                } else if (job && job.status === 'running') {
                    const progress = job.progress?.pct || video.encodingProgress || 0;
                    const displayProgress = 80 + (progress * 0.15); // 80-95%
                    this.updateStatus(`Encoding... ${progress.toFixed(1)}%`, displayProgress);
                    this.addStatusMessage(`🎬 Encoding in progress: ${progress.toFixed(1)}%`);
                }
                break;

            case 'publish_manual':
            case 'published':
                this.updateStatus('Complete!', 100);
                this.addStatusMessage('✅ Encoding complete!');
                this.addStatusMessage('🎉 Video ready on 3Speak!');
                this.showCompletionInfo(video);
                break;

            case 'encoding_failed':
                this.updateStatus('Encoding failed', 0);
                this.addStatusMessage('❌ Encoding failed', 'error');
                break;
        }
    }

    /**
     * Show completion information
     */
    showCompletionInfo(video) {
        const completionSection = document.getElementById('completion-section');
        completionSection.classList.remove('hidden');

        document.getElementById('video-id').textContent = video._id || this.currentVideoId;
        document.getElementById('video-permlink').textContent = video.permlink || 'N/A';
        document.getElementById('video-ipfs').textContent = video.filename || 'Processing...';

        // Calculate total time
        const totalTime = ((Date.now() - this.uploadStartTime) / 1000).toFixed(0);
        this.addStatusMessage(`⏱️ Total time: ${this.uploadClient.formatDuration(totalTime)}`);
    }

    /**
     * Update status display
     */
    updateStatus(message, percentage) {
        document.getElementById('status-text').textContent = message;
        document.getElementById('progress-fill').style.width = percentage + '%';
        document.getElementById('progress-percentage').textContent = percentage.toFixed(1) + '%';
    }

    /**
     * Add message to status timeline
     */
    addStatusMessage(message, type = 'info') {
        const messagesContainer = document.getElementById('status-messages');
        const timestamp = new Date().toLocaleTimeString();
        
        const messageDiv = document.createElement('div');
        messageDiv.className = `status-message-item ${type}`;
        messageDiv.innerHTML = `
            <span class="timestamp">[${timestamp}]</span> ${message}
        `;
        
        messagesContainer.appendChild(messageDiv);
        messagesContainer.scrollTop = messagesContainer.scrollHeight;
    }

    /**
     * Show/hide page sections
     */
    showLoginPage() {
        document.getElementById('login-page').classList.remove('hidden');
        document.getElementById('upload-page').classList.add('hidden');
    }

    showUploadPage() {
        document.getElementById('login-page').classList.add('hidden');
        document.getElementById('upload-page').classList.remove('hidden');
        
        // Update username display
        document.getElementById('logged-user').textContent = '@' + this.auth.getCurrentUser();
    }

    showProgressSection() {
        document.getElementById('progress-section').classList.remove('hidden');
        document.getElementById('completion-section').classList.add('hidden');
        
        // Disable form during upload
        document.getElementById('upload-btn').disabled = true;
        document.getElementById('upload-form').querySelectorAll('input, textarea, select').forEach(el => {
            el.disabled = true;
        });
    }

    resetUploadForm() {
        // Reset form
        document.getElementById('upload-form').reset();
        document.getElementById('progress-section').classList.add('hidden');
        
        // Re-enable form
        document.getElementById('upload-btn').disabled = false;
        document.getElementById('upload-form').querySelectorAll('input, textarea, select').forEach(el => {
            el.disabled = false;
        });

        // Clear status messages
        document.getElementById('status-messages').innerHTML = '';
        
        // Reset state
        this.currentVideoId = null;
        this.uploadStartTime = null;
        this.uploadClient.cancelUpload();
    }
}

// Initialize app when DOM is ready
document.addEventListener('DOMContentLoaded', () => {
    window.demoApp = new DemoApp();
});
