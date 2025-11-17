// Storage Management Client
class StorageManager {
    constructor() {
        this.credentials = null;
        this.selectedCIDs = new Set();
        this.pinnedFiles = [];
        this.init();
    }

    init() {
        // Check for stored credentials
        const stored = sessionStorage.getItem('storage_credentials');
        if (stored) {
            this.credentials = stored;
            this.showDashboard();
            this.loadAllData();
        } else {
            this.showLogin();
        }

        this.attachEventListeners();
    }

    attachEventListeners() {
        // Login
        document.getElementById('login-form').addEventListener('submit', (e) => {
            e.preventDefault();
            this.handleLogin();
        });

        // Logout
        document.getElementById('logout-btn').addEventListener('click', () => {
            this.handleLogout();
        });

        // Refresh
        document.getElementById('refresh-btn').addEventListener('click', () => {
            this.loadAllData();
        });

        // Search
        document.getElementById('search-input').addEventListener('input', (e) => {
            this.filterTable(e.target.value);
        });

        // Select all
        document.getElementById('select-all').addEventListener('change', (e) => {
            this.handleSelectAll(e.target.checked);
        });

        // Unpin selected
        document.getElementById('unpin-selected-btn').addEventListener('click', () => {
            this.unpinSelected();
        });

        // Run GC
        document.getElementById('run-gc-btn').addEventListener('click', () => {
            this.runGarbageCollection();
        });

        // Modal
        document.getElementById('modal-cancel').addEventListener('click', () => {
            this.hideModal();
        });
    }

    showLogin() {
        document.getElementById('login-screen').style.display = 'flex';
        document.getElementById('dashboard').style.display = 'none';
    }

    showDashboard() {
        document.getElementById('login-screen').style.display = 'none';
        document.getElementById('dashboard').style.display = 'block';
    }

    async handleLogin() {
        const username = document.getElementById('username').value;
        const password = document.getElementById('password').value;
        const errorEl = document.getElementById('login-error');

        // Create Basic Auth credentials
        this.credentials = btoa(`${username}:${password}`);

        try {
            // Test credentials
            const response = await fetch('/api/storage/stats', {
                headers: {
                    'Authorization': `Basic ${this.credentials}`
                }
            });

            if (response.ok) {
                sessionStorage.setItem('storage_credentials', this.credentials);
                errorEl.style.display = 'none';
                this.showDashboard();
                this.loadAllData();
            } else {
                throw new Error('Invalid credentials');
            }
        } catch (error) {
            errorEl.textContent = '❌ ' + error.message;
            errorEl.style.display = 'block';
            this.credentials = null;
        }
    }

    handleLogout() {
        sessionStorage.removeItem('storage_credentials');
        this.credentials = null;
        this.showLogin();
        document.getElementById('username').value = '';
        document.getElementById('password').value = '';
    }

    async fetchAPI(endpoint, options = {}) {
        const response = await fetch(endpoint, {
            ...options,
            headers: {
                ...options.headers,
                'Authorization': `Basic ${this.credentials}`,
                'Content-Type': 'application/json'
            }
        });

        if (response.status === 401) {
            this.handleLogout();
            throw new Error('Authentication failed');
        }

        const data = await response.json();
        if (!response.ok) {
            throw new Error(data.error || 'Request failed');
        }

        return data;
    }

    async loadAllData() {
        try {
            await Promise.all([
                this.loadStats(),
                this.loadPinnedFiles(),
                this.loadUnpinnedFiles()
            ]);
            this.updateTimestamp();
        } catch (error) {
            console.error('Error loading data:', error);
            alert('❌ Error loading data: ' + error.message);
        }
    }

    async loadStats() {
        const data = await this.fetchAPI('/api/storage/stats');
        this.displayStats(data.data);
    }

    displayStats(stats) {
        // Disk stats
        document.getElementById('disk-total').textContent = this.formatBytes(stats.disk.total);
        document.getElementById('disk-available').textContent = `Available: ${this.formatBytes(stats.disk.available)}`;

        // IPFS stats
        document.getElementById('ipfs-size').textContent = this.formatBytes(stats.ipfs.repoSize);
        document.getElementById('ipfs-objects').textContent = `Objects: ${stats.ipfs.numObjects.toLocaleString()}`;

        // Usage percentage
        const percent = stats.disk.percentUsed;
        document.getElementById('usage-percent').textContent = `${percent}%`;
        
        const progressFill = document.getElementById('progress-fill');
        progressFill.style.width = `${percent}%`;
        progressFill.className = 'progress-fill ' + stats.status.color;

        // Status card color
        const statusCard = document.getElementById('status-card');
        statusCard.className = 'stat-card status-' + stats.status.color;
    }

