FROM python:3.13-slim

WORKDIR /app

# Copy everything first so the local src/ package is present when pip installs it
COPY . .

RUN pip install --no-cache-dir -r requirements.txt

CMD python -m uvicorn indirectrates.server:app --host 0.0.0.0 --port ${PORT:-8000}
