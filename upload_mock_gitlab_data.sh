#!/bin/bash
# Script to upload sample reports with GitLab CI/CD metadata for testing

BASE_URL="http://localhost:8083"
SAMPLES_DIR="$(dirname "$0")/samples"

echo "🚀 Uploading mock reports with GitLab CI/CD metadata..."
echo ""

# Check if server is running
if ! curl -s -f "${BASE_URL}/reports" > /dev/null 2>&1; then
    echo "❌ Server not reachable at ${BASE_URL}"
    echo "   Please make sure the server is running: python server.py"
    exit 1
fi

echo "✅ Server is running at ${BASE_URL}"
echo ""

# Function to upload a report
upload_report() {
    local filename="$1"
    local sample_file="$2"
    local git_tag="$3"
    local git_commit="$4"
    local git_branch="$5"
    local pipeline_id="$6"
    local job_id="$7"
    local project="$8"
    local project_url="$9"
    
    local sample_path="${SAMPLES_DIR}/${sample_file}"
    
    if [ ! -f "$sample_path" ]; then
        echo "❌ Sample file not found: $sample_path"
        return 1
    fi
    
    echo "📤 Uploading: $filename"
    echo "   Branch: $git_branch"
    if [ -n "$git_tag" ]; then
        echo "   Tag: $git_tag"
    fi
    echo "   Commit: ${git_commit:0:8}..."
    
    # Use curl to upload with multipart form data
    response=$(curl -s -w "\n%{http_code}" -X POST "${BASE_URL}/upload" \
        -F "report=@${sample_path};filename=${filename}" \
        -F "git_tag=${git_tag}" \
        -F "git_commit=${git_commit}" \
        -F "git_branch=${git_branch}" \
        -F "gitlab_pipeline_id=${pipeline_id}" \
        -F "gitlab_job_id=${job_id}" \
        -F "gitlab_project=${project}" \
        -F "gitlab_project_url=${project_url}" \
        -F "CI_COMMIT_TAG=${git_tag}" \
        -F "CI_COMMIT_SHA=${git_commit}" \
        -F "CI_COMMIT_REF_NAME=${git_branch}" \
        -F "CI_PIPELINE_ID=${pipeline_id}" \
        -F "CI_JOB_ID=${job_id}" \
        -F "CI_PROJECT_NAME=${project}" \
        -F "CI_PROJECT_URL=${project_url}")
    
    http_code=$(echo "$response" | tail -n1)
    body=$(echo "$response" | sed '$d')
    
    if [ "$http_code" -eq 200 ] || [ "$http_code" -eq 201 ]; then
        echo "   ✅ Upload successful"
        echo ""
        return 0
    else
        echo "   ❌ Upload failed (HTTP $http_code)"
        echo "   Response: $body"
        echo ""
        return 1
    fi
}

# Upload mock reports
success=0
total=0

# Report 1: Main branch, today
upload_report \
    "semgrep-report-main.json" \
    "semgrep-sample.json" \
    "" \
    "a1b2c3d4e5f6g7h8i9j0k1l2m3n4o5p6q7r8s9t0" \
    "main" \
    "123456" \
    "789012" \
    "my-awesome-project" \
    "https://gitlab.com/my-org/my-awesome-project" && ((success++))
((total++))

# Report 2: Feature branch, yesterday
upload_report \
    "semgrep-report-feature-auth.json" \
    "semgrep-sample.json" \
    "" \
    "b2c3d4e5f6g7h8i9j0k1l2m3n4o5p6q7r8s9t0u1" \
    "feature/add-authentication" \
    "123457" \
    "789013" \
    "my-awesome-project" \
    "https://gitlab.com/my-org/my-awesome-project" && ((success++))
((total++))

# Report 3: Tagged release, 3 days ago
upload_report \
    "semgrep-report-v1.2.3.json" \
    "semgrep-sample.json" \
    "v1.2.3" \
    "c3d4e5f6g7h8i9j0k1l2m3n4o5p6q7r8s9t0u1v2" \
    "main" \
    "123458" \
    "789014" \
    "my-awesome-project" \
    "https://gitlab.com/my-org/my-awesome-project" && ((success++))
((total++))

# Report 4: SARIF from develop branch, 5 days ago
upload_report \
    "sarif-report-develop.json" \
    "semgrep-sample.sarif" \
    "" \
    "d4e5f6g7h8i9j0k1l2m3n4o5p6q7r8s9t0u1v2w3" \
    "develop" \
    "123459" \
    "789015" \
    "my-awesome-project" \
    "https://gitlab.com/my-org/my-awesome-project" && ((success++))
((total++))

# Report 5: Hotfix branch, 7 days ago
upload_report \
    "semgrep-report-hotfix-security.json" \
    "semgrep-sample.json" \
    "" \
    "e5f6g7h8i9j0k1l2m3n4o5p6q7r8s9t0u1v2w3x4" \
    "hotfix/security-patch" \
    "123460" \
    "789016" \
    "my-awesome-project" \
    "https://gitlab.com/my-org/my-awesome-project" && ((success++))
((total++))

# Report 6: Tagged release v2.0.0, 10 days ago
upload_report \
    "sarif-report-release-v2.0.0.json" \
    "semgrep-sample.sarif" \
    "v2.0.0" \
    "f6g7h8i9j0k1l2m3n4o5p6q7r8s9t0u1v2w3x4y5" \
    "main" \
    "123461" \
    "789017" \
    "my-awesome-project" \
    "https://gitlab.com/my-org/my-awesome-project" && ((success++))
((total++))

echo "✨ Upload complete! $success/$total reports uploaded successfully."
echo ""
echo "📊 View reports at: ${BASE_URL}"
