# Compass ID API Documentation

Base URL: `http://localhost:3001/api`

## Authentication

All authenticated endpoints require a Bearer token in the Authorization header:
```
Authorization: Bearer <your_jwt_token>
```

---

## Auth Endpoints

### POST /auth/register
Register a new user account.

**Request Body:**
```json
{
  "email": "user@example.com",
  "password": "password123",
  "first_name": "John",
  "last_name": "Doe",
  "institution": "Research University"
}
```

**Response (201):**
```json
{
  "message": "User registered successfully",
  "user": {
    "id": "uuid",
    "email": "user@example.com",
    "first_name": "John",
    "last_name": "Doe",
    "institution": "Research University"
  },
  "token": "jwt_token"
}
```

---

### POST /auth/login
Authenticate and receive JWT token.

**Request Body:**
```json
{
  "email": "user@example.com",
  "password": "password123"
}
```

**Response (200):**
```json
{
  "message": "Login successful",
  "user": {
    "id": "uuid",
    "email": "user@example.com",
    "first_name": "John",
    "last_name": "Doe"
  },
  "token": "jwt_token"
}
```

---

### GET /auth/profile
Get current user profile. **Requires authentication.**

**Response (200):**
```json
{
  "user": {
    "id": "uuid",
    "email": "user@example.com",
    "orcid_id": null,
    "first_name": "John",
    "last_name": "Doe",
    "institution": "Research University",
    "created_at": "2024-01-01T00:00:00.000Z"
  },
  "stats": {
    "submissions": 5
  }
}
```

---

## Research Endpoints

### POST /research/submit
Submit new research with COMPASS metadata. **Requires authentication.**

**Request Body:**
```json
{
  "doi": "10.1234/example.2024.001",
  "title": "Marine Conservation in Antarctic Waters",
  "abstract": "This study examines...",
  "publication_year": 2024,
  "journal": "Marine Ecology Progress Series",
  "authors": [
    {
      "name": "John Doe",
      "orcid": "0000-0001-2345-6789"
    }
  ],
  "compass_metadata": {
    "framework_alignment": ["SDG-14.2", "CCAMLR"],
    "geo_scope": {
      "type": "Point",
      "coordinates": [-60.5, -62.3]
    },
    "geo_scope_text": "Antarctic Peninsula",
    "taxon_scope": [
      {
        "scientific_name": "Euphausia superba",
        "common_name": "Antarctic krill",
        "taxon_rank": "species"
      }
    ],
    "temporal_start": "2020-01-01",
    "temporal_end": "2023-12-31",
    "methods": ["Field surveys", "Population modeling"]
  }
}
```

**Response (201):**
```json
{
  "message": "Research submitted successfully",
  "research": {
    "id": "uuid",
    "doi": "10.1234/example.2024.001",
    "title": "Marine Conservation in Antarctic Waters",
    "user_id": "uuid",
    "created_at": "2024-01-01T00:00:00.000Z"
  }
}
```

---

### GET /research/search
Search research with optional filters.

**Query Parameters:**
- `frameworks` (string, comma-separated): Filter by framework codes
- `keywords` (string): Search in title and abstract
- `year_from` (integer): Minimum publication year
- `year_to` (integer): Maximum publication year
- `page` (integer, default: 1): Page number
- `limit` (integer, default: 20): Results per page

**Example:**
```
GET /research/search?frameworks=SDG-14.2,CCAMLR&keywords=marine&year_from=2020&page=1&limit=10
```

**Response (200):**
```json
{
  "results": [
    {
      "id": "uuid",
      "doi": "10.1234/example.2024.001",
      "title": "Marine Conservation in Antarctic Waters",
      "abstract": "This study examines...",
      "publication_year": 2024,
      "journal": "Marine Ecology Progress Series",
      "framework_alignment": ["SDG-14.2", "CCAMLR"],
      "geo_scope_text": "Antarctic Peninsula",
      "first_name": "John",
      "last_name": "Doe",
      "institution": "Research University",
      "created_at": "2024-01-01T00:00:00.000Z"
    }
  ],
  "pagination": {
    "page": 1,
    "limit": 20,
    "total": 45
  }
}
```

---

### GET /research/:id
Get detailed information about specific research.

**Response (200):**
```json
{
  "id": "uuid",
  "doi": "10.1234/example.2024.001",
  "title": "Marine Conservation in Antarctic Waters",
  "abstract": "This study examines...",
  "publication_year": 2024,
  "journal": "Marine Ecology Progress Series",
  "authors": [...],
  "framework_alignment": ["SDG-14.2", "CCAMLR"],
  "geo_scope": {
    "type": "Point",
    "coordinates": [-60.5, -62.3]
  },
  "geo_scope_text": "Antarctic Peninsula",
  "taxon_scope": [...],
  "temporal_start": "2020-01-01",
  "temporal_end": "2023-12-31",
  "methods": ["Field surveys", "Population modeling"],
  "first_name": "John",
  "last_name": "Doe",
  "institution": "Research University"
}
```

---

### GET /research/my-research
Get current user's research submissions. **Requires authentication.**

**Query Parameters:**
- `page` (integer, default: 1)
- `limit` (integer, default: 20)

