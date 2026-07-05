#!/bin/bash

# ==============================================================================
# CONFIGURATION VALUES
# ==============================================================================
EC2_IP="16.171.173.27"
EC2_USER="ubuntu"

# ⚠️ UPDATE THESE TWO LINES WITH YOUR ACTUAL LOCAL PATHS AND SERVER FOLDER NAME:
PEM_KEY_PATH="/path/to/your/local/aws-key.pem"
PROJECT_DIR="~/Kisan-Ka-Pakistan" 

# ==============================================================================
# DEPLOYMENT PROCESS
# ==============================================================================
echo "🚀 Starting deployment sequence for Kisan Ka Pakistan..."

# Connect via SSH and run commands remotely
ssh -i "$PEM_KEY_PATH" "$EC2_USER@$EC2_IP" << EOF
    echo "📂 Step 1: Navigating to project directory ($PROJECT_DIR)..."
    cd $PROJECT_DIR || { echo "❌ Directory not found!"; exit 1; }
    
    echo "🌿 Step 2: Fetching latest code from GitHub..."
    git pull origin main
    
    echo "🐳 Step 3: Rebuilding and restarting Docker containers..."
    docker-compose up -d --build
    
    echo "🧹 Step 4: Clearing old images to protect 30GB hard drive limit..."
    docker image prune -a -f
    
    echo "✅ Success: Deployment complete! App running via Nginx."
EOF