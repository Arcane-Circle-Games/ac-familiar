# PowerShell Recovery Script for Railway Recordings
# Usage: .\recover-railway-recordings.ps1 [-RecordingId <id>]

param(
    [string]$RecordingId = "b68fa19b-f137-4469-afb7-f2ac2557dd21"
)

$RemotePath = "/tmp/recordings/$RecordingId"
$LocalPath = ".\recovered-recordings\$RecordingId"
$Timestamp = Get-Date -Format "yyyyMMdd_HHmmss"
$ArchiveName = "recording_${RecordingId}_${Timestamp}.tar.gz"

Write-Host "🔍 Recovering recording: $RecordingId" -ForegroundColor Cyan
Write-Host "📦 Remote path: $RemotePath"
Write-Host "💾 Local path: $LocalPath"
Write-Host ""

# Check if railway CLI is installed
if (!(Get-Command railway -ErrorAction SilentlyContinue)) {
    Write-Host "❌ Railway CLI not found. Install it first:" -ForegroundColor Red
    Write-Host "   npm i -g @railway/cli"
    exit 1
}

# Create local recovery directory
New-Item -ItemType Directory -Force -Path ".\recovered-recordings" | Out-Null

Write-Host "📋 Step 1: Checking what files exist on Railway..." -ForegroundColor Yellow
railway run bash -c "ls -lh $RemotePath"
if ($LASTEXITCODE -ne 0) {
    Write-Host "❌ Recording directory not found on Railway" -ForegroundColor Red
    exit 1
}

Write-Host ""
Write-Host "📊 Step 2: Getting directory size..." -ForegroundColor Yellow
railway run bash -c "du -sh $RemotePath"

Write-Host ""
Write-Host "🗜️  Step 3: Creating archive on Railway..." -ForegroundColor Yellow
railway run bash -c "cd /tmp/recordings && tar -czf /tmp/$ArchiveName $RecordingId/"

Write-Host ""
Write-Host "📥 Step 4: Downloading archive..." -ForegroundColor Yellow
railway run bash -c "cat /tmp/$ArchiveName" | Set-Content -Path ".\recovered-recordings\$ArchiveName" -Encoding Byte

Write-Host ""
Write-Host "🗑️  Step 5: Cleaning up remote archive..." -ForegroundColor Yellow
railway run bash -c "rm /tmp/$ArchiveName"

Write-Host ""
Write-Host "📂 Step 6: Extracting archive locally..." -ForegroundColor Yellow
Push-Location ".\recovered-recordings"
tar -xzf $ArchiveName
Pop-Location

Write-Host ""
Write-Host "✅ Recovery complete!" -ForegroundColor Green
Write-Host "📁 Files saved to: $LocalPath"
Write-Host "📦 Archive saved to: .\recovered-recordings\$ArchiveName"
Write-Host ""
Write-Host "📊 Recovery summary:" -ForegroundColor Cyan
$wavFiles = (Get-ChildItem -Path $LocalPath -Filter "*.wav" -Recurse).Count
$totalSize = (Get-ChildItem -Path $LocalPath -Recurse | Measure-Object -Property Length -Sum).Sum / 1MB
Write-Host "   Total WAV files: $wavFiles"
Write-Host "   Total size: $([math]::Round($totalSize, 2)) MB"
Write-Host ""
Write-Host "🚀 Next steps:" -ForegroundColor Yellow
Write-Host "   1. Review the files in $LocalPath"
Write-Host "   2. Run upload script to push to Vercel Blob (if available)"
Write-Host "   3. Update database records if needed"
