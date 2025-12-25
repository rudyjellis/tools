# Supabase Keepalive Worker

A Cloudflare Worker that prevents Supabase free tier databases from hibernating by pinging them on a schedule.

## Features

- Runs automatically every 12 hours via cron trigger
- Supports multiple Supabase projects
- Manual HTTP trigger for testing
- Graceful error handling (one failed project doesn't break others)
- Detailed logging of ping results

## Setup

### Prerequisites

- [Node.js](https://nodejs.org/) (v18 or later)
- [Wrangler CLI](https://developers.cloudflare.com/workers/wrangler/install-and-update/)
- A Cloudflare account
- One or more Supabase projects

### Installation

1. Install dependencies:

```bash
npm install
```

2. Login to Cloudflare (if not already):

```bash
npx wrangler login
```

### Configure Supabase Projects

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

### Finding Your Supabase Credentials

1. Go to your [Supabase Dashboard](https://supabase.com/dashboard)
2. Select your project
3. Go to **Settings** > **API**
4. Copy the **Project URL** (e.g., `https://abc123.supabase.co`)
5. Copy the **anon/public** key under "Project API keys"

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

### Testing the cron locally

Wrangler can simulate cron triggers:

```bash
npx wrangler dev --test-scheduled
```

Then trigger it with:

```bash
curl "http://localhost:8787/__scheduled?cron=0+*/12+*+*+*"
```

## Deployment

Deploy to Cloudflare Workers:

```bash
npm run deploy
```

After deployment, the worker will:
- Run automatically every 12 hours
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

## How It Works

The worker makes a lightweight GET request to each Supabase project's REST API endpoint (`/rest/v1/`). This request:

1. Authenticates using the project's anon key
2. Registers activity with Supabase, preventing hibernation
3. Returns quickly with minimal data transfer

Free tier Supabase projects hibernate after 7 days of inactivity. By pinging every 12 hours, this worker ensures your databases stay active.

## Troubleshooting

### "No projects configured" error

Make sure you've added both `SUPABASE_URL_N` and `SUPABASE_ANON_KEY_N` for at least one project (where N is a number starting from 1).

### 401 Unauthorized errors

- Verify your anon key is correct
- Check that the key hasn't been regenerated in Supabase

### Network errors

- Confirm the Supabase URL is correct
- Check if the project exists and hasn't been deleted

## License

MIT
