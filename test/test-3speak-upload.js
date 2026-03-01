#!/usr/bin/env node

/**
 * Test script for 3Speak image upload functionality
 * Tests the new threespeak-image service and fallback chain
 */

require('dotenv').config();
const fs = require('fs');
const path = require('path');

// Check environment variables
console.log('\n=== 3Speak Image Upload Configuration ===');
console.log(`THREESPEAK_IMAGE_URL: ${process.env.THREESPEAK_IMAGE_URL || '(not set)'}`);
console.log(`THREESPEAK_IMAGE_API_KEY: ${process.env.THREESPEAK_IMAGE_API_KEY ? '***' + process.env.THREESPEAK_IMAGE_API_KEY.slice(-8) : '(not set)'}`);
console.log(`Node version: ${process.version}`);

// Import services
const threeSpeakImageService = require('../src/services/threespeak-image');
const hiveImageService = require('../src/services/hive-image');
const ipfsService = require('../src/services/ipfs');

async function testThreeSpeakService() {
  console.log('\n=== Test 1: 3Speak Service Status ===');
  const status = threeSpeakImageService.getStatus();
  console.log('Status:', JSON.stringify(status, null, 2));
  
  if (!status.enabled) {
    console.log('⚠️  3Speak upload is not enabled (missing API key)');
    return false;
  }
  
  if (status.circuitBreaker.isOpen) {
    console.log('⚠️  3Speak upload is enabled but circuit breaker is open');
    return false;
  }
  
  console.log('✅ 3Speak upload service is enabled and available');
  return true;
}

async function testAllServices() {
  console.log('\n=== Test 2: All Thumbnail Services Status ===');
  
  const hiveStatus = hiveImageService.getStatus();
  const threeSpeakStatus = threeSpeakImageService.getStatus();
  
  console.log('\n🔵 Hive (Primary):');
  console.log(`  Configured: ${hiveStatus.configured ? '✅' : '❌'}`);
  console.log(`  Enabled: ${hiveStatus.enabled ? '✅' : '❌'}`);
  console.log(`  Circuit Breaker: ${hiveStatus.circuitBreaker.isOpen ? '🔴 OPEN' : '🟢 CLOSED'}`);
  
  console.log('\n🔵 3Speak (Secondary):');
  console.log(`  Configured: ${threeSpeakStatus.configured ? '✅' : '❌'}`);
  console.log(`  Enabled: ${threeSpeakStatus.enabled ? '✅' : '❌'}`);
  console.log(`  Circuit Breaker: ${threeSpeakStatus.circuitBreaker.isOpen ? '🔴 OPEN' : '🟢 CLOSED'}`);
  console.log(`  Endpoint: ${threeSpeakStatus.endpoint}`);
  
  console.log('\n🔵 IPFS (Fallback):');
  console.log('  Always available as last resort');
  
  console.log('\n📊 Fallback Chain:');
  if (hiveStatus.enabled) {
    console.log('  1️⃣  Hive (images.hive.blog) ✅');
  } else {
    console.log('  1️⃣  Hive (images.hive.blog) ⏭️  (skipped)');
  }
  
  if (threeSpeakStatus.enabled) {
    console.log('  2️⃣  3Speak (images.3speak.tv) ✅');
  } else {
    console.log('  2️⃣  3Speak (images.3speak.tv) ⏭️  (skipped)');
  }
  
  console.log('  3️⃣  IPFS (ipfs.3speak.tv) ✅');
}

async function testBase64Upload() {
  console.log('\n=== Test 3: Base64 Image Upload (Full Fallback Chain) ===');
  
  // Create a simple 1x1 red pixel PNG in base64
  const testBase64 = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFBQIAX8jx0gAAAABJRU5ErkJggg==';
  
  try {
    console.log('Attempting to upload 1x1 test image through fallback chain...');
    const result = await ipfsService.uploadThumbnailBase64(testBase64);
    console.log('✅ Upload successful!');
    console.log('Result:', JSON.stringify(result, null, 2));
    
    if (result.source === 'hive') {
      console.log(`\n🎯 Uploaded to Hive (Primary): ${result.url}`);
      return { success: true, url: result.url, source: 'hive' };
    } else if (result.source === '3speak') {
      console.log(`\n🎯 Uploaded to 3Speak (Secondary): ${result.url}`);
      return { success: true, url: result.url, source: '3speak' };
    } else if (result.source === 'ipfs') {
      console.log(`\n🎯 Uploaded to IPFS (Fallback): ipfs://${result.hash}`);
      console.log(`   Gateway URL: ${result.gatewayUrl}`);
      return { success: true, hash: result.hash, source: 'ipfs' };
    }
  } catch (error) {
    console.error('❌ Upload failed:', error.message);
    return { success: false, error: error.message };
  }
}

