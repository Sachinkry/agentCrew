# Cursor Rules — Python FastAPI Stack

## Project structure
- FastAPI app in `/app`. Routers in `/app/routers`. Models in `/app/models`.
- Use `uv` for dependency management. Pin versions in `pyproject.toml`.
- Python 3.12+. Use type hints everywhere.

## API design
- RESTful routes. Plural nouns. `GET /users`, `POST /users`, `GET /users/{id}`.
- Pydantic models for request/response. No raw dict returns.
- HTTP status codes: 200 OK, 201 Created, 204 No Content, 400 Bad Request, 401 Unauthorized, 404 Not Found, 422 Unprocessable Entity.
- Always paginate list endpoints (limit/offset or cursor).

## Database
- SQLAlchemy async with asyncpg. Alembic for migrations.
- One session per request via dependency injection.
- Never expose ORM models directly — use Pydantic schemas.

## Error handling
- Custom exception handlers for domain errors.
- Never return stack traces to clients.
- Log errors with structlog (JSON format).

## Auth
- JWT tokens via `python-jose`. Short expiry (15 min access, 7 day refresh).
- OAuth2PasswordBearer for bearer token extraction.
- Rate limiting on auth endpoints.

## Testing
- pytest + httpx async client.
- Test database via Docker or SQLite in-memory.
- 80% coverage minimum. All edge cases for auth.

## Code style
- Black formatter. isort imports. flake8 linting.
- Docstrings only for public functions. One-line max.
- Type: ignore only with explanatory comment.
