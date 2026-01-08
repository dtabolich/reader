# Semgrep / SARIF Report Reader

Простой сервис для чтения и визуализации отчётов Semgrep (JSON) и любых файлов SARIF. По умолчанию работает офлайн в браузере, но может быть развернут как сервис для совместного просмотра отчётов.

## Возможности
- Загрузка файлов перетаскиванием или выбором из проводника
- Поддержка Semgrep JSON и SARIF 2.1.0
- Карточки с общей статистикой: количество находок, файлов, уникальных правил
- Цветовое распределение по уровням серьёзности и интерактивные фильтры
- Поиск по пути, правилу и тексту сообщения
- Детальная карточка каждой находки с фрагментом кода, тегами и ссылками на правило
- Встроенные демо-отчёты (Semgrep JSON и SARIF) для быстрого просмотра интерфейса
- Возможность загрузить отчёт на сервер и получить ссылку (`?report=<url>`) для передачи разработчикам

## Развёртывание как сервиса

### Docker Compose (рекомендуется)
1. Соберите и запустите сервис:
   ```bash
   docker-compose up --build -d
   ```
2. Откройте `http://localhost:8081` и загрузите отчёт.
3. Отчёты сохраняются автоматически при загрузке через API.

В docker-compose хранилище отчётов и база данных вынесены в volumes (`uploads` и `db_data`), чтобы данные сохранялись между перезапусками.

### Docker Image
Для развёртывания в собственной инфраструктуре:

1. **Сборка образа:**
   ```bash
   docker build -t semgreport-viewer:latest .
   ```

2. **Запуск контейнера:**
   ```bash
   docker run -d \
     --name semgreport-viewer \
     -p 8080:8000 \
     -v semgreport-uploads:/app/uploads \
     -v semgreport-db:/app \
     -e PORT=8000 \
     --restart unless-stopped \
     semgreport-viewer:latest
   ```

3. **Публикация образа (опционально):**
   ```bash
   # Тегирование для registry
   docker tag semgreport-viewer:latest your-registry/semgreport-viewer:latest
   
   # Публикация
   docker push your-registry/semgreport-viewer:latest
   ```

### Переменные окружения
- `PORT` - Порт для запуска сервера (по умолчанию: 8000)

### Запуск локально без контейнера
1. Клонируйте репозиторий и перейдите в директорию проекта.
2. Запустите встроенный сервер загрузки (сохраняет отчёты в `./uploads`):
   ```bash
   python server.py
   ```
3. Откройте в браузере `http://localhost:8000` и загрузите свой `.json` или `.sarif` файл.
   После загрузки нажмите «Сохранить отчёт на сервере», чтобы получить ссылку.

> **Примечание:** если нужен только локальный офлайн-просмотр без ссылок, можно запустить любой статический сервер:
> ```bash
> python -m http.server 8000
> ```

## API

### Загрузка отчёта
**POST** `/upload`

Загрузить файл отчёта Semgrep JSON или SARIF на сервер.

**Запрос:**
- Content-Type: `multipart/form-data`
- Поля формы:
  - `report` (файл, обязательно): Файл отчёта (.json или .sarif)
  - `git_tag` (опционально): Git тег (например, "v1.2.3")
  - `git_commit` (опционально): Полный хеш коммита
  - `git_branch` (опционально): Имя ветки (например, "main", "feature/auth")
  - `gitlab_pipeline_id` (опционально): ID пайплайна GitLab
  - `gitlab_job_id` (опционально): ID джобы GitLab
  - `gitlab_project` (опционально): Имя проекта
  - `gitlab_project_url` (опционально): URL проекта

**Альтернативные имена переменных GitLab CI** (автоматически распознаются):
- `CI_COMMIT_TAG` → `git_tag`
- `CI_COMMIT_SHA` или `CI_COMMIT_SHORT_SHA` → `git_commit`
- `CI_COMMIT_REF_NAME` или `CI_COMMIT_BRANCH` → `git_branch`
- `CI_PIPELINE_ID` → `gitlab_pipeline_id`
- `CI_JOB_ID` → `gitlab_job_id`
- `CI_PROJECT_NAME` → `gitlab_project`
- `CI_PROJECT_URL` → `gitlab_project_url`

**Ответ:**
```json
{
  "url": "http://localhost:8000/uploads/1234567890-report.json",
  "name": "report.json",
  "storedAs": "1234567890-report.json",
  "id": 1,
  "git_metadata": {
    "git_tag": "v1.2.3",
    "git_commit": "abc123...",
    "git_branch": "main"
  }
}
```

### Получить все отчёты
**GET** `/reports`

Получить все загруженные отчёты с метаданными и агрегированной статистикой.

