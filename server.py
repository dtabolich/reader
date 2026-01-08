import json
import os
import sqlite3
import time
from http.server import HTTPServer, SimpleHTTPRequestHandler
from pathlib import Path
from urllib.parse import urlparse
import cgi
from datetime import datetime

BASE_DIR = Path(__file__).resolve().parent
UPLOAD_DIR = BASE_DIR / "uploads"
UPLOAD_DIR.mkdir(exist_ok=True)
DB_PATH = BASE_DIR / "reports.db"

DEFAULT_PORT = int(os.environ.get("PORT", "8000"))


class ReportDB:
    def __init__(self, db_path):
        self.db_path = db_path
        self.init_db()

    def get_connection(self):
        conn = sqlite3.connect(self.db_path)
        conn.row_factory = sqlite3.Row
        return conn

    def init_db(self):
        conn = self.get_connection()
        try:
            # Create table with all columns
            conn.execute("""
                CREATE TABLE IF NOT EXISTS reports (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    filename TEXT NOT NULL,
                    stored_filename TEXT NOT NULL UNIQUE,
                    file_path TEXT NOT NULL,
                    report_type TEXT,
                    total_findings INTEGER DEFAULT 0,
                    total_files INTEGER DEFAULT 0,
                    total_rules INTEGER DEFAULT 0,
                    severity_critical INTEGER DEFAULT 0,
                    severity_high INTEGER DEFAULT 0,
                    severity_medium INTEGER DEFAULT 0,
                    severity_low INTEGER DEFAULT 0,
                    severity_info INTEGER DEFAULT 0,
                    git_tag TEXT,
                    git_commit TEXT,
                    git_branch TEXT,
                    gitlab_pipeline_id TEXT,
                    gitlab_job_id TEXT,
                    gitlab_project TEXT,
                    gitlab_project_url TEXT,
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                )
            """)
            conn.commit()
            
            # Add new columns to existing tables (for migration)
            # SQLite doesn't support IF NOT EXISTS for ALTER TABLE, so we use try/except
            new_columns = [
                ("git_tag", "TEXT"),
                ("git_commit", "TEXT"),
                ("git_branch", "TEXT"),
                ("gitlab_pipeline_id", "TEXT"),
                ("gitlab_job_id", "TEXT"),
                ("gitlab_project", "TEXT"),
                ("gitlab_project_url", "TEXT"),
            ]
            
            for column_name, column_type in new_columns:
                try:
                    conn.execute(f"ALTER TABLE reports ADD COLUMN {column_name} {column_type}")
                    conn.commit()
                except sqlite3.OperationalError:
                    # Column already exists, ignore
                    pass
        finally:
            conn.close()

    def extract_metadata(self, report_data):
        """Extract metadata from report JSON (SARIF or Semgrep)"""
        metadata = {
            "report_type": None,
            "total_findings": 0,
            "total_files": 0,
            "total_rules": 0,
            "severity_critical": 0,
            "severity_high": 0,
            "severity_medium": 0,
            "severity_low": 0,
            "severity_info": 0,
        }

        # Check if SARIF format
        if isinstance(report_data, dict) and "runs" in report_data:
            metadata["report_type"] = "SARIF"
            issues = []
            for run in report_data.get("runs", []):
                for result in run.get("results", []):
                    issues.append(result)
            
            metadata["total_findings"] = len(issues)
            files = set()
            rules = set()
            
            for issue in issues:
                location = issue.get("locations", [{}])[0].get("physicalLocation", {})
                file_uri = location.get("artifactLocation", {}).get("uri", "")
                if file_uri:
                    files.add(file_uri)
                
                rule_id = issue.get("ruleId", "")
                if rule_id:
                    rules.add(rule_id)
                
                # Extract severity
                severity = issue.get("level", "").lower()
                if "critical" in severity:
                    metadata["severity_critical"] += 1
                elif "error" in severity or "high" in severity:
                    metadata["severity_high"] += 1
                elif "warning" in severity or "medium" in severity:
                    metadata["severity_medium"] += 1
                elif "note" in severity or "low" in severity:
                    metadata["severity_low"] += 1
                else:
                    metadata["severity_info"] += 1
            
            metadata["total_files"] = len(files)
            metadata["total_rules"] = len(rules)

        # Check if Semgrep format
        elif isinstance(report_data, dict) and "results" in report_data:
            metadata["report_type"] = "Semgrep JSON"
            issues = report_data.get("results", [])
            metadata["total_findings"] = len(issues)
            
            files = set()
            rules = set()
            
            for issue in issues:
                file_path = issue.get("path", "")
                if file_path:
                    files.add(file_path)
                
                rule_id = issue.get("check_id", "")
                if rule_id:
                    rules.add(rule_id)
                
                # Extract severity
                severity = issue.get("extra", {}).get("severity", "info").lower()
                if "critical" in severity:
                    metadata["severity_critical"] += 1
                elif "error" in severity or "high" in severity:
                    metadata["severity_high"] += 1
                elif "warning" in severity or "medium" in severity:
                    metadata["severity_medium"] += 1
                elif "note" in severity or "low" in severity:
                    metadata["severity_low"] += 1
                else:
                    metadata["severity_info"] += 1
            
            metadata["total_files"] = len(files)
            metadata["total_rules"] = len(rules)

        return metadata

    def save_report(self, filename, stored_filename, file_path, report_data, git_metadata=None):
        """Save report file and metadata to database
        
        Args:
            filename: Original filename
            stored_filename: Stored filename on disk
            file_path: Full path to file
            report_data: Parsed report JSON data
            git_metadata: Optional dict with GitLab metadata:
                - git_tag: Git tag
                - git_commit: Commit hash
                - git_branch: Branch name
                - gitlab_pipeline_id: GitLab pipeline ID
                - gitlab_job_id: GitLab job ID
                - gitlab_project: Project name
                - gitlab_project_url: Project URL
        """
        metadata = self.extract_metadata(report_data)
        git_metadata = git_metadata or {}
        
        conn = self.get_connection()
        try:
            cursor = conn.execute("""
                INSERT INTO reports (
                    filename, stored_filename, file_path, report_type,
                    total_findings, total_files, total_rules,
                    severity_critical, severity_high, severity_medium,
                    severity_low, severity_info,
                    git_tag, git_commit, git_branch,
                    gitlab_pipeline_id, gitlab_job_id,
                    gitlab_project, gitlab_project_url
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """, (
                filename,
                stored_filename,
                str(file_path),
                metadata["report_type"],
                metadata["total_findings"],
                metadata["total_files"],
                metadata["total_rules"],
                metadata["severity_critical"],
                metadata["severity_high"],
                metadata["severity_medium"],
                metadata["severity_low"],
                metadata["severity_info"],
                git_metadata.get("git_tag"),
                git_metadata.get("git_commit"),
                git_metadata.get("git_branch"),
                git_metadata.get("gitlab_pipeline_id"),
                git_metadata.get("gitlab_job_id"),
                git_metadata.get("gitlab_project"),
                git_metadata.get("gitlab_project_url"),
            ))
            conn.commit()
            return cursor.lastrowid
        finally:
            conn.close()

    def get_all_reports(self):
        """Get all reports ordered by creation date"""
        conn = self.get_connection()
        try:
            cursor = conn.execute("""
                SELECT id, filename, stored_filename, file_path,
                       report_type, total_findings, total_files, total_rules,
                       severity_critical, severity_high, severity_medium,
                       severity_low, severity_info,
                       git_tag, git_commit, git_branch,
                       gitlab_pipeline_id, gitlab_job_id,
                       gitlab_project, gitlab_project_url,
                       created_at
                FROM reports
                ORDER BY created_at DESC
            """)
            return [dict(row) for row in cursor.fetchall()]
        finally:
            conn.close()

    def get_totals(self):
        """Get aggregate totals across all reports"""
        conn = self.get_connection()
        try:
            cursor = conn.execute("""
                SELECT 
                    COUNT(*) as total_reports,
                    SUM(total_findings) as total_findings,
                    SUM(total_files) as total_files,
                    SUM(total_rules) as total_rules,
                    SUM(severity_critical) as total_critical,
                    SUM(severity_high) as total_high,
                    SUM(severity_medium) as total_medium,
                    SUM(severity_low) as total_low,
                    SUM(severity_info) as total_info
                FROM reports
            """)
            row = cursor.fetchone()
            if row:
                return dict(row)
            return {
                    "total_reports": 0,
                    "total_findings": 0,
                    "total_files": 0,
                    "total_rules": 0,
                    "total_critical": 0,
                    "total_high": 0,
                    "total_medium": 0,
                    "total_low": 0,
                    "total_info": 0,
                }
        finally:
            conn.close()

    def get_report_by_filename(self, stored_filename):
        """Get report by stored filename"""
        conn = self.get_connection()
        try:
            cursor = conn.execute("""
                SELECT * FROM reports WHERE stored_filename = ?
            """, (stored_filename,))
            row = cursor.fetchone()
            return dict(row) if row else None
        finally:
            conn.close()

    def delete_report(self, stored_filename):
        """Delete report from database"""
        conn = self.get_connection()
        try:
            cursor = conn.execute("""
                DELETE FROM reports WHERE stored_filename = ?
            """, (stored_filename,))
            conn.commit()
            return cursor.rowcount > 0
        finally:
            conn.close()


