#!/bin/bash
# Script to clean up test data (database and uploads)

echo "🧹 Cleaning up test data..."
echo ""

# Remove database
if [ -f "reports.db" ]; then
    echo "Removing reports.db..."
    rm -f reports.db
    echo "✅ Database removed"
else
    echo "ℹ️  No database file found"
fi

# Remove uploads (but keep directory structure)
if [ -d "uploads" ]; then
    echo "Removing uploaded files..."
    find uploads -type f ! -name ".gitkeep" -delete
    echo "✅ Uploaded files removed"
else
    echo "ℹ️  No uploads directory found"
fi

echo ""
echo "✨ Cleanup complete!"
echo ""
echo "Note: These files are already excluded from Docker builds via .dockerignore"
echo "      and from git via .gitignore"