**Response (200):**
```json
{
  "results": [...],
  "pagination": {
    "page": 1,
    "limit": 20,
    "total": 5
  }
}
```

---

### PUT /research/:id/suggest
Suggest metadata changes for research. **Requires authentication.**

**Request Body:**
```json
{
  "suggestion_type": "framework",
  "suggestion_data": {
    "add_frameworks": ["SDG-15.1"]
  },
  "note": "This research also addresses terrestrial ecosystems"
}
```

**Response (201):**
```json
{
  "message": "Suggestion submitted successfully",
  "suggestion": {
    "id": "uuid",
    "research_id": "uuid",
    "suggested_by": "uuid",
    "suggestion_type": "framework",
    "status": "pending",
    "created_at": "2024-01-01T00:00:00.000Z"
  }
}
```

---

## Researchers Endpoints

### GET /researchers/find
Find researchers by framework or geography.

**Query Parameters:**
- `frameworks` (string, comma-separated): Filter by framework codes
- `geo_region` (string): Geographic region
- `page` (integer, default: 1)
- `limit` (integer, default: 20)

**Response (200):**
```json
{
  "researchers": [
    {
      "id": "uuid",
      "first_name": "John",
      "last_name": "Doe",
      "institution": "Research University",
      "orcid_id": "0000-0001-2345-6789",
      "research_count": 5,
      "frameworks": [["SDG-14.2", "CCAMLR"], ["SDG-15.1"]]
    }
  ],
  "pagination": {
    "page": 1,
    "limit": 20
  }
}
```

---

## Statistics Endpoints

### GET /stats
Get platform statistics.

**Response (200):**
```json
{
  "total_research": 150,
  "total_researchers": 45,
  "total_frameworks": 12,
  "recent_submissions": [
    {
      "id": "uuid",
      "title": "Marine Conservation in Antarctic Waters",
      "created_at": "2024-01-01T00:00:00.000Z",
      "first_name": "John",
      "last_name": "Doe"
    }
  ],
  "top_frameworks": [
    {
      "framework": "SDG-14.2",
      "count": 25
    }
  ]
}
```

---

## Error Responses

All endpoints may return the following error responses:

### 400 Bad Request
```json
{
  "error": "Validation Error",
  "details": ["Email is required", "Password must be at least 8 characters"]
}
```

### 401 Unauthorized
```json
{
  "error": "Unauthorized",
  "message": "Invalid or missing authentication token"
}
```

### 404 Not Found
```json
{
  "error": "Not Found",
  "message": "Resource not found"
}
```

### 409 Conflict
```json
{
  "error": "Conflict",
  "message": "Resource already exists"
}
```

### 500 Internal Server Error
```json
{
  "error": "Internal Server Error",
  "message": "An error occurred"
}
```

---

## Rate Limiting

API requests are rate limited to 100 requests per 15 minutes per IP address. Exceeding this limit will result in a 429 Too Many Requests response.

---

## CORS

The API accepts requests from the configured CORS origin (default: `http://localhost:3000`). Set the `CORS_ORIGIN` environment variable to change this.

---

## Database Schema

### Users Table
- id (UUID, primary key)
- email (VARCHAR, unique)
- password_hash (VARCHAR)
- orcid_id (VARCHAR, nullable)
- first_name (VARCHAR, nullable)
- last_name (VARCHAR, nullable)
- institution (VARCHAR, nullable)
- created_at (TIMESTAMP)
- updated_at (TIMESTAMP)

### Research Items Table
- id (UUID, primary key)
- user_id (UUID, foreign key)
- doi (VARCHAR, nullable)
- title (TEXT)
- abstract (TEXT, nullable)
- publication_year (INTEGER, nullable)
- journal (VARCHAR, nullable)
- authors (JSONB, nullable)
- status (VARCHAR, default: 'published')
- created_at (TIMESTAMP)
- updated_at (TIMESTAMP)

### COMPASS Metadata Table
- id (UUID, primary key)
- research_id (UUID, foreign key, unique)
- framework_alignment (JSONB)
- geo_scope (GEOGRAPHY)
- geo_scope_text (TEXT, nullable)
- taxon_scope (JSONB, nullable)
- temporal_start (DATE, nullable)
- temporal_end (DATE, nullable)
- methods (JSONB, nullable)
- created_at (TIMESTAMP)
- updated_at (TIMESTAMP)

### Frameworks Table
- id (UUID, primary key)
- code (VARCHAR, unique)
- name (VARCHAR)
- description (TEXT, nullable)
- parent_id (UUID, foreign key, nullable)
- version (VARCHAR, nullable)
- category (VARCHAR, nullable)
- created_at (TIMESTAMP)

### Metadata Suggestions Table
- id (UUID, primary key)
- research_id (UUID, foreign key)
- suggested_by (UUID, foreign key)
- suggestion_type (VARCHAR)
- suggestion_data (JSONB)
- status (VARCHAR, default: 'pending')
- reviewed_by (UUID, foreign key, nullable)
- review_note (TEXT, nullable)
- created_at (TIMESTAMP)
- reviewed_at (TIMESTAMP, nullable)