    async loadPinnedFiles() {
        const tbody = document.getElementById('pinned-tbody');
        tbody.innerHTML = '<tr><td colspan="6" class="loading">Loading pinned files...</td></tr>';

        const data = await this.fetchAPI('/api/storage/pinned');
        this.pinnedFiles = data.data;
        this.displayPinnedFiles(this.pinnedFiles);
    }

    displayPinnedFiles(files) {
        const tbody = document.getElementById('pinned-tbody');
        
        if (files.length === 0) {
            tbody.innerHTML = '<tr><td colspan="6" class="loading">No pinned files found</td></tr>';
            return;
        }

        tbody.innerHTML = files.map(file => {
            const age = this.calculateAge(file.timestamp);
            const canUnpin = age.hours >= 24;
            const ageClass = age.hours < 24 ? 'age-new' : age.days < 7 ? 'age-recent' : 'age-old';

            return `
                <tr class="${canUnpin ? '' : 'safe-mode'}" data-cid="${file.cid}">
                    <td>
                        <input type="checkbox" 
                               class="file-checkbox" 
                               value="${file.cid}"
                               ${canUnpin ? '' : 'disabled'}>
                    </td>
                    <td class="cid-cell" title="${file.cid}">${file.cid}</td>
                    <td>${this.formatBytes(file.size)}</td>
                    <td class="${ageClass}">${age.display}</td>
                    <td>${new Date(file.timestamp).toLocaleString()}</td>
                    <td>
                        <button class="btn btn-warning btn-sm" 
                                onclick="storageManager.unpinSingle('${file.cid}')"
                                ${canUnpin ? '' : 'disabled'}>
                            Unpin
                        </button>
                    </td>
                </tr>
            `;
        }).join('');

        // Attach checkbox listeners
        document.querySelectorAll('.file-checkbox').forEach(cb => {
            cb.addEventListener('change', (e) => {
                if (e.target.checked) {
                    this.selectedCIDs.add(e.target.value);
                } else {
                    this.selectedCIDs.delete(e.target.value);
                }
                this.updateSelectedCount();
            });
        });
    }

    calculateAge(timestamp) {
        const now = new Date();
        const then = new Date(timestamp);
        const diffMs = now - then;
        const diffHours = Math.floor(diffMs / (1000 * 60 * 60));
        const diffDays = Math.floor(diffHours / 24);

        let display;
        if (diffHours < 1) {
            display = '< 1 hour';
        } else if (diffHours < 24) {
            display = `${diffHours} hours`;
        } else {
            display = `${diffDays} days`;
        }

        return { hours: diffHours, days: diffDays, display };
    }

    filterTable(query) {
        const rows = document.querySelectorAll('#pinned-tbody tr');
        const lowerQuery = query.toLowerCase();

        rows.forEach(row => {
            const cid = row.dataset.cid;
            if (cid && cid.toLowerCase().includes(lowerQuery)) {
                row.style.display = '';
            } else {
                row.style.display = 'none';
            }
        });
    }

    handleSelectAll(checked) {
        document.querySelectorAll('.file-checkbox:not(:disabled)').forEach(cb => {
            cb.checked = checked;
            if (checked) {
                this.selectedCIDs.add(cb.value);
            } else {
                this.selectedCIDs.delete(cb.value);
            }
        });
        this.updateSelectedCount();
    }

    updateSelectedCount() {
        const count = this.selectedCIDs.size;
        document.getElementById('selected-count').textContent = count;
        document.getElementById('unpin-selected-btn').disabled = count === 0;
    }

    async unpinSelected() {
        if (this.selectedCIDs.size === 0) return;

        const cids = Array.from(this.selectedCIDs);
        this.showModal(
            '⚠️ Confirm Unpinning',
            `Are you sure you want to unpin ${cids.length} file(s)?<br><br>
            <strong>This will NOT immediately free space.</strong> 
            You must run garbage collection afterwards.`,
            async () => {
                await this.performUnpin(cids);
            }
        );
    }

