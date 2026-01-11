#!/usr/bin/env node
/**
 * Check MongoDB indexes on temp_uploads collection
 * This helps diagnose if TTL index is auto-deleting records
 */

require('dotenv').config();
const { connectDatabases } = require('../src/config/database');

async function checkIndexes() {
  try {
    console.log('🔌 Connecting to database...\n');
    await connectDatabases();
    
    const { threeSpeakDb } = require('../config/database');
    const collection = threeSpeakDb.collection('temp_uploads');
    
    console.log('📊 Checking indexes on temp_uploads collection:\n');
    
    const indexes = await collection.indexes();
    
    indexes.forEach((index, i) => {
      console.log(`${i + 1}. ${index.name}`);
      console.log(`   Keys: ${JSON.stringify(index.key)}`);
      if (index.expireAfterSeconds !== undefined) {
        console.log(`   ⚠️  TTL INDEX: expires after ${index.expireAfterSeconds} seconds (${index.expireAfterSeconds / 3600} hours)`);
      }
      if (index.unique) {
        console.log(`   Unique: true`);
      }
      console.log('');
    });
    
    // Check for TTL indexes
    const ttlIndexes = indexes.filter(idx => idx.expireAfterSeconds !== undefined);
    
    if (ttlIndexes.length > 0) {
      console.log('⚠️  WARNING: TTL indexes found!');
      console.log('MongoDB will auto-delete documents when the indexed field reaches expiration.');
      console.log('This happens INDEPENDENTLY of your application code.\n');
      ttlIndexes.forEach(idx => {
        console.log(`   - ${idx.name}: ${idx.expireAfterSeconds}s (${idx.expireAfterSeconds / 3600}h)`);
      });
    } else {
      console.log('✅ No TTL indexes found. Expiration is handled by application code only.');
    }
    
    process.exit(0);
  } catch (error) {
    console.error('❌ Error:', error.message);
    process.exit(1);
  }
}

checkIndexes();
