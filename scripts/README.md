# MongoDB Collection Setup Scripts

## Overview

This directory contains setup scripts for MongoDB collections used by the 3Speak upload service. These scripts ensure proper indexes and configuration, especially important for production deployments.

## Why These Scripts Exist

**For Future Maintainers:**

While Mongoose automatically creates collections and indexes when the application starts, these setup scripts serve important purposes:

1. **Performance** - Indexes are created before first upload, avoiding slow first operations
2. **Verification** - Confirms database structure is correct before going live
3. **Documentation** - Serves as explicit schema documentation
4. **Disaster Recovery** - Quickly restore proper indexes after database restore
5. **Environment Setup** - Standardize setup across dev, staging, and production

## Available Scripts

### `setup-temp-uploads-collection.js`

**Purpose:** Sets up the `temp_uploads` collection for the upload-first flow.

**What it does:**
- Creates `temp_uploads` collection in `threespeak` database
- Creates performance indexes (upload_id, owner, expires, etc.)
- Creates TTL index for automatic MongoDB document expiration
- Verifies all indexes are created correctly

**When to run:**
- First deployment to new environment
- After database restore
- If indexes get corrupted

**Usage:**
```bash
node scripts/setup-temp-uploads-collection.js
```

**Requirements:**
- `.env` file with `MONGO_URI` configured
- Network access to MongoDB server

**Safety:**
- ✅ Idempotent (safe to run multiple times)
- ✅ Non-destructive (won't delete data)
- ✅ Verifies connection before making changes

## General Guidelines

### Before Running Any Setup Script

1. **Backup First** - Always backup your database before running setup scripts
2. **Test in Dev** - Run in development environment first
3. **Check .env** - Ensure environment variables are correct
4. **Verify Connection** - Test MongoDB connection before running

### After Running Setup Scripts

1. **Review Output** - Check for any errors or warnings
2. **Verify Indexes** - Confirm indexes were created with `db.collection.getIndexes()`
3. **Test Application** - Run app and verify functionality
4. **Monitor Performance** - Check query performance in production

## Troubleshooting

### "MONGO_URI not found"
- Create `.env` file in project root
- Copy from `.env.example` and fill in values

### "Connection timeout"
- Check network connectivity to MongoDB server
- Verify MongoDB server is running
- Check firewall rules

### "Index creation failed"
- Check MongoDB user has proper permissions
- Verify collection doesn't have conflicting data
- Check MongoDB logs for detailed error

## For New Team Members

If you're taking over this project:

1. **Read this README first** - Understand why scripts exist
2. **Check existing indexes** - Use `db.collection.getIndexes()` in MongoDB shell
3. **Review schema files** - See `src/models/` for collection schemas
4. **Test in dev first** - Never run setup scripts directly in production without testing
5. **Document changes** - Update this README if you add new scripts

## Adding New Setup Scripts

When adding new collections that need setup:

1. Create script: `scripts/setup-{collection-name}.js`
2. Follow existing script structure
3. Include detailed header comments explaining WHY the script exists
4. Add error handling and verification
5. Update this README with script documentation
6. Test in development environment
7. Update deployment documentation

## Questions?

Contact [@meno](https://peakd.com/@meno) or check project documentation in `/docs`.