async function testDirect3SpeakUpload() {
  console.log('\n=== Test 4: Direct 3Speak Upload ===');
  
  if (!threeSpeakImageService.isEnabled()) {
    console.log('⏭️  Skipping - 3Speak service not enabled');
    return { success: false, skipped: true };
  }
  
  // Create a simple 1x1 red pixel PNG in base64
  const testBase64 = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFBQIAX8jx0gAAAABJRU5ErkJggg==';
  
  try {
    console.log('Testing direct 3Speak upload...');
    const url = await threeSpeakImageService.uploadBase64(testBase64);
    console.log('✅ Direct 3Speak upload successful!');
    console.log(`   URL: ${url}`);
    return { success: true, url };
  } catch (error) {
    console.error('❌ Direct 3Speak upload failed:', error.message);
    return { success: false, error: error.message };
  }
}

async function testCircuitBreaker() {
  console.log('\n=== Test 5: Circuit Breaker Status ===');
  
  const hiveStatus = hiveImageService.getStatus();
  const threeSpeakStatus = threeSpeakImageService.getStatus();
  
  console.log('\n🔵 Hive Circuit Breaker:');
  if (hiveStatus.circuitBreaker.isOpen) {
    console.log('  Status: 🔴 OPEN - service will be skipped');
    const openedAt = new Date(hiveStatus.circuitBreaker.openedAt);
    const timeElapsed = Date.now() - openedAt.getTime();
    const resetTime = hiveStatus.circuitBreaker.resetTimeout - timeElapsed;
    console.log(`  Opened at: ${openedAt.toISOString()}`);
    console.log(`  Resets in: ${Math.round(resetTime / 1000)}s`);
  } else {
    console.log('  Status: 🟢 CLOSED - service operational');
    console.log(`  Failures: ${hiveStatus.circuitBreaker.failureCount}/${hiveStatus.circuitBreaker.maxFailures}`);
  }
  
  console.log('\n🔵 3Speak Circuit Breaker:');
  if (threeSpeakStatus.circuitBreaker.isOpen) {
    console.log('  Status: 🔴 OPEN - service will be skipped');
    const openedAt = new Date(threeSpeakStatus.circuitBreaker.openedAt);
    const timeElapsed = Date.now() - openedAt.getTime();
    const resetTime = threeSpeakStatus.circuitBreaker.resetTimeout - timeElapsed;
    console.log(`  Opened at: ${openedAt.toISOString()}`);
    console.log(`  Resets in: ${Math.round(resetTime / 1000)}s`);
  } else {
    console.log('  Status: 🟢 CLOSED - service operational');
    console.log(`  Failures: ${threeSpeakStatus.circuitBreaker.failureCount}/${threeSpeakStatus.circuitBreaker.maxFailures}`);
  }
}

async function testStats() {
  console.log('\n=== Test 6: Service Statistics ===');
  
  const threeSpeakStatus = threeSpeakImageService.getStatus();
  
  console.log('\n3Speak Stats:');
  console.log(`  Total uploads: ${threeSpeakStatus.stats.totalUploads}`);
  console.log(`  Successful: ${threeSpeakStatus.stats.successfulUploads}`);
  console.log(`  Failed: ${threeSpeakStatus.stats.failedUploads}`);
  console.log(`  Total bytes: ${threeSpeakStatus.stats.totalBytes.toLocaleString()}`);
  console.log(`  Average size: ${threeSpeakStatus.stats.averageSize.toLocaleString()} bytes`);
}

async function runTests() {
  console.log('\n🧪 Starting 3Speak Image Upload Tests...\n');
  console.log('=' .repeat(60));
  
  try {
    // Test 1: Check 3Speak service status
    await testThreeSpeakService();
    
    // Test 2: Check all services
    await testAllServices();
    
    // Test 3: Upload through fallback chain
    await testBase64Upload();
    
    // Test 4: Direct 3Speak upload
    await testDirect3SpeakUpload();
    
    // Test 5: Check circuit breakers
    await testCircuitBreaker();
    
    // Test 6: View stats
    await testStats();
    
    console.log('\n' + '='.repeat(60));
    console.log('✅ All tests completed!');
    console.log('=' .repeat(60) + '\n');
  } catch (error) {
    console.error('\n❌ Test suite failed:', error);
    console.error(error.stack);
    process.exit(1);
  }
}

// Run tests
runTests().catch(error => {
  console.error('Fatal error:', error);
  process.exit(1);
});
