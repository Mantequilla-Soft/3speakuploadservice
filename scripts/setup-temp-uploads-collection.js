#!/usr/bin/env node

/**
 * MongoDB Collection Setup Script: temp_uploads
 * 
 * PURPOSE:
 * Creates the temp_uploads collection in the threespeak database with proper indexes.
 * This collection tracks uploads in the "upload-first" flow where TUS upload starts
 * before video metadata is provided.
 * 
 * WHY THIS EXISTS:
 * While Mongoose will auto-create the collection on first use, running this script
 * ensures indexes are created immediately for optimal performance. This is especially
 * important in production where the first upload shouldn't be slower due to index creation.
 * 
 * WHEN TO RUN:
 * - First deployment to a new environment
 * - After restoring from backup without indexes
 * - If indexes get corrupted or deleted
 * 
 * WHAT IT DOES:
 * 1. Connects to threespeak database
 * 2. Creates temp_uploads collection (if doesn't exist)
 * 3. Creates performance indexes (upload_id, owner, expires, etc.)
 * 4. Creates TTL index for automatic MongoDB expiration
 * 5. Verifies indexes were created successfully
 * 
 * TTL INDEX:
 * MongoDB will automatically delete documents where expires < current_time.
 * This provides a safety net in addition to our cleanup service.
 * 
 * USAGE:
 *   node scripts/setup-temp-uploads-collection.js
 * 
 * REQUIREMENTS:
 *   - .env file with MONGO_URI configured
 *   - Network access to MongoDB server
 * 
 * SAFETY:
 *   - Idempotent: Safe to run multiple times
 *   - Non-destructive: Won't drop existing data
 *   - Verifies connection before making changes
 * 
 * @author @meno
 * @date 2025-12-01
 */

require('dotenv').config();
const mongoose = require('mongoose');

const MONGO_URI = process.env.MONGO_URI;

if (!MONGO_URI) {
  console.error('❌ ERROR: MONGO_URI not found in environment variables');
  console.error('   Please create .env file with MONGO_URI set');
  process.exit(1);
}

async function setupTempUploadsCollection() {
  console.log('🔧 Setting up temp_uploads collection...\n');
  
  try {
    // Connect to MongoDB
    console.log('📡 Connecting to MongoDB...');
    await mongoose.connect(MONGO_URI, {
      useNewUrlParser: true,
      useUnifiedTopology: true
    });
    console.log('✅ Connected to MongoDB\n');

    const db = mongoose.connection.db;
    const collectionName = 'temp_uploads';

    // Check if collection exists
    const collections = await db.listCollections({ name: collectionName }).toArray();
    const collectionExists = collections.length > 0;

    if (collectionExists) {
      console.log(`ℹ️  Collection '${collectionName}' already exists`);
    } else {
      console.log(`📦 Creating collection '${collectionName}'...`);
      await db.createCollection(collectionName);
      console.log('✅ Collection created\n');
    }

    const collection = db.collection(collectionName);

    // Drop existing indexes (except _id) to ensure clean state
    console.log('🗑️  Dropping old indexes (except _id)...');
    const existingIndexes = await collection.indexes();
    for (const index of existingIndexes) {
      if (index.name !== '_id_') {
        await collection.dropIndex(index.name);
        console.log(`   Dropped: ${index.name}`);
      }
    }
    console.log('✅ Old indexes removed\n');

    // Create indexes
    console.log('📊 Creating indexes...\n');

    // 1. upload_id - Unique index for fast lookups
    console.log('   Creating index: upload_id (unique)');
    await collection.createIndex(
      { upload_id: 1 },
      { unique: true, name: 'upload_id_unique' }
    );
    console.log('   ✅ upload_id index created');

    // 2. owner + created - For user's recent uploads
    console.log('   Creating index: owner + created');
    await collection.createIndex(
      { owner: 1, created: -1 },
      { name: 'owner_created' }
    );
    console.log('   ✅ owner_created index created');

    // 3. tus_completed + finalized - For status queries
    console.log('   Creating index: tus_completed + finalized');
    await collection.createIndex(
      { tus_completed: 1, finalized: 1 },
      { name: 'tus_finalized_status' }
    );
    console.log('   ✅ tus_finalized_status index created');

    // 4. video_id - For linking to videos collection
    console.log('   Creating index: video_id');
    await collection.createIndex(
      { video_id: 1 },
      { name: 'video_id' }
    );
    console.log('   ✅ video_id index created');

    // 5. TTL index - MongoDB auto-deletes expired documents
    // Note: This creates expires index WITH TTL (auto-delete)
    console.log('   Creating TTL index: expires (auto-delete after expiration)');
    await collection.createIndex(
      { expires: 1 },
      { 
        expireAfterSeconds: 0,
        name: 'expires_ttl'
      }
    );
    console.log('   ✅ expires_ttl index created (MongoDB will auto-delete expired docs)');

    // Verify indexes
    console.log('\n🔍 Verifying indexes...\n');
    const indexes = await collection.indexes();
    console.log('   Indexes created:');
    indexes.forEach(index => {
      const keys = Object.keys(index.key).map(k => `${k}: ${index.key[k]}`).join(', ');
      const unique = index.unique ? ' (UNIQUE)' : '';
      const ttl = index.expireAfterSeconds !== undefined ? ' (TTL)' : '';
      console.log(`   - ${index.name}: { ${keys} }${unique}${ttl}`);
    });

    // Show collection stats
    console.log('\n📊 Collection Stats:\n');
    const stats = await db.command({ collStats: collectionName });
    console.log(`   Documents: ${stats.count}`);
    console.log(`   Storage Size: ${(stats.size / 1024).toFixed(2)} KB`);
    console.log(`   Indexes: ${stats.nindexes}`);
    console.log(`   Total Index Size: ${(stats.totalIndexSize / 1024).toFixed(2)} KB`);

    console.log('\n✅ Setup complete!\n');
    console.log('📝 Notes:');
    console.log('   - Collection is ready for upload-first flow');
    console.log('   - MongoDB TTL will auto-delete expired uploads');
    console.log('   - Cleanup service provides additional safety layer');
    console.log('   - All indexes optimized for query performance\n');

  } catch (error) {
    console.error('\n❌ Setup failed:', error.message);
    console.error('\nDetails:', error);
    process.exit(1);
  } finally {
    await mongoose.connection.close();
    console.log('🔌 MongoDB connection closed');
  }
}

// Run setup
setupTempUploadsCollection();
