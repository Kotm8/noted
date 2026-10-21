FROM python:3.14.5-slim
WORKDIR /app
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1 NOTED_STORAGE_PATH=/data/attachments
COPY backend/requirements.lock ./requirements.lock
RUN pip install --no-cache-dir -r requirements.lock && useradd --create-home noted && mkdir -p /data/attachments && chown noted:noted /data/attachments
COPY backend/app ./app
COPY backend/alembic ./alembic
COPY backend/alembic.ini ./alembic.ini
ARG NOTED_BUILD_COMMIT=development
ARG NOTED_BUILD_VERSION=0.2.3
ENV NOTED_BUILD_COMMIT=$NOTED_BUILD_COMMIT NOTED_BUILD_VERSION=$NOTED_BUILD_VERSION
USER noted
EXPOSE 8000
CMD ["uvicorn", "app.main:create_app", "--factory", "--host", "0.0.0.0", "--port", "8000", "--workers", "1", "--no-proxy-headers"]