    async unpinSingle(cid) {
        this.showModal(
            '⚠️ Confirm Unpinning',
            `Are you sure you want to unpin this file?<br><br>
            <code>${cid}</code><br><br>
            <strong>This will NOT immediately free space.</strong> 
            You must run garbage collection afterwards.`,
            async () => {
                await this.performUnpin([cid]);
            }
        );
    }

    async performUnpin(cids) {
        try {
            const data = await this.fetchAPI('/api/storage/unpin', {
                method: 'POST',
                body: JSON.stringify({ cids })
            });

            alert(`✅ ${data.message}`);
            this.selectedCIDs.clear();
            this.updateSelectedCount();
            document.getElementById('select-all').checked = false;
            await this.loadPinnedFiles();
        } catch (error) {
            alert('❌ Error unpinning files: ' + error.message);
        }
    }

    async loadUnpinnedFiles() {
        try {
            const data = await this.fetchAPI('/api/storage/unpinned');
            document.getElementById('reclaimable-space').textContent = 
                data.reclaimable.note || 'Run GC to see actual space freed';
        } catch (error) {
            console.error('Error loading unpinned files:', error);
        }
    }

    async runGarbageCollection() {
        this.showModal(
            '⚠️ Confirm Garbage Collection',
            `<strong>This operation will:</strong><br>
            • Remove all unpinned files from IPFS<br>
            • Free up disk space<br>
            • Take several minutes to complete<br><br>
            <strong style="color: var(--warning-color);">
            ⚠️ Recommended: Run during low-traffic periods
            </strong><br><br>
            Do you want to proceed?`,
            async () => {
                await this.performGC();
            }
        );
    }

    async performGC() {
        const progressEl = document.getElementById('gc-progress');
        const resultEl = document.getElementById('gc-result');
        const gcBtn = document.getElementById('run-gc-btn');

        progressEl.style.display = 'flex';
        resultEl.style.display = 'none';
        gcBtn.disabled = true;

        try {
            const data = await this.fetchAPI('/api/storage/gc', {
                method: 'POST'
            });

            resultEl.className = 'gc-result success';
            resultEl.innerHTML = `
                ✅ <strong>Garbage Collection Completed!</strong><br>
                Space freed: ${this.formatBytes(data.data.spaceFreed)}<br>
                Duration: ${(data.data.duration / 1000).toFixed(1)} seconds
            `;
            resultEl.style.display = 'block';

            document.getElementById('last-gc').textContent = new Date().toLocaleString();
            await this.loadAllData();
        } catch (error) {
            resultEl.className = 'gc-result error';
            resultEl.innerHTML = `❌ <strong>Error:</strong> ${error.message}`;
            resultEl.style.display = 'block';
        } finally {
            progressEl.style.display = 'none';
            gcBtn.disabled = false;
        }
    }

    showModal(title, message, onConfirm) {
        document.getElementById('modal-title').textContent = title;
        document.getElementById('modal-message').innerHTML = message;
        document.getElementById('modal').style.display = 'flex';

        const confirmBtn = document.getElementById('modal-confirm');
        const newConfirmBtn = confirmBtn.cloneNode(true);
        confirmBtn.parentNode.replaceChild(newConfirmBtn, confirmBtn);

        newConfirmBtn.addEventListener('click', async () => {
            this.hideModal();
            if (onConfirm) await onConfirm();
        });
    }

    hideModal() {
        document.getElementById('modal').style.display = 'none';
    }

    updateTimestamp() {
        document.getElementById('last-updated').textContent = 
            `Last updated: ${new Date().toLocaleTimeString()}`;
    }

    formatBytes(bytes, decimals = 2) {
        if (bytes === 0) return '0 Bytes';
        
        const k = 1024;
        const dm = decimals < 0 ? 0 : decimals;
        const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB'];
        const i = Math.floor(Math.log(bytes) / Math.log(k));
        
        return parseFloat((bytes / Math.pow(k, i)).toFixed(dm)) + ' ' + sizes[i];
    }
}

// Initialize
const storageManager = new StorageManager();
