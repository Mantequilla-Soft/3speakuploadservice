# Frontend Scheduling Implementation Cheat Sheet

**Quick Reference:** How to add scheduled post support to any 3Speak frontend

---

## Overview

This guide provides copy-paste ready code for implementing scheduled posts in your frontend. Based on the working implementation in `demo.html` and `demo-app.js`.

**Backend Requirements:**
- API accepts `publish_type` and `publish_data` parameters
- Validation: Minimum 1 hour ahead, maximum 90 days
- Falls back to immediate publish if validation fails

---

## 1. HTML Structure

### Add Checkbox and DateTime Picker

```html
<!-- Scheduling Toggle -->
<div class="form-group">
    <label class="checkbox-label">
        <input type="checkbox" id="schedule-post">
        <span>📅 Schedule for Later</span>
    </label>
    <small>Schedule this post to be published at a specific date and time</small>
</div>

<!-- DateTime Picker (Hidden by default) -->
<div id="schedule-datetime-group" class="form-group hidden">
    <label for="schedule-datetime">Publish Date & Time</label>
    <input 
        type="datetime-local" 
        id="schedule-datetime"
    >
    <small>Must be at least 1 hour in future, maximum 90 days</small>
</div>
```

### CSS for Hidden State

```css
.hidden {
    display: none;
}
```

---

## 2. JavaScript - Event Listeners

### Toggle DateTime Picker Visibility

```javascript
// Add to your initialization code
document.getElementById('schedule-post').addEventListener('change', (e) => {
    const group = document.getElementById('schedule-datetime-group');
    
    if (e.target.checked) {
        group.classList.remove('hidden');
        
        // Set min/max constraints
        const input = document.getElementById('schedule-datetime');
        const minDate = new Date(Date.now() + 60 * 60 * 1000); // +1 hour
        const maxDate = new Date(Date.now() + 90 * 24 * 60 * 60 * 1000); // +90 days
        
        input.min = formatDateTimeLocal(minDate);
        input.max = formatDateTimeLocal(maxDate);
    } else {
        group.classList.add('hidden');
    }
});
```

---

## 3. JavaScript - Helper Functions

### Format Date for datetime-local Input

```javascript
/**
 * Format JavaScript Date for HTML5 datetime-local input
 * @param {Date} date - JavaScript Date object
 * @returns {string} - Format: "YYYY-MM-DDTHH:MM"
 */
function formatDateTimeLocal(date) {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    const hours = String(date.getHours()).padStart(2, '0');
    const minutes = String(date.getMinutes()).padStart(2, '0');
    return `${year}-${month}-${day}T${hours}:${minutes}`;
}
```

### Extract Scheduling Parameters

```javascript
/**
 * Get scheduling parameters from form
 * @returns {Object} - { publish_type: 'publish'|'schedule', publish_data?: number }
 */
function getSchedulingParams() {
    const scheduleEnabled = document.getElementById('schedule-post').checked;
    
    // Not scheduling - immediate publish
    if (!scheduleEnabled) {
        return { publish_type: 'publish' };
    }

    // Get selected datetime
    const datetimeValue = document.getElementById('schedule-datetime').value;
    
    // Fallback if no datetime selected
    if (!datetimeValue) {
        console.warn('Schedule enabled but no datetime selected, falling back to publish');
        return { publish_type: 'publish' };
    }

    // Convert to Unix timestamp (seconds)
    const scheduledDate = new Date(datetimeValue);
    const publish_data = Math.floor(scheduledDate.getTime() / 1000);

    return {
        publish_type: 'schedule',
        publish_data: publish_data
    };
}
```

---

## 4. API Integration

### Traditional Flow: /api/upload/prepare