**Ответ:**
```json
{
  "files": [
    {
      "id": 1,
      "name": "report.json",
      "url": "http://localhost:8000/uploads/1234567890-report.json",
      "created": 1234567890.0,
      "report_type": "Semgrep JSON",
      "total_findings": 42,
      "total_files": 10,
      "total_rules": 5,
      "severity": {
        "critical": 2,
        "high": 8,
        "medium": 15,
        "low": 12,
        "info": 5
      },
      "git": {
        "tag": "v1.2.3",
        "commit": "abc123...",
        "branch": "main",
        "pipeline_id": "123456",
        "job_id": "789012",
        "project": "my-project",
        "project_url": "https://gitlab.com/org/my-project"
      }
    }
  ],
  "totals": {
    "total_reports": 10,
    "total_findings": 420,
    "total_files": 100,
    "total_rules": 50,
    "severity": {
      "critical": 20,
      "high": 80,
      "medium": 150,
      "low": 120,
      "info": 50
    }
  }
}
```

### Удалить отчёт
**DELETE** `/uploads/<filename>`

Удалить отчёт по имени сохранённого файла.

**Ответ:**
```json
{
  "status": "deleted"
}
```

## Интеграция с GitLab CI/CD

Добавьте следующее в ваш `.gitlab-ci.yml` для автоматической загрузки отчётов Semgrep:

```yaml
semgrep:
  image: returntocorp/semgrep:latest
  stage: test
  script:
    # Запустить Semgrep и сгенерировать отчёт
    - semgrep --json --output=report.json .
    # Загрузить отчёт в SemgReport Viewer
    - |
      curl -X POST "${SEMGREPORT_VIEWER_URL}/upload" \
        -F "report=@report.json" \
        -F "git_tag=${CI_COMMIT_TAG}" \
        -F "git_commit=${CI_COMMIT_SHA}" \
        -F "git_branch=${CI_COMMIT_REF_NAME}" \
        -F "gitlab_pipeline_id=${CI_PIPELINE_ID}" \
        -F "gitlab_job_id=${CI_JOB_ID}" \
        -F "gitlab_project=${CI_PROJECT_NAME}" \
        -F "gitlab_project_url=${CI_PROJECT_URL}" \
        -F "CI_COMMIT_TAG=${CI_COMMIT_TAG}" \
        -F "CI_COMMIT_SHA=${CI_COMMIT_SHA}" \
        -F "CI_COMMIT_REF_NAME=${CI_COMMIT_REF_NAME}" \
        -F "CI_PIPELINE_ID=${CI_PIPELINE_ID}" \
        -F "CI_JOB_ID=${CI_JOB_ID}" \
        -F "CI_PROJECT_NAME=${CI_PROJECT_NAME}" \
        -F "CI_PROJECT_URL=${CI_PROJECT_URL}"
  artifacts:
    reports:
      junit: report.json
    paths:
      - report.json
    expire_in: 1 week
  only:
    - merge_requests
    - main
    - develop
  variables:
    SEMGREPORT_VIEWER_URL: "https://your-semgreport-viewer-instance.com"
```

**Настройка:**
1. Добавьте `SEMGREPORT_VIEWER_URL` как переменную CI/CD в GitLab:
   - Перейдите в **Settings → CI/CD → Variables**
   - Добавьте переменную: `SEMGREPORT_VIEWER_URL` = `https://your-instance.com`
   - Отметьте как **Protected** и **Masked** при необходимости

2. Для формата SARIF:
```yaml
semgrep:
  image: returntocorp/semgrep:latest
  script:
    - semgrep --sarif --output=report.sarif .
    - |
      curl -X POST "${SEMGREPORT_VIEWER_URL}/upload" \
        -F "report=@report.sarif" \
        -F "CI_COMMIT_SHA=${CI_COMMIT_SHA}" \
        -F "CI_COMMIT_REF_NAME=${CI_COMMIT_REF_NAME}" \
        -F "CI_PIPELINE_ID=${CI_PIPELINE_ID}" \
        -F "CI_JOB_ID=${CI_JOB_ID}" \
        -F "CI_PROJECT_NAME=${CI_PROJECT_NAME}" \
        -F "CI_PROJECT_URL=${CI_PROJECT_URL}"
```

## Получение отчётов Semgrep
- JSON: `semgrep --json > report.json`
- SARIF: `semgrep --sarif > report.sarif`

## Структура
- `index.html` — разметка и точки подключения стилей/скриптов
- `styles.css` — оформление интерфейса
- `app.js` — логика парсинга отчётов и визуализации
- `samples/` — демонстрационные отчёты Semgrep JSON и SARIF

## Линтинг/тестирование
Отдельных зависимостей не требуется. Для быстрой проверки валидности примеров можно выполнить:
```bash
python -m json.tool samples/semgrep-sample.json
python -m json.tool samples/semgrep-sample.sarif
```
