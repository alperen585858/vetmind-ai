# VetMind backend (FastAPI). Built by the root docker-compose.yml (issue #29).
FROM python:3.12-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1

WORKDIR /app

COPY requirements.txt .
RUN pip install -r requirements.txt

COPY app ./app
# Model Performance page reads saved evaluation results from here.
COPY eval ./eval

# All runtime data (SQLite files, quarantine, audit, lessons) lives under /app/data,
# which docker-compose mounts as a named volume.
RUN useradd --create-home --uid 1000 vetmind \
    && mkdir -p /app/data \
    && chown -R vetmind:vetmind /app/data
USER vetmind

EXPOSE 8000
HEALTHCHECK --interval=10s --timeout=3s --start-period=20s --retries=5 \
    CMD python -c "import urllib.request; urllib.request.urlopen('http://127.0.0.1:8000/api/v1/health', timeout=2)"

CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
