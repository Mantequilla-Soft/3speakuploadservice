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
        // Method tab switching
        document.getElementById('tab-traditional').addEventListener('click', () => {
            this.switchToTraditionalFlow();
        });
        
        document.getElementById('tab-upload-first').addEventListener('click', () => {
            this.switchToUploadFirstFlow();
        });
        
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

        // In-progress refresh button
        const refreshProgressBtn = document.getElementById('refresh-progress-btn');
        refreshProgressBtn.addEventListener('click', () => {
            this.checkInProgressVideos();
        });

        // Traditional upload form
        const uploadForm = document.getElementById('upload-form');
        uploadForm.addEventListener('submit', (e) => {
            e.preventDefault();
            this.handleUpload();
        });

        // Upload-first form
        const uploadFirstForm = document.getElementById('upload-first-form');
        uploadFirstForm.addEventListener('submit', (e) => {
            e.preventDefault();
            this.handleUploadFirstFinalize();
        });

        // Upload another buttons
        const uploadAnotherBtn = document.getElementById('upload-another-btn');
        uploadAnotherBtn.addEventListener('click', () => {
            this.resetUploadForm();
        });
        
        const uploadAnotherFirstBtn = document.getElementById('upload-another-first-btn');
        uploadAnotherFirstBtn.addEventListener('click', () => {
            this.resetUploadFirstForm();
        });

        // Traditional file input
        const videoFileInput = document.getElementById('video-file');
        videoFileInput.addEventListener('change', (e) => {
            this.handleFileSelect(e);
        });

        // Upload-first file input - start upload immediately
        const videoFileFirstInput = document.getElementById('video-file-first');
        videoFileFirstInput.addEventListener('change', (e) => {
            this.handleUploadFirstStart(e);
        });

        // Thumbnail inputs
        const thumbnailInput = document.getElementById('video-thumbnail');
        thumbnailInput.addEventListener('change', (e) => {
            this.handleThumbnailSelect(e);
        });
        
        const thumbnailFirstInput = document.getElementById('video-thumbnail-first');
        thumbnailFirstInput.addEventListener('change', (e) => {
            this.handleThumbnailSelect(e);
        });
    }
    
    /**
     * Switch to traditional upload flow
     */
    switchToTraditionalFlow() {
        document.getElementById('tab-traditional').classList.add('active');
        document.getElementById('tab-upload-first').classList.remove('active');
        document.getElementById('traditional-flow').classList.remove('hidden');
        document.getElementById('upload-first-flow').classList.add('hidden');
    }
    
    /**
     * Switch to upload-first flow
     */
    switchToUploadFirstFlow() {
        document.getElementById('tab-upload-first').classList.add('active');
        document.getElementById('tab-traditional').classList.remove('active');
        document.getElementById('upload-first-flow').classList.remove('hidden');
        document.getElementById('traditional-flow').classList.add('hidden');
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
                // Check for in-progress videos after login
                this.checkInProgressVideos();
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
        
        console.log('Status update:', video.status, video.encodingProgress, 'Job:', job);

        // Update based on status
        switch (video.status) {
            case 'uploaded':
                this.updateStatus('Waiting for encoding to start...', 75);
                this.addStatusMessage('📤 Upload complete - queued for encoding');
                break;
                
            case 'encoding_ipfs':
                if (job && job.status === 'queued') {
                    this.updateStatus('Queued for encoding...', 80);
                    this.addStatusMessage('⏳ Waiting for encoder...');
                } else if (job && job.status === 'running') {
                    const progress = job.progress?.pct || video.encodingProgress || 0;
                    const displayProgress = 80 + (progress * 0.15); // 80-95%
                    this.updateStatus(`Encoding... ${progress.toFixed(1)}%`, displayProgress);
                    this.addStatusMessage(`🎬 Encoding in progress: ${progress.toFixed(1)}%`);
                } else {
                    this.updateStatus('Processing on IPFS...', 78);
                    this.addStatusMessage('☁️ Uploading to IPFS...');
                }
                break;
            
            case 'encoding_preparing':
                this.updateStatus('Preparing encoding job...', 82);
                this.addStatusMessage('⚙️ Encoder preparing job...');
                break;
                
            case 'encoding_progress':
                const encProgress = job?.progress?.pct || video.encodingProgress || 0;
                const displayProg = 80 + (encProgress * 0.15);
                this.updateStatus(`Encoding... ${encProgress.toFixed(1)}%`, displayProg);
                this.addStatusMessage(`🎬 Encoding: ${encProgress.toFixed(1)}%`);
                break;
                
            case 'encoding_completed':
                this.updateStatus('Encoding complete!', 98);
                this.addStatusMessage('✅ Encoding complete! Publishing...');
                break;

            case 'publish_manual':
            case 'published':
                this.updateStatus('Complete!', 100);
                this.addStatusMessage('✅ Encoding complete!');
                this.addStatusMessage('🎉 Video ready on 3Speak!');
                this.showCompletionInfo(video);
                break;

            case 'failed':
            case 'encoding_failed':
                this.updateStatus('Encoding failed', 0);
                this.addStatusMessage('❌ Encoding failed', 'error');
                break;
                
            default:
                this.updateStatus(`Status: ${video.status}`, 80);
                this.addStatusMessage(`📊 Status: ${video.status}`);
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
    
    /**
     * Reset upload-first form
     */
    resetUploadFirstForm() {
        document.getElementById('upload-first-form').reset();
        document.getElementById('progress-first-section').classList.add('hidden');
        document.getElementById('upload-first-status').classList.add('hidden');
        
        const finalizeBtn = document.getElementById('finalize-btn');
        finalizeBtn.disabled = true;
        finalizeBtn.textContent = '⏳ Waiting for upload to complete...';
        
        document.getElementById('upload-first-form').querySelectorAll('input, textarea, select').forEach(el => {
            el.disabled = false;
        });
        
        this.uploadFirstData = null;
        this.currentVideoId = null;
        this.uploadStartTime = null;
        this.uploadClient.cancelUpload();
    }
    
    /**
     * Handle upload-first flow: start upload immediately
     */
    async handleUploadFirstStart(event) {
        const file = event.target.files[0];
        if (!file) return;
        
        console.log('Starting upload-first flow for:', file.name);
        this.uploadStartTime = Date.now();
        
        // Show upload status
        const statusDiv = document.getElementById('upload-first-status');
        statusDiv.classList.remove('hidden');
        document.getElementById('upload-first-text').textContent = `Uploading ${file.name}...`;
        
        try {
            // Step 1: Get video duration
            const duration = await this.uploadClient.getVideoDuration(file);
            console.log('Video duration:', duration);
            
            // Step 2: Initialize upload (get upload_id)
            document.getElementById('upload-first-text').textContent = 'Initializing upload...';
            
            const initResponse = await fetch('/api/upload/init', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'X-Hive-Username': this.auth.getCurrentUser()
                },
                body: JSON.stringify({
                    owner: this.auth.getCurrentUser(),
                    originalFilename: file.name,
                    size: file.size,
                    duration
                })
            });
            
            if (!initResponse.ok) {
                throw new Error('Failed to initialize upload');
            }
            
            const initData = await initResponse.json();
            console.log('Upload initialized:', initData.data.upload_id);
            
            // Store upload data for finalization
            this.uploadFirstData = {
                upload_id: initData.data.upload_id,
                duration,
                originalFilename: file.name
            };
            
            // Step 3: Start TUS upload
            document.getElementById('upload-first-text').textContent = 'Uploading to server...';
            
            // Set the TUS endpoint for the upload client
            this.uploadClient.tusEndpoint = initData.data.tus_endpoint;
            
            this.uploadClient.uploadVideo(
                file,
                {
                    upload_id: initData.data.upload_id
                },
                (percentage, bytesUploaded, bytesTotal) => {
                    document.getElementById('upload-first-progress').style.width = percentage + '%';
                    document.getElementById('upload-first-percentage').textContent = percentage + '%';
                    document.getElementById('upload-first-text').textContent = 
                        `Uploading ${file.name} (${percentage}%)`;
                },
                () => {
                    // Step 4: Upload complete - enable submit button
                    console.log('TUS upload complete, enabling finalize button');
                    
                    statusDiv.classList.add('completed');
                    document.getElementById('upload-first-text').textContent = '✅ Upload complete! Fill out the form and submit.';
                    
                    const finalizeBtn = document.getElementById('finalize-btn');
                    finalizeBtn.disabled = false;
                    finalizeBtn.textContent = '✅ Finalize Upload';
                },
                (error) => {
                    throw error;
                }
            );
            
        } catch (error) {
            console.error('Upload-first start error:', error);
            document.getElementById('upload-first-text').textContent = '❌ Upload failed: ' + error.message;
            statusDiv.classList.remove('completed');
            statusDiv.style.background = '#f8d7da';
            statusDiv.style.borderColor = '#dc3545';
        }
    }
    
    /**
     * Handle upload-first flow: finalize after form submission
     */
    async handleUploadFirstFinalize() {
        if (!this.uploadFirstData) {
            alert('Please select a video file first');
            return;
        }
        
        console.log('Finalizing upload:', this.uploadFirstData.upload_id);
        
        // Small delay to allow TUS callback to process
        await new Promise(resolve => setTimeout(resolve, 2000));
        
        // Show progress section
        document.getElementById('progress-first-section').classList.remove('hidden');
        document.getElementById('status-text-first').textContent = 'Creating video entry...';
        
        // Disable form
        document.getElementById('finalize-btn').disabled = true;
        document.getElementById('upload-first-form').querySelectorAll('input, textarea, select, button').forEach(el => {
            el.disabled = true;
        });
        
        try {
            // Collect form data
            const formData = new FormData();
            formData.append('upload_id', this.uploadFirstData.upload_id);
            formData.append('owner', this.auth.getCurrentUser());
            formData.append('title', document.getElementById('video-title-first').value);
            formData.append('description', document.getElementById('video-description-first').value);
            
            const tagsInput = document.getElementById('video-tags-first').value;
            if (tagsInput) {
                const tags = tagsInput.split(',').map(t => t.trim()).filter(t => t);
                tags.forEach(tag => formData.append('tags[]', tag));
            }
            
            const community = document.getElementById('video-community-first').value;
            if (community) {
                formData.append('community', community);
            }
            
            const thumbnail = document.getElementById('video-thumbnail-first').files[0];
            if (thumbnail) {
                formData.append('thumbnail', thumbnail);
            }
            
            const declineRewards = document.getElementById('decline-rewards-first').checked;
            formData.append('declineRewards', declineRewards);
            
            // Send finalize request with retry for TUS callback timing
            this.addStatusMessageFirst('📤 Sending finalize request...');
            
            let response;
            let retries = 0;
            const maxRetries = 3;
            
            while (retries < maxRetries) {
                response = await fetch('/api/upload/finalize', {
                    method: 'POST',
                    headers: {
                        'X-Hive-Username': this.auth.getCurrentUser()
                    },
                    body: formData
                });
                
                if (response.ok) {
                    break;
                }
                
                const errorData = await response.json();
                
                // If TUS not completed yet, wait and retry
                if (errorData.error === 'TUS upload not completed yet' && retries < maxRetries - 1) {
                    retries++;
                    this.addStatusMessageFirst(`⏳ Waiting for upload processing (attempt ${retries}/${maxRetries})...`);
                    await new Promise(resolve => setTimeout(resolve, 3000));
                    continue;
                }
                
                throw new Error(errorData.error || 'Finalize failed');
            }
            
            const result = await response.json();
            console.log('Finalize result:', result);
            
            this.currentVideoId = result.data.video_id;
            
            this.addStatusMessageFirst('✅ Video entry created!');
            this.addStatusMessageFirst('⏳ Processing IPFS upload and creating encoding job...');
            
            document.getElementById('status-text-first').textContent = 'Processing...';
            
            // Wait a moment for backend processing
            await new Promise(resolve => setTimeout(resolve, 2000));
            
            // Poll for status
            await this.pollVideoStatusFirst(this.currentVideoId);
            
        } catch (error) {
            console.error('Finalize error:', error);
            document.getElementById('status-text-first').textContent = 'Failed';
            this.addStatusMessageFirst('❌ Error: ' + error.message, 'error');
            
            // Re-enable form
            document.getElementById('finalize-btn').disabled = false;
            document.getElementById('upload-first-form').querySelectorAll('input, textarea, select, button').forEach(el => {
                el.disabled = false;
            });
        }
    }
    
    /**
     * Poll video status for upload-first flow
     */
    async pollVideoStatusFirst(videoId) {
        const maxAttempts = 60;
        let attempts = 0;
        let lastStatus = '';
        
        while (attempts < maxAttempts) {
            attempts++;
            
            try {
                const response = await fetch(`/api/upload/video/${videoId}/status`, {
                    headers: {
                        'X-Hive-Username': this.auth.getCurrentUser()
                    }
                });
                
                if (!response.ok) {
                    throw new Error('Status check failed');
                }
                
                const result = await response.json();
                const video = result.data.video;
                const job = result.data.job;
                
                console.log('Video status:', video.status, 'Job:', job);
                
                // Update status text
                const statusLabel = this.getStatusLabelFirst(video.status, video.encodingProgress, job);
                document.getElementById('status-text-first').textContent = statusLabel;
                
                // Add status message on status change OR progress update
                const currentJobStatus = job?.status || 'none';
                const currentProgress = job?.progress?.pct?.toFixed(0) || '0';
                const statusKey = `${video.status}-${currentJobStatus}-${currentProgress}`;
                
                if (statusKey !== lastStatus) {
                    this.addStatusMessageFirst(`📊 ${statusLabel}`);
                    lastStatus = statusKey;
                }
                
                // Check for completion - either video status OR job status indicates complete
                if (video.status === 'published' || video.status === 'encoding_completed' || 
                    job?.status === 'complete' || job?.status === 'completed') {
                    this.addStatusMessageFirst('✅ Video encoding complete!', 'success');
                    this.showCompletionInfoFirst(video);
                    return;
                }
                
                if (video.status === 'failed' || video.status === 'encoding_failed' || job?.status === 'failed') {
                    this.addStatusMessageFirst('❌ Encoding failed', 'error');
                    return;
                }
                
                // Wait 5 seconds before next poll
                await new Promise(resolve => setTimeout(resolve, 5000));
                
            } catch (error) {
                console.error('Status poll error:', error);
                // Wait 5 seconds before retry
                await new Promise(resolve => setTimeout(resolve, 5000));
            }
        }
        
        // Max attempts reached
        this.addStatusMessageFirst('⏰ Status polling timeout - check back later', 'warning');
    }

    /**
     * Get human-readable status label
     * Derives status from both video and job states
     */
    getStatusLabelFirst(status, encodingProgress, job) {
        // If we have job info, use job status for more accurate progress
        if (job) {
            const jobStatus = job.status;
            const downloadPct = job.progress?.download_pct || 0;
            const encodePct = job.progress?.pct || 0;
            
            switch (jobStatus) {
                case 'queued':
                    return '⏳ Waiting for encoder to pick up job...';
                case 'running':
                    if (downloadPct < 100) {
                        return `📥 Downloading from IPFS: ${downloadPct.toFixed(0)}%`;
                    } else if (encodePct > 0) {
                        return `🎬 Encoding: ${encodePct.toFixed(1)}%`;
                    } else {
                        return '⚙️ Encoder processing...';
                    }
                case 'complete':
                    return '✅ Encoding complete! Publishing...';
                case 'completed':
                    return '✅ Encoding complete! Publishing...';
                case 'failed':
                    return '❌ Encoding failed';
                case 'cancelled':
                    return '🚫 Job cancelled';
            }
        }
        
        // Fallback to video status if no job info
        const labels = {
            'uploaded': '📤 Uploaded - Creating encoding job...',
            'encoding_ipfs': '☁️ Uploading to IPFS...',
            'encoding_preparing': '⚙️ Preparing encoding job...',
            'encoding_progress': `🎬 Encoding in progress... ${encodingProgress || 0}%`,
            'encoding_completed': '✅ Encoding complete!',
            'published': '🎉 Published to Hive!',
            'failed': '❌ Failed',
            'encoding_failed': '❌ Encoding failed'
        };
        
        return labels[status] || `Status: ${status}`;
    }
    
    /**
     * Show completion info for upload-first flow
     */
    showCompletionInfoFirst(video) {
        const completionSection = document.getElementById('completion-section-first');
        completionSection.classList.remove('hidden');

        document.getElementById('video-id-first').textContent = video._id || this.currentVideoId;
        document.getElementById('video-permlink-first').textContent = video.permlink || 'N/A';
        document.getElementById('video-ipfs-first').textContent = video.filename || 'Processing...';

        const totalTime = ((Date.now() - this.uploadStartTime) / 1000).toFixed(0);
        this.addStatusMessageFirst(`⏱️ Total time: ${this.uploadClient.formatDuration(totalTime)}`);
    }
    
    /**
     * Add message to upload-first status timeline
     */
    addStatusMessageFirst(message, type = 'info') {
        const messagesContainer = document.getElementById('status-messages-first');
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
     * Check for in-progress videos
     */
    async checkInProgressVideos() {
        try {
            const response = await fetch('/api/upload/in-progress', {
                headers: {
                    'X-Hive-Username': this.auth.getCurrentUser()
                }
            });

            if (!response.ok) {
                throw new Error('Failed to fetch in-progress videos');
            }

            const result = await response.json();
            
            if (!result.success) {
                console.error('In-progress check failed:', result.error);
                return;
            }

            const { videos, count } = result.data;
            
            if (count === 0) {
                this.hideInProgressBanner();
            } else {
                this.showInProgressBanner(videos);
            }

        } catch (error) {
            console.error('In-progress check error:', error);
            // Don't show error to user - this is optional feature
        }
    }

    /**
     * Show in-progress videos banner
     */
    showInProgressBanner(videos) {
        const banner = document.getElementById('in-progress-banner');
        const list = document.getElementById('in-progress-list');
        
        // Clear existing items
        list.innerHTML = '';
        
        // Add each video
        videos.forEach(video => {
            const item = this.createProgressItem(video);
            list.appendChild(item);
        });
        
        // Show banner
        banner.classList.remove('hidden');
    }

    /**
     * Hide in-progress videos banner
     */
    hideInProgressBanner() {
        const banner = document.getElementById('in-progress-banner');
        banner.classList.add('hidden');
    }

    /**
     * Create progress item element
     */
    createProgressItem(video) {
        const item = document.createElement('div');
        item.className = 'progress-item';
        item.dataset.videoId = video.video_id;
        
        const statusLabels = {
            'uploaded': 'Uploaded',
            'encoding_ipfs': 'Uploading to IPFS',
            'encoding_preparing': 'Preparing Encode',
            'encoding_progress': 'Encoding'
        };
        
        const progress = video.encoding_progress || 0;
        const createdDate = new Date(video.created);
        const timeAgo = this.getTimeAgo(createdDate);
        
        item.innerHTML = `
            <div class="progress-header">
                <div>
                    <h4 class="progress-title">${this.escapeHtml(video.title)}</h4>
                    <div class="progress-meta">
                        <span>Uploaded ${timeAgo}</span>
                        ${video.job_id ? `<span> • Job: ${video.job_id.substring(0, 8)}...</span>` : ''}
                    </div>
                </div>
                <span class="progress-status-badge ${video.status}">
                    ${statusLabels[video.status] || video.status}
                </span>
            </div>
            
            <div class="progress-bar-container">
                <div class="progress-bar-fill" style="width: ${progress}%"></div>
            </div>
            
            <div class="progress-text">
                <span>${statusLabels[video.status] || video.status}</span>
                <span><strong>${progress}%</strong></span>
            </div>
        `;
        
        return item;
    }

    /**
     * Get time ago string
     */
    getTimeAgo(date) {
        const seconds = Math.floor((new Date() - date) / 1000);
        
        if (seconds < 60) return 'just now';
        
        const minutes = Math.floor(seconds / 60);
        if (minutes < 60) return `${minutes}m ago`;
        
        const hours = Math.floor(minutes / 60);
        if (hours < 24) return `${hours}h ago`;
        
        const days = Math.floor(hours / 24);
        return `${days}d ago`;
    }

    /**
     * Escape HTML to prevent XSS
     */
    escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }
}

// Initialize app when DOM is ready
document.addEventListener('DOMContentLoaded', () => {
    window.demoApp = new DemoApp();
});
