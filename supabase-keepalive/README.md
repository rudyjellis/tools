# Supabase Keepalive Worker

A Cloudflare Worker that prevents Supabase free tier databases from hibernating by executing real database queries on a schedule.

## Why This Approach?

Supabase tracks **database activity** to determine if a project is active. Simply pinging the REST API endpoint (`/rest/v1/`) may not count as activity. This worker queries a dedicated `keepalive` table, ensuring each request executes a real `SELECT` query that Supabase recognizes as activity.

## Features

- Executes real database queries (not just API pings) to prevent hibernation
- Runs automatically every 6 hours via cron trigger
- Supports multiple Supabase projects (up to 99)
- Manual HTTP trigger for testing
- Graceful error handling (one failed project doesn't break others)
- Status endpoint with 24-hour history tracking via Cloudflare KV

## Quick Start

1. Install dependencies: `npm install`
2. Login to Cloudflare: `npx wrangler login`
3. Create the `keepalive` table in each Supabase project (see below)
4. Add your Supabase credentials as secrets
5. Create a KV namespace for status tracking
6. Deploy: `npm run deploy`

## Setup

### Prerequisites

- [Node.js](https://nodejs.org/) v22.18.0+ (tested with v22.18.0)
- [Wrangler CLI](https://developers.cloudflare.com/workers/wrangler/install-and-update/) v4.54.0+ (installed via npm)
- npm v11.5.2+
- A Cloudflare account
- One or more Supabase projects

### 1. Install Dependencies

```bash
npm install
```

### 2. Login to Cloudflare

```bash
npx wrangler login
```

### 3. Create the Keepalive Table

**Required for each Supabase project.** Run this SQL in the Supabase Dashboard → SQL Editor:

```sql
-- Create the keepalive table
CREATE TABLE public.keepalive (
  id integer PRIMARY KEY DEFAULT 1,
  pinged_at timestamptz DEFAULT now()
);

-- Insert a single row
INSERT INTO public.keepalive (id) VALUES (1);

-- Enable Row Level Security and allow anonymous reads
ALTER TABLE public.keepalive ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Allow anonymous read" ON public.keepalive FOR SELECT USING (true);
```

### 4. Configure Supabase Projects

Add your Supabase project credentials using the Wrangler CLI. Projects are numbered starting from 1.

#### Adding your first project:

```bash
# Add the Supabase URL (can be a plain variable)
npx wrangler secret put SUPABASE_URL_1
# When prompted, enter: https://your-project-id.supabase.co

# Add the anon key (should be a secret)
npx wrangler secret put SUPABASE_ANON_KEY_1
# When prompted, paste your Supabase anon/public key
```

#### Adding additional projects:

```bash
# Second project
npx wrangler secret put SUPABASE_URL_2
npx wrangler secret put SUPABASE_ANON_KEY_2

# Third project
npx wrangler secret put SUPABASE_URL_3
npx wrangler secret put SUPABASE_ANON_KEY_3

# And so on...
```

#### Finding Your Supabase Credentials

1. Go to your [Supabase Dashboard](https://supabase.com/dashboard)
2. Select your project
3. Go to **Settings** > **API**
4. Copy the **Project URL** (e.g., `https://abc123.supabase.co`)
5. Copy the **anon/public** key under "Project API keys"

### 5. Configure KV Namespace

The worker uses Cloudflare KV to store query history for the status endpoint.

#### Create the KV namespace:

```bash
npx wrangler kv namespace create "KEEPALIVE_STATUS"
```

This will output something like:

```
{ binding = "KEEPALIVE_STATUS", id = "abc123..." }
```

#### Update wrangler.toml:

Copy the namespace ID from the output and update `wrangler.toml`:

```toml
[[kv_namespaces]]
binding = "KEEPALIVE_STATUS"
id = "abc123..."  # Your actual namespace ID
```

#### For local development (optional):

Create a preview namespace for local testing:

```bash
npx wrangler kv namespace create "KEEPALIVE_STATUS" --preview
```

Add the preview ID to `wrangler.toml`:

```toml
[[kv_namespaces]]
binding = "KEEPALIVE_STATUS"
id = "your-namespace-id"
preview_id = "your-preview-namespace-id"  # For local dev
```

## Local Development

Test the worker locally:

```bash
npm run dev
```

This starts a local server (usually at `http://localhost:8787`).

### Testing locally with secrets

For local testing, create a `.dev.vars` file (git-ignored):

```bash
# .dev.vars
SUPABASE_URL_1=https://your-project.supabase.co
SUPABASE_ANON_KEY_1=your-anon-key-here
```

Then visit:
- `http://localhost:8787/` - Triggers keepalive and returns JSON results
- `http://localhost:8787/health` - Health check endpoint
- `http://localhost:8787/status` - View last query results and history

### Testing the cron locally

Wrangler can simulate cron triggers:

```bash
npx wrangler dev --test-scheduled
```

Then trigger it with:

```bash
curl "http://localhost:8787/__scheduled?cron=0+*/6+*+*+*"
```

## Deployment

Deploy to Cloudflare Workers:

```bash
npm run deploy
```

After deployment, the worker will:
- Run automatically every 6 hours
- Be accessible at `https://supabase-keepalive.<your-subdomain>.workers.dev`

## Monitoring

View real-time logs:

```bash
npm run tail
```

## API Endpoints

### GET /

Manually triggers the keepalive check and returns results.

**Response:**

```json
{
  "success": true,
  "message": "Pinged 2 project(s): 2 succeeded, 0 failed",
  "results": [
    {
      "project": "my-project",
      "success": true,
      "statusCode": 200,
      "duration": 145,
      "timestamp": "2024-01-15T12:00:00.000Z"
    }
  ],
  "summary": {
    "total": 2,
    "succeeded": 2,
    "failed": 0
  }
}
```

### GET /health

Simple health check endpoint.

**Response:**

```json
{
  "status": "ok"
}
```

### GET /status

Returns the status of the last keepalive run and 24-hour history summary.

**Response (when data available):**

```json
{
  "service": "supabase-keepalive",
  "lastRun": "2025-12-26T12:00:00.000Z",
  "nextRun": "Runs every 6 hours",
  "status": "healthy",
  "trigger": "cron",
  "results": [
    {
      "project": "my-project",
      "success": true,
      "statusCode": 200,
      "duration": 145,
      "timestamp": "2025-12-26T12:00:00.000Z"
    }
  ],
  "summary": {
    "total": 2,
    "succeeded": 2,
    "failed": 0
  },
  "history": {
    "available": true,
    "runCount": 4,
    "oldestRun": "2025-12-25T12:00:00.000Z"
  }
}
```

**Response (when no data yet):**

```json
{
  "service": "supabase-keepalive",
  "status": "no_data",
  "message": "No ping history available yet. The worker runs every 6 hours.",
  "nextRun": "Runs every 6 hours"
}
```

**Status Codes:**
- `200 OK`: All projects healthy or no data available yet
- `503 Service Unavailable`: One or more projects failed in the last run

**Features:**
- Includes CORS headers (`Access-Control-Allow-Origin: *`) for browser access
- Shows 24-hour history of keepalive runs
- Distinguishes between cron-triggered and manual runs
- KV storage has eventual consistency (updates may take up to 60 seconds to propagate globally)

## How It Works

The worker queries the `keepalive` table in each Supabase project via the REST API (`/rest/v1/keepalive?select=id`). This:

1. Authenticates using the project's anon key
2. Executes a real database query (SELECT), which Supabase counts as activity
3. Prevents hibernation by resetting the 7-day inactivity timer
4. Returns quickly with minimal data transfer

Free tier Supabase projects hibernate after 7 days of inactivity. By querying the database every 6 hours, this worker ensures your projects stay active.

## Troubleshooting

### "No projects configured" error

Make sure you've added both `SUPABASE_URL_N` and `SUPABASE_ANON_KEY_N` for at least one project (where N is a number starting from 1).

### 401 Unauthorized errors

- Verify your anon key is correct
- Check that the key hasn't been regenerated in Supabase

### 404 Not Found or "relation does not exist" errors

- Make sure you've created the `keepalive` table in your Supabase project (see [Step 3](#3-create-the-keepalive-table))
- Verify the RLS policy allows anonymous reads

### Network errors

- Confirm the Supabase URL is correct
- Check if the project exists and hasn't been deleted

## License

MIT