# Initialize database
db = ReportDB(DB_PATH)


class ReaderHandler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(BASE_DIR), **kwargs)

    def do_POST(self):
        parsed = urlparse(self.path)
        if parsed.path != "/upload":
            self.send_error(404, "Not Found")
            return

        form = cgi.FieldStorage(
            fp=self.rfile,
            headers=self.headers,
            environ={
                "REQUEST_METHOD": "POST",
                "CONTENT_TYPE": self.headers.get("Content-Type"),
                "CONTENT_LENGTH": self.headers.get("Content-Length"),
            },
        )

        file_item = form["report"] if "report" in form else None
        if file_item is None or not getattr(file_item, "file", None):
            self.respond_json({"error": "Файл не получен"}, status=400)
            return

        original_name = Path(file_item.filename or "report").name
        safe_name = f"{int(time.time() * 1000)}-{original_name}"
        safe_name = safe_name.replace(" ", "_")
        dest = UPLOAD_DIR / safe_name

        # Read file content
        file_content = file_item.file.read()
        
        # Save file to disk
        with dest.open("wb") as f:
            f.write(file_content)

        # Extract GitLab metadata from form fields
        # Support both direct names and CI_ prefixed GitLab CI variables
        git_metadata = {}
        gitlab_fields = {
            "git_tag": ["git_tag", "CI_COMMIT_TAG"],
            "git_commit": ["git_commit", "CI_COMMIT_SHA", "CI_COMMIT_SHORT_SHA"],
            "git_branch": ["git_branch", "CI_COMMIT_REF_NAME", "CI_COMMIT_BRANCH"],
            "gitlab_pipeline_id": ["gitlab_pipeline_id", "CI_PIPELINE_ID"],
            "gitlab_job_id": ["gitlab_job_id", "CI_JOB_ID"],
            "gitlab_project": ["gitlab_project", "CI_PROJECT_NAME"],
            "gitlab_project_url": ["gitlab_project_url", "CI_PROJECT_URL"],
        }
        
        for key, field_names in gitlab_fields.items():
            for field_name in field_names:
                if field_name in form:
                    value = form[field_name].value if hasattr(form[field_name], 'value') else str(form[field_name])
                    if value:
                        git_metadata[key] = value
                        break

        # Parse JSON and extract metadata
        try:
            report_data = json.loads(file_content.decode("utf-8"))
            report_id = db.save_report(original_name, dest.name, dest, report_data, git_metadata)
        except (json.JSONDecodeError, Exception) as e:
            # If parsing fails, still save the file but without metadata
            self.respond_json({
                "error": f"Не удалось извлечь метаданные: {str(e)}",
                "url": f"{self.server_origin()}/uploads/{dest.name}",
                "name": original_name,
                "storedAs": dest.name
            }, status=400)
            return

        url = f"{self.server_origin()}/uploads/{dest.name}"
        response_data = {
            "url": url,
            "name": original_name,
            "storedAs": dest.name,
            "id": report_id
        }
        # Include GitLab metadata in response if provided
        if git_metadata:
            response_data["git_metadata"] = git_metadata
        self.respond_json(response_data)

    def do_GET(self):
        parsed = urlparse(self.path)
        if parsed.path == "/reports":
            reports = db.get_all_reports()
            totals = db.get_totals()
            files = []
            for report in reports:
                # Parse created_at timestamp (SQLite stores as string)
                created_at = report["created_at"]
                if isinstance(created_at, str):
                    try:
                        # Handle SQLite timestamp format: "YYYY-MM-DD HH:MM:SS"
                        if "T" in created_at:
                            dt = datetime.fromisoformat(created_at.replace("Z", "+00:00"))
                        else:
                            dt = datetime.strptime(created_at, "%Y-%m-%d %H:%M:%S")
                        created_timestamp = dt.timestamp()
                    except Exception:
                        created_timestamp = time.time()
                elif isinstance(created_at, (int, float)):
                    created_timestamp = float(created_at)
                else:
                    created_timestamp = time.time()
                
                file_data = {
                    "id": report["id"],
                    "name": report["filename"],
                    "url": f"{self.server_origin()}/uploads/{report['stored_filename']}",
                    "created": created_timestamp,
                    "report_type": report["report_type"],
                    "total_findings": report["total_findings"],
                    "total_files": report["total_files"],
                    "total_rules": report["total_rules"],
                    "severity": {
                        "critical": report["severity_critical"],
                        "high": report["severity_high"],
                        "medium": report["severity_medium"],
                        "low": report["severity_low"],
                        "info": report["severity_info"],
                    }
                }
                
                # Add GitLab metadata if present
                git_metadata = {}
                if report.get("git_tag"):
                    git_metadata["tag"] = report["git_tag"]
                if report.get("git_commit"):
                    git_metadata["commit"] = report["git_commit"]
                if report.get("git_branch"):
                    git_metadata["branch"] = report["git_branch"]
                if report.get("gitlab_pipeline_id"):
                    git_metadata["pipeline_id"] = report["gitlab_pipeline_id"]
                if report.get("gitlab_job_id"):
                    git_metadata["job_id"] = report["gitlab_job_id"]
                if report.get("gitlab_project"):
                    git_metadata["project"] = report["gitlab_project"]
                if report.get("gitlab_project_url"):
                    git_metadata["project_url"] = report["gitlab_project_url"]
                
                if git_metadata:
                    file_data["git"] = git_metadata
                
                files.append(file_data)
            self.respond_json({
                "files": files,
                "totals": {
                    "total_reports": totals.get("total_reports", 0) or 0,
                    "total_findings": totals.get("total_findings", 0) or 0,
                    "total_files": totals.get("total_files", 0) or 0,
                    "total_rules": totals.get("total_rules", 0) or 0,
                    "severity": {
                        "critical": totals.get("total_critical", 0) or 0,
                        "high": totals.get("total_high", 0) or 0,
                        "medium": totals.get("total_medium", 0) or 0,
                        "low": totals.get("total_low", 0) or 0,
                        "info": totals.get("total_info", 0) or 0,
                    }
                }
            })
            return

        # Strip query string so shared links like /?report=... return index.html
        self.path = parsed.path or "/"
        return super().do_GET()

    def do_DELETE(self):
        parsed = urlparse(self.path)
        if not parsed.path.startswith("/uploads/"):
            self.send_error(404, "Not Found")
            return

        stored_filename = Path(parsed.path).name
        
        # Get report info before deletion
        report = db.get_report_by_filename(stored_filename)
        if not report:
            self.respond_json({"error": "Отчёт не найден в базе данных"}, status=404)
            return

        # Delete from database
        deleted = db.delete_report(stored_filename)
        if not deleted:
            self.respond_json({"error": "Не удалось удалить отчёт из базы данных"}, status=500)
            return

        # Delete file from disk
        target = UPLOAD_DIR / stored_filename
        try:
            if target.exists():
                target.unlink()
            self.respond_json({"status": "deleted"})
        except OSError as e:
            self.respond_json({"error": f"Не удалось удалить файл: {str(e)}"}, status=500)

    def server_origin(self):
        host = self.headers.get("Host") or f"0.0.0.0:{DEFAULT_PORT}"
        scheme = "https" if self.server.server_address[1] == 443 else "http"
        return f"{scheme}://{host}"

    def respond_json(self, payload, status=200):
        data = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def log_message(self, format, *args):
        # Log to stdout for container visibility
        super().log_message(format, *args)


def run():
    server = HTTPServer(("0.0.0.0", DEFAULT_PORT), ReaderHandler)
    print(f"Reader server running at http://0.0.0.0:{DEFAULT_PORT}")
    server.serve_forever()


if __name__ == "__main__":
    run()
