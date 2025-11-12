#!/bin/bash
# Recovery script for downloading recordings from Railway before restart
# Usage: ./recover-railway-recordings.sh <recording-id>

set -e

RECORDING_ID=${1:-b68fa19b-f137-4469-afb7-f2ac2557dd21}
REMOTE_PATH="/tmp/recordings/${RECORDING_ID}"
LOCAL_PATH="./recovered-recordings/${RECORDING_ID}"
TIMESTAMP=$(date +%Y%m%d_%H%M%S)
ARCHIVE_NAME="recording_${RECORDING_ID}_${TIMESTAMP}.tar.gz"

echo "🔍 Recovering recording: ${RECORDING_ID}"
echo "📦 Remote path: ${REMOTE_PATH}"
echo "💾 Local path: ${LOCAL_PATH}"
echo ""

# Check if railway CLI is installed
if ! command -v railway &> /dev/null; then
    echo "❌ Railway CLI not found. Install it first:"
    echo "   npm i -g @railway/cli"
    exit 1
fi

# Create local recovery directory
mkdir -p "./recovered-recordings"

echo "📋 Step 1: Checking what files exist on Railway..."
railway run bash -c "ls -lh ${REMOTE_PATH}" || {
    echo "❌ Recording directory not found on Railway"
    exit 1
}

echo ""
echo "📊 Step 2: Getting directory size..."
railway run bash -c "du -sh ${REMOTE_PATH}"

echo ""
echo "🗜️  Step 3: Creating archive on Railway..."
railway run bash -c "cd /tmp/recordings && tar -czf /tmp/${ARCHIVE_NAME} ${RECORDING_ID}/"

echo ""
echo "📥 Step 4: Downloading archive..."
railway run bash -c "cat /tmp/${ARCHIVE_NAME}" > "./recovered-recordings/${ARCHIVE_NAME}"

echo ""
echo "🗑️  Step 5: Cleaning up remote archive..."
railway run bash -c "rm /tmp/${ARCHIVE_NAME}"

echo ""
echo "📂 Step 6: Extracting archive locally..."
cd ./recovered-recordings
tar -xzf "${ARCHIVE_NAME}"
cd ..

echo ""
echo "✅ Recovery complete!"
echo "📁 Files saved to: ${LOCAL_PATH}"
echo "📦 Archive saved to: ./recovered-recordings/${ARCHIVE_NAME}"
echo ""
echo "📊 Recovery summary:"
find "${LOCAL_PATH}" -type f -name "*.wav" | wc -l | xargs echo "   Total WAV files:"
du -sh "${LOCAL_PATH}" | awk '{print "   Total size: " $1}'
echo ""
echo "🚀 Next steps:"
echo "   1. Review the files in ${LOCAL_PATH}"
echo "   2. Run upload script to push to Vercel Blob (if available)"
echo "   3. Update database records if needed"
