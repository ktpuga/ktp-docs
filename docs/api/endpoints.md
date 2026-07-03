---
sidebar_position: 2
---

# API Endpoints

Base URL (production): `https://api2.ugaktp.com`  
Base URL (internal): `http://10.0.0.53:4000`

All protected routes require `Authorization: Bearer <access_token>`.

---

## Users

### `POST /users/sync`

**Auth required.** Called automatically on every login by the website (`auth.ts`). Creates or updates the user's row in the database and returns their `profile_complete` status.

**Request body:**
```json
{
  "authentik_id": "uuid",
  "username": "jsmith",
  "member_group": "active"
}
```

**Response:**
```json
{
  "authentik_id": "uuid",
  "profile_complete": false
}
```

The `member_group` is determined by group priority: `eboard > chair > active > pledge > alumni`.

---

### `GET /users/me`

**Auth required.** Returns the full profile row for the authenticated user.

**Response:**
```json
{
  "authentik_id": "uuid",
  "username": "jsmith",
  "first_name": "John",
  "last_name": "Smith",
  "preferred_name": "John",
  "dob": "2003-01-15",
  "major": "Computer Science",
  "graduation_date": "Spring 2026",
  "phone": "4045550000",
  "email": "jsmith@uga.edu",
  "linkedin_url": "https://linkedin.com/in/jsmith",
  "pledge_class": "Alpha",
  "member_group": "active",
  "profile_complete": true,
  "created_at": "...",
  "updated_at": "..."
}
```

---

### `PUT /users/me/profile`

**Auth required.** Saves profile fields and sets `profile_complete = true`. Accepts `multipart/form-data`.

**Form fields:**
- `first_name`, `last_name`, `preferred_name`
- `dob` — date of birth
- `major`
- `graduation_date` — string like "Spring 2026" (the form combines semester + year before sending)
- `phone`
- `email`
- `linkedin_url`
- `pledge_class`

**Response:**
```json
{ "profile_complete": true }
```

After a successful response, the website calls `update({ profile_complete: true })` to update the NextAuth session without a round-trip.

---

## Members

### `GET /members`

**Auth required.** Returns a list of members. Supports optional `?group=` query param to filter by `member_group`.

**Query params:**
- `group` — one of `active`, `pledge`, `eboard`, `chair`, `alumni`

**Response:**
```json
[
  {
    "authentik_id": "uuid",
    "first_name": "John",
    "last_name": "Smith",
    "member_group": "active",
    "graduation_date": "Spring 2026",
    ...
  }
]
```

---

### `GET /members/:id`

**Auth required.** Returns a single member by `authentik_id`.

---

## Events

No auth required on any events route.

### `GET /events`

Returns all events.

### `POST /events`

Creates a new event.

**Request body:**
```json
{
  "title": "General Meeting",
  "description": "Weekly chapter meeting",
  "date": "2026-02-01T18:00:00Z",
  "location": "Boyd GSRC"
}
```

### `PUT /events/:id`

Updates an event by ID.

### `DELETE /events/:id`

Deletes an event by ID.

---

## Photos

### `GET /photos`

Public. Returns photo metadata.

### `POST /photos`

**Returns 501 Not Implemented.** Immich integration is deferred.

---

## Admin

### `GET /admin/users`

**Auth required — eboard only.** Returns all users in the database.

Middleware verifies that `req.user.groups` contains `"eboard"`. Returns 403 otherwise.

---

## Webhooks

### `POST /webhooks/authentik`

Called by Authentik's notification transport when a user is deleted.

**Headers:**
```
X-Authentik-Token: <WEBHOOK_SECRET>
```

**Request body (Authentik format):**
```json
{
  "action": "model_deleted",
  "model": {
    "model_name": "user",
    "pk": 42
  }
}
```

> **Current status:** The `X-Authentik-Token` header is not being sent by Authentik's transport (known issue — investigated, not resolved). Workaround: manually delete rows from the `users` table when a user is removed from Authentik.
>
> ```sql
> DELETE FROM users WHERE username = 'jsmith';
> ```

---

## Error Responses

| Status | Meaning |
|--------|---------|
| `400` | Bad request — missing or invalid fields |
| `401` | Missing or invalid Bearer token |
| `403` | Authenticated but not authorized (wrong group) |
| `404` | Resource not found |
| `500` | Internal server error |

All error responses use the format:
```json
{ "message": "Error description" }
```