#!/usr/bin/env python3
"""
Script to upload sample reports with GitLab CI/CD metadata for testing.
This simulates what would be sent from a GitLab CI job.
"""

import json
import requests
import time
from pathlib import Path
from datetime import datetime, timedelta

BASE_URL = "http://localhost:8000"
SAMPLES_DIR = Path(__file__).parent / "samples"

# Mock GitLab CI/CD data - simulating different scenarios
MOCK_GITLAB_DATA = [
    {
        "filename": "semgrep-report-main.json",
        "sample_file": "semgrep-sample.json",
        "git_metadata": {
            "git_tag": None,
            "git_commit": "a1b2c3d4e5f6g7h8i9j0k1l2m3n4o5p6q7r8s9t0",
            "git_branch": "main",
            "gitlab_pipeline_id": "123456",
            "gitlab_job_id": "789012",
            "gitlab_project": "my-awesome-project",
            "gitlab_project_url": "https://gitlab.com/my-org/my-awesome-project",
        },
        "created_offset_days": 0,  # Today
    },
    {
        "filename": "semgrep-report-feature-auth.json",
        "sample_file": "semgrep-sample.json",
        "git_metadata": {
            "git_tag": None,
            "git_commit": "b2c3d4e5f6g7h8i9j0k1l2m3n4o5p6q7r8s9t0u1",
            "git_branch": "feature/add-authentication",
            "gitlab_pipeline_id": "123457",
            "gitlab_job_id": "789013",
            "gitlab_project": "my-awesome-project",
            "gitlab_project_url": "https://gitlab.com/my-org/my-awesome-project",
        },
        "created_offset_days": -1,  # Yesterday
    },
    {
        "filename": "semgrep-report-v1.2.3.json",
        "sample_file": "semgrep-sample.json",
        "git_metadata": {
            "git_tag": "v1.2.3",
            "git_commit": "c3d4e5f6g7h8i9j0k1l2m3n4o5p6q7r8s9t0u1v2",
            "git_branch": "main",
            "gitlab_pipeline_id": "123458",
            "gitlab_job_id": "789014",
            "gitlab_project": "my-awesome-project",
            "gitlab_project_url": "https://gitlab.com/my-org/my-awesome-project",
        },
        "created_offset_days": -3,  # 3 days ago
    },
    {
        "filename": "sarif-report-develop.json",
        "sample_file": "semgrep-sample.sarif",
        "git_metadata": {
            "git_tag": None,
            "git_commit": "d4e5f6g7h8i9j0k1l2m3n4o5p6q7r8s9t0u1v2w3",
            "git_branch": "develop",
            "gitlab_pipeline_id": "123459",
            "gitlab_job_id": "789015",
            "gitlab_project": "my-awesome-project",
            "gitlab_project_url": "https://gitlab.com/my-org/my-awesome-project",
        },
        "created_offset_days": -5,  # 5 days ago
    },
    {
        "filename": "semgrep-report-hotfix-security.json",
        "sample_file": "semgrep-sample.json",
        "git_metadata": {
            "git_tag": None,
            "git_commit": "e5f6g7h8i9j0k1l2m3n4o5p6q7r8s9t0u1v2w3x4",
            "git_branch": "hotfix/security-patch",
            "gitlab_pipeline_id": "123460",
            "gitlab_job_id": "789016",
            "gitlab_project": "my-awesome-project",
            "gitlab_project_url": "https://gitlab.com/my-org/my-awesome-project",
        },
        "created_offset_days": -7,  # 7 days ago (one week)
    },
    {
        "filename": "sarif-report-release-v2.0.0.json",
        "sample_file": "semgrep-sample.sarif",
        "git_metadata": {
            "git_tag": "v2.0.0",
            "git_commit": "f6g7h8i9j0k1l2m3n4o5p6q7r8s9t0u1v2w3x4y5",
            "git_branch": "main",
            "gitlab_pipeline_id": "123461",
            "gitlab_job_id": "789017",
            "gitlab_project": "my-awesome-project",
            "gitlab_project_url": "https://gitlab.com/my-org/my-awesome-project",
        },
        "created_offset_days": -10,  # 10 days ago
    },
]


def upload_report_with_metadata(config):
    """Upload a report file with GitLab metadata"""
    sample_path = SAMPLES_DIR / config["sample_file"]
    
    if not sample_path.exists():
        print(f"❌ Sample file not found: {sample_path}")
        return None
    
    # Read the sample file
    with open(sample_path, "rb") as f:
        file_content = f.read()
    
    # Prepare form data
    files = {
        "report": (config["filename"], file_content, "application/json")
    }
    
    # Add GitLab metadata as form fields
    data = {}
    for key, value in config["git_metadata"].items():
        if value is not None:
            # Support both direct names and CI_ prefixed GitLab CI variables
            data[key] = value
            # Also add CI_ prefixed versions for compatibility
            ci_key = key.replace("gitlab_", "CI_").replace("git_", "CI_COMMIT_").upper()
            if "CI_COMMIT_TAG" in ci_key:
                data["CI_COMMIT_TAG"] = value
            elif "CI_COMMIT_SHA" in ci_key:
                data["CI_COMMIT_SHA"] = value
            elif "CI_COMMIT_REF_NAME" in ci_key:
                data["CI_COMMIT_REF_NAME"] = value
            elif "CI_PIPELINE_ID" in ci_key:
                data["CI_PIPELINE_ID"] = value
            elif "CI_JOB_ID" in ci_key:
                data["CI_JOB_ID"] = value
            elif "CI_PROJECT_NAME" in ci_key:
                data["CI_PROJECT_NAME"] = value
            elif "CI_PROJECT_URL" in ci_key:
                data["CI_PROJECT_URL"] = value
    
    try:
        response = requests.post(f"{BASE_URL}/upload", files=files, data=data)
        response.raise_for_status()
        result = response.json()
        print(f"✅ Uploaded: {config['filename']}")
        print(f"   Branch: {config['git_metadata']['git_branch']}")
        if config['git_metadata']['git_tag']:
            print(f"   Tag: {config['git_metadata']['git_tag']}")
        print(f"   Commit: {config['git_metadata']['git_commit'][:8]}...")
        print(f"   URL: {result.get('url', 'N/A')}")
        return result
    except requests.exceptions.RequestException as e:
        print(f"❌ Failed to upload {config['filename']}: {e}")
        if hasattr(e, 'response') and e.response is not None:
            print(f"   Response: {e.response.text}")
        return None


def main():
    print("🚀 Uploading mock reports with GitLab CI/CD metadata...\n")
    
    # Check if server is running
    try:
        response = requests.get(f"{BASE_URL}/reports", timeout=2)
        response.raise_for_status()
    except requests.exceptions.RequestException:
        print(f"❌ Server not reachable at {BASE_URL}")
        print("   Please make sure the server is running: python server.py")
        return
    
    print(f"✅ Server is running at {BASE_URL}\n")
    
    # Upload each mock report
    results = []
    for i, config in enumerate(MOCK_GITLAB_DATA, 1):
        print(f"[{i}/{len(MOCK_GITLAB_DATA)}] Processing {config['filename']}...")
        result = upload_report_with_metadata(config)
        if result:
            results.append(result)
        print()
    
    print(f"\n✨ Upload complete! {len(results)}/{len(MOCK_GITLAB_DATA)} reports uploaded successfully.")
    print(f"\n📊 View reports at: {BASE_URL}")


if __name__ == "__main__":
    main()
