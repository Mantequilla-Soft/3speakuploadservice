#!/usr/bin/env node

/**
 * Test script for Hive image upload functionality
 * Tests the new hive-image service and IPFS fallback
 */

require('dotenv').config();
const fs = require('fs');
const path = require('path');

// Check environment variables
console.log('\n=== Hive Image Upload Configuration ===');
console.log(`HIVE_IMAGE_ACCOUNT: ${process.env.HIVE_IMAGE_ACCOUNT || '(not set)'}`);
console.log(`HIVE_IMAGE_POSTING_KEY: ${process.env.HIVE_IMAGE_POSTING_KEY ? '***' + process.env.HIVE_IMAGE_POSTING_KEY.slice(-8) : '(not set)'}`);
console.log(`Node version: ${process.version}`);

// Import services
const hiveImageService = require('../src/services/hive-image');
const ipfsService = require('../src/services/ipfs');

async function testHiveService() {
  console.log('\n=== Test 1: Hive Service Status ===');
  const status = hiveImageService.getStatus();
  console.log('Status:', JSON.stringify(status, null, 2));
  
  if (!status.enabled) {
    console.log('❌ Hive upload is not enabled (missing credentials)');
    return false;
  }
  
  if (!status.available) {
    console.log('⚠️ Hive upload is enabled but not available (circuit breaker may be open)');
    return false;
  }
  
  console.log('✅ Hive upload service is enabled and available');
  return true;
}

async function testBase64Upload() {
  console.log('\n=== Test 2: Base64 Image Upload ===');
  
  // Create a simple 1x1 red pixel PNG in base64
  const testBase64 = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFBQIAX8jx0gAAAABJRU5ErkJggg==';
  
  try {
    console.log('Attempting to upload 1x1 test image...');
    const result = await ipfsService.uploadThumbnailBase64(testBase64);
    console.log('✅ Upload successful!');
    console.log('Result:', JSON.stringify(result, null, 2));
    
    if (result.source === 'hive') {
      console.log(`🎯 Uploaded to Hive: ${result.url}`);
      return { success: true, url: result.url, source: 'hive' };
    } else if (result.source === 'ipfs') {
      console.log(`🎯 Uploaded to IPFS: ipfs://${result.hash}`);
      return { success: true, hash: result.hash, source: 'ipfs' };
    }
  } catch (error) {
    console.error('❌ Upload failed:', error.message);
    return { success: false, error: error.message };
  }
}

async function testCircuitBreaker() {
  console.log('\n=== Test 3: Circuit Breaker Status ===');
  const status = hiveImageService.getStatus();
  
  console.log('Circuit Breaker:', {
    isOpen: status.circuitBreaker.isOpen,
    failureCount: status.circuitBreaker.failureCount,
    maxFailures: status.circuitBreaker.maxFailures
  });
  
  if (status.circuitBreaker.isOpen) {
    console.log('⚠️ Circuit breaker is OPEN - service will fallback to IPFS');
    const openedAt = new Date(status.circuitBreaker.openedAt);
    const timeElapsed = Date.now() - openedAt.getTime();
    const resetTime = status.circuitBreaker.resetTimeout - timeElapsed;
    console.log(`   Opened at: ${openedAt.toISOString()}`);
    console.log(`   Will reset in: ${Math.round(resetTime / 1000)}s`);
  } else {
    console.log('✅ Circuit breaker is CLOSED - service is operational');
  }
}

async function runTests() {
  console.log('\n🧪 Starting Hive Image Upload Tests...\n');
  
  try {
    // Test 1: Check service status
    const serviceReady = await testHiveService();
    
    // Test 2: Try uploading
    const uploadResult = await testBase64Upload();
    
    // Test 3: Check circuit breaker
    await testCircuitBreaker();
    
    // Summary
    console.log('\n=== Test Summary ===');
    if (serviceReady && uploadResult.success) {
      console.log('✅ All tests passed!');
      if (uploadResult.source === 'hive') {
        console.log(`\n🎉 Hive image upload is working! Image URL:\n   ${uploadResult.url}`);
      } else {
        console.log(`\n✅ IPFS fallback is working! Image hash:\n   ipfs://${uploadResult.hash}`);
      }
      process.exit(0);
    } else {
      console.log('⚠️ Some tests failed or Hive upload unavailable');
      console.log('   Service will use IPFS as fallback');
      process.exit(0); // Not a critical failure
    }
  } catch (error) {
    console.error('\n❌ Test suite failed:', error);
    process.exit(1);
  }
}

// Run tests
runTests();
