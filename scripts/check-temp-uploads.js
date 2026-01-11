#!/usr/bin/env node
/**
 * Check TempUpload records for a specific user
 */

require('dotenv').config();
const { connectDatabases } = require('../src/config/database');

async function checkTempUploads(username) {
  try {
    console.log('🔌 Connecting to database...');
    await connectDatabases();
    
    const TempUpload = require('../src/models/TempUpload')();
    
    console.log(`\n🔍 Checking temp uploads for: ${username}\n`);
    
    // Find all uploads for this user
    const uploads = await TempUpload.find({ owner: username })
      .sort({ created: -1 })
      .limit(20);
    
    if (uploads.length === 0) {
      console.log('❌ No temp uploads found for this user');
      process.exit(0);
    }
    
    console.log(`✅ Found ${uploads.length} temp upload(s):\n`);
    
    uploads.forEach((upload, index) => {
      const now = new Date();
      const isExpired = upload.expires < now;
      const timeLeft = Math.round((upload.expires - now) / (60 * 1000)); // minutes
      
      console.log(`${index + 1}. Upload ID: ${upload.upload_id}`);
      console.log(`   Created: ${upload.created.toISOString()}`);
      console.log(`   Expires: ${upload.expires.toISOString()}${isExpired ? ' ⚠️ EXPIRED' : ''}`);
      if (!isExpired && timeLeft > 0) {
        console.log(`   Time left: ${Math.floor(timeLeft / 60)}h ${timeLeft % 60}m`);
      }
      console.log(`   TUS completed: ${upload.tus_completed ? '✅' : '❌'}`);
      console.log(`   Finalized: ${upload.finalized ? '✅' : '❌'}`);
      console.log(`   File: ${upload.originalFilename}`);
      console.log(`   Size: ${(upload.size / (1024 * 1024)).toFixed(2)} MB`);
      console.log(`   Duration: ${upload.duration.toFixed(2)}s`);
      if (upload.tus_file_path) {
        console.log(`   File path: ${upload.tus_file_path}`);
      }
      if (upload.video_id) {
        console.log(`   Video ID: ${upload.video_id}`);
      }
      console.log('');
    });
    
    // Check for stuck uploads
    const stuck = uploads.filter(u => u.tus_completed && !u.finalized && !u.isExpired());
    if (stuck.length > 0) {
      console.log(`⚠️  ${stuck.length} upload(s) are stuck (TUS completed but not finalized):`);
      stuck.forEach(u => {
        console.log(`   - ${u.upload_id}`);
      });
      console.log('');
    }
    
    process.exit(0);
  } catch (error) {
    console.error('❌ Error:', error.message);
    process.exit(1);
  }
}

// Get username from command line
const username = process.argv[2];

if (!username) {
  console.error('Usage: node check-temp-uploads.js <username>');
  process.exit(1);
}

checkTempUploads(username);