```javascript
async function prepareUpload() {
    // Collect form data
    const title = document.getElementById('title').value;
    const description = document.getElementById('description').value;
    const videoFile = document.getElementById('video-file').files[0];
    
    // Get scheduling parameters
    const schedulingParams = getSchedulingParams();
    
    // Prepare request payload
    const payload = {
        title: title,
        description: description,
        filename: videoFile.name,
        size: videoFile.size,
        ...schedulingParams  // ✨ Merge scheduling params
    };
    
    // Make API call
    const response = await fetch('/api/upload/prepare', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${token}`,
            'X-Hive-Username': username
        },
        body: JSON.stringify(payload)
    });
    
    const result = await response.json();
    return result;
}
```

### Upload-First Flow: /api/upload/finalize

```javascript
async function finalizeUpload(videoId) {
    // Collect metadata
    const title = document.getElementById('title-first').value;
    const description = document.getElementById('description-first').value;
    
    // Get scheduling parameters
    const schedulingParams = getSchedulingParams();
    
    // Prepare request payload
    const payload = {
        video_id: videoId,
        title: title,
        description: description,
        ...schedulingParams  // ✨ Merge scheduling params
    };
    
    // Make API call
    const response = await fetch('/api/upload/finalize', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${token}`,
            'X-Hive-Username': username
        },
        body: JSON.stringify(payload)
    });
    
    const result = await response.json();
    return result;
}
```

---

## 5. Complete Example (Vanilla JS)

### Full Implementation

```javascript
class UploadForm {
    constructor() {
        this.setupEventListeners();
    }
    
    setupEventListeners() {
        // Schedule checkbox toggle
        document.getElementById('schedule-post').addEventListener('change', (e) => {
            this.toggleScheduleDateTime(e.target.checked);
        });
        
        // Form submit
        document.getElementById('upload-form').addEventListener('submit', (e) => {
            e.preventDefault();
            this.handleSubmit();
        });
    }
    
    toggleScheduleDateTime(show) {
        const group = document.getElementById('schedule-datetime-group');
        
        if (show) {
            group.classList.remove('hidden');
            
            const input = document.getElementById('schedule-datetime');
            const minDate = new Date(Date.now() + 60 * 60 * 1000);
            const maxDate = new Date(Date.now() + 90 * 24 * 60 * 60 * 1000);
            
            input.min = this.formatDateTimeLocal(minDate);
            input.max = this.formatDateTimeLocal(maxDate);
        } else {
            group.classList.add('hidden');
        }
    }
    
    formatDateTimeLocal(date) {
        const year = date.getFullYear();
        const month = String(date.getMonth() + 1).padStart(2, '0');
        const day = String(date.getDate()).padStart(2, '0');
        const hours = String(date.getHours()).padStart(2, '0');
        const minutes = String(date.getMinutes()).padStart(2, '0');
        return `${year}-${month}-${day}T${hours}:${minutes}`;
    }
    
    getSchedulingParams() {
        const scheduleEnabled = document.getElementById('schedule-post').checked;
        if (!scheduleEnabled) {
            return { publish_type: 'publish' };
        }

        const datetimeValue = document.getElementById('schedule-datetime').value;
        if (!datetimeValue) {
            console.warn('Schedule enabled but no datetime selected');
            return { publish_type: 'publish' };
        }

        const scheduledDate = new Date(datetimeValue);
        const publish_data = Math.floor(scheduledDate.getTime() / 1000);

        return {
            publish_type: 'schedule',
            publish_data: publish_data
        };
    }
    
    async handleSubmit() {
        const title = document.getElementById('title').value;
        const description = document.getElementById('description').value;
        const schedulingParams = this.getSchedulingParams();
        
        const payload = {
            title,
            description,
            ...schedulingParams
        };
        
        console.log('Submitting with params:', payload);
        // Make your API call here
    }
}

// Initialize
new UploadForm();
```

---

## 6. Framework-Specific Examples

### React/Next.js

```jsx
import { useState } from 'react';

function SchedulingOptions() {
    const [isScheduled, setIsScheduled] = useState(false);
    const [scheduleDateTime, setScheduleDateTime] = useState('');
    
    // Set min/max constraints
    const minDate = new Date(Date.now() + 60 * 60 * 1000);
    const maxDate = new Date(Date.now() + 90 * 24 * 60 * 60 * 1000);
    
    const formatDateTimeLocal = (date) => {
        const year = date.getFullYear();
        const month = String(date.getMonth() + 1).padStart(2, '0');
        const day = String(date.getDate()).padStart(2, '0');
        const hours = String(date.getHours()).padStart(2, '0');
        const minutes = String(date.getMinutes()).padStart(2, '0');
        return `${year}-${month}-${day}T${hours}:${minutes}`;
    };
    
    const getSchedulingParams = () => {
        if (!isScheduled) {
            return { publish_type: 'publish' };
        }
        
        if (!scheduleDateTime) {
            return { publish_type: 'publish' };
        }
        
        const publish_data = Math.floor(new Date(scheduleDateTime).getTime() / 1000);
        return {
            publish_type: 'schedule',
            publish_data
        };
    };
    
    return (
        <div>
            <label>
                <input
                    type="checkbox"
                    checked={isScheduled}
                    onChange={(e) => setIsScheduled(e.target.checked)}
                />
                📅 Schedule for Later
            </label>
            
            {isScheduled && (
                <div>
                    <label>Publish Date & Time</label>
                    <input
                        type="datetime-local"
                        value={scheduleDateTime}
                        onChange={(e) => setScheduleDateTime(e.target.value)}
                        min={formatDateTimeLocal(minDate)}
                        max={formatDateTimeLocal(maxDate)}
                    />
                    <small>Must be at least 1 hour in future, maximum 90 days</small>
                </div>
            )}
        </div>
    );
}
```

### Vue 3

```vue
<template>
    <div>
        <label>
            <input 
                type="checkbox" 
                v-model="isScheduled"
            />
            📅 Schedule for Later
        </label>
        
        <div v-if="isScheduled">
            <label>Publish Date & Time</label>
            <input
                type="datetime-local"
                v-model="scheduleDateTime"
                :min="minDateTime"
                :max="maxDateTime"
            />
            <small>Must be at least 1 hour in future, maximum 90 days</small>
        </div>
    </div>
</template>

<script setup>
import { ref, computed } from 'vue';

const isScheduled = ref(false);
const scheduleDateTime = ref('');

const formatDateTimeLocal = (date) => {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    const hours = String(date.getHours()).padStart(2, '0');
    const minutes = String(date.getMinutes()).padStart(2, '0');
    return `${year}-${month}-${day}T${hours}:${minutes}`;
};

const minDateTime = computed(() => {
    const minDate = new Date(Date.now() + 60 * 60 * 1000);
    return formatDateTimeLocal(minDate);
});

const maxDateTime = computed(() => {
    const maxDate = new Date(Date.now() + 90 * 24 * 60 * 60 * 1000);
    return formatDateTimeLocal(maxDate);
});

const getSchedulingParams = () => {
    if (!isScheduled.value || !scheduleDateTime.value) {
        return { publish_type: 'publish' };
    }
    
    const publish_data = Math.floor(new Date(scheduleDateTime.value).getTime() / 1000);
    return {
        publish_type: 'schedule',
        publish_data
    };
};

defineExpose({ getSchedulingParams });
</script>
```

---

## 7. Validation Rules

### Client-Side (Browser)

- **Minimum:** 1 hour from current time
- **Maximum:** 90 days from current time
- **Format:** HTML5 `datetime-local` handles format validation

### Backend Validation

The backend will also validate and apply fallback logic:

```
IF publish_type === 'schedule' AND publish_data is provided:
    IF publish_data < (now + 1 hour):
        → Falls back to publish_type = 'publish'
    IF publish_data > (now + 90 days):
        → Falls back to publish_type = 'publish'
    OTHERWISE:
        → Accepts scheduled time
```

---

## 8. API Response

### Successful Response

```json
{
    "success": true,
    "message": "Video prepared successfully",
    "video_id": "abc123",
    "status": "scheduled",
    "publish_type": "schedule",
    "publish_data": 1735948800
}
```

### Database Entry

The video document in MongoDB will have:

```javascript
{
    _id: ObjectId("..."),
    owner: "username",
    title: "My Scheduled Video",
    status: "scheduled",          // ✅ Status
    publish_type: "schedule",     // ✅ Type
    publish_data: ISODate("2026-01-05T12:00:00Z")  // ✅ Future date
    // ... other fields
}
```

---

## 9. Testing Checklist

### Manual Testing Steps

1. **Immediate Publish (No Scheduling)**
   - [ ] Leave "Schedule for Later" unchecked
   - [ ] Submit form
   - [ ] Verify `publish_type: 'publish'` sent to API
   - [ ] Verify video status is NOT 'scheduled'

2. **Valid Scheduled Post**
   - [ ] Check "Schedule for Later"
   - [ ] Select date 2 hours in future
   - [ ] Submit form
   - [ ] Verify `publish_type: 'schedule'` sent to API
   - [ ] Verify `publish_data` is Unix timestamp
   - [ ] Verify video status is 'scheduled' in database

3. **Invalid - Too Soon (< 1 hour)**
   - [ ] Try to select datetime < 1 hour away
   - [ ] HTML5 validation should prevent submission
   - [ ] If bypassed, backend falls back to immediate publish

4. **Invalid - Too Far (> 90 days)**
   - [ ] Try to select datetime > 90 days away
   - [ ] HTML5 validation should prevent submission
   - [ ] If bypassed, backend falls back to immediate publish

5. **Edge Case - Checkbox Enabled but No Date**
   - [ ] Check "Schedule for Later"
   - [ ] Don't select a date
   - [ ] Submit form
   - [ ] Verify falls back to `publish_type: 'publish'`

---

## 10. Common Pitfalls

### ❌ Wrong: Sending timestamp in milliseconds

```javascript
// WRONG - JavaScript Date.getTime() returns milliseconds
const publish_data = new Date(datetimeValue).getTime();
```

### ✅ Right: Sending timestamp in seconds

```javascript
// CORRECT - Backend expects Unix timestamp in seconds
const publish_data = Math.floor(new Date(datetimeValue).getTime() / 1000);
```

---

### ❌ Wrong: Not handling empty datetime

```javascript
// WRONG - Will send invalid data
const publish_data = Math.floor(new Date(datetimeValue).getTime() / 1000);
return { publish_type: 'schedule', publish_data };
```

### ✅ Right: Fallback to immediate publish

```javascript
// CORRECT - Fallback if no datetime
if (!datetimeValue) {
    return { publish_type: 'publish' };
}
```

---

### ❌ Wrong: Hardcoded min/max dates

```javascript
// WRONG - Will be outdated immediately
<input type="datetime-local" min="2026-01-03T10:00">
```

### ✅ Right: Dynamic min/max calculation

```javascript
// CORRECT - Always relative to current time
const minDate = new Date(Date.now() + 60 * 60 * 1000);
input.min = formatDateTimeLocal(minDate);
```

---

## 11. Quick Copy-Paste Snippets

### Minimum Working Implementation

```html
<!-- HTML -->
<label>
    <input type="checkbox" id="schedule-post">
    Schedule for Later
</label>
<div id="schedule-group" class="hidden">
    <input type="datetime-local" id="schedule-datetime">
</div>
```

```javascript
// JavaScript
document.getElementById('schedule-post').addEventListener('change', (e) => {
    document.getElementById('schedule-group').classList.toggle('hidden', !e.target.checked);
});

function getSchedulingParams() {
    const enabled = document.getElementById('schedule-post').checked;
    const datetime = document.getElementById('schedule-datetime').value;
    
    if (!enabled || !datetime) return { publish_type: 'publish' };
    
    return {
        publish_type: 'schedule',
        publish_data: Math.floor(new Date(datetime).getTime() / 1000)
    };
}

// Use in API call
const payload = {
    title: title,
    description: description,
    ...getSchedulingParams()
};
```

---

## 12. References

- **Working Demo:** [/public/demo.html](../public/demo.html)
- **Demo JavaScript:** [/public/js/demo-app.js](../public/js/demo-app.js)
- **Backend Implementation:** [docs/SCHEDULING_IMPLEMENTATION.md](./SCHEDULING_IMPLEMENTATION.md)
- **API Endpoints:** [src/routes/upload.js](../src/routes/upload.js)

---

## Support

For issues or questions:
1. Check the demo implementation: `http://localhost:8080/demo.html`
2. Review [docs/SCHEDULING_IMPLEMENTATION.md](./SCHEDULING_IMPLEMENTATION.md)
3. Test with curl: See [docs/SCHEDULING_IMPLEMENTATION.md#testing](./SCHEDULING_IMPLEMENTATION.md)

---

**Last Updated:** January 3, 2026
