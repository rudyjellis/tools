# Claude Code Sandbox

A Cloudflare Worker + Sandbox that runs Claude Code in isolated containers. Send a Git repository URL and a task description, and Claude Code will execute the task in a secure, sandboxed environment.

## Features

- **Isolated Execution**: Each task runs in a secure Cloudflare container
- **Streaming Output**: Real-time SSE streaming of Claude Code output
- **Auto-Summary**: Automatic extraction of change summaries from output
- **Flexible Isolation**: Custom sandbox IDs for user/session isolation
- **Branch Support**: Checkout any branch from the repository

## Prerequisites

- [Node.js](https://nodejs.org/) (v18+)
- [Docker](https://www.docker.com/) (for local development)
- [Wrangler CLI](https://developers.cloudflare.com/workers/wrangler/) (installed via npm)
- [Anthropic API Key](https://console.anthropic.com/)

## Quick Start

### 1. Install dependencies

```bash
cd cloudflare-sandbox
npm install
```

### 2. Configure environment variables

Copy the example file and add your API key:

```bash
cp .dev.vars.example .dev.vars
```

Edit `.dev.vars` and set your Anthropic API key:

```
ANTHROPIC_API_KEY=sk-ant-your-actual-key-here
```

### 3. Run locally

```bash
npm run dev
```

The first run will build the Docker container (2-3 minutes). Subsequent runs are much faster.

The API will be available at `http://localhost:8787`

### 4. Test the endpoint

```bash
# Health check
curl http://localhost:8787/

# Run Claude Code on a repository
curl -X POST http://localhost:8787/run \
  -H "Content-Type: application/json" \
  -d '{
    "repoUrl": "https://github.com/user/repo.git",
    "task": "Add a comment explaining what the main function does"
  }'

# Stream output in real-time
curl -N -X POST http://localhost:8787/run/stream \
  -H "Content-Type: application/json" \
  -d '{
    "repoUrl": "https://github.com/user/repo.git",
    "task": "Refactor the utils module"
  }'
```

## API Reference

### `GET /`

Health check and API information.

**Response:**
```json
{
  "status": "ok",
  "service": "Claude Code Sandbox API",
  "version": "1.1.0",
  "endpoints": {
    "GET /": "Health check and API info",
    "POST /run": "Run Claude Code on a repository (JSON response)",
    "POST /run/stream": "Run Claude Code with streaming output (SSE)"
  }
}
```

### `POST /run`

Run Claude Code on a Git repository. Returns a JSON response when complete.

**Request body:**
```json
{
  "repoUrl": "https://github.com/user/repo.git",
  "task": "Description of what Claude Code should do",
  "branch": "main",
  "sandboxId": "user-123-session",
  "includeSummary": true
}
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `repoUrl` | string | Yes | Git repository URL (https://, git@, or http://) |
| `task` | string | Yes | Natural language description of the task |
| `branch` | string | No | Branch to checkout (default: `main`) |
| `sandboxId` | string | No | Custom sandbox ID for isolation (default: hash of repoUrl) |
| `includeSummary` | boolean | No | Include auto-generated summary (default: `true`) |

**Success response (200):**
```json
{
  "success": true,
  "stdout": "Claude Code output...",
  "stderr": "",
  "exitCode": 0,
  "duration": 45000,
  "repoPath": "/workspace/repo",
  "commit": "abc123def456...",
  "summary": "Changes: modified src/utils.ts, created src/helpers.ts"
}
```

**Error response (400/500):**
```json
{
  "error": "Error message",
  "details": "Additional details about the error"
}
```

### `POST /run/stream`

Run Claude Code with real-time streaming output via Server-Sent Events (SSE).

**Request body:** Same as `POST /run`

**SSE Event Types:**

| Event | Description | Data |
|-------|-------------|------|
| `status` | Progress updates | `{ "message": "Cloning repository..." }` |
| `stdout` | Real-time stdout | `{ "data": "..." }` |
| `stderr` | Real-time stderr | `{ "data": "..." }` |
| `complete` | Final result | Full response object (same as `/run`) |
| `error` | Error occurred | `{ "error": "..." }` |

**Example SSE stream:**
```
event: status
data: {"message":"Initializing sandbox..."}

event: status
data: {"message":"Cloning repository..."}

event: status
data: {"message":"Repository cloned","repoPath":"/workspace/repo","commit":"abc123"}

event: status
data: {"message":"Running Claude Code..."}

event: stdout
data: {"data":"Analyzing codebase...\n"}

event: stdout
data: {"data":"Modified src/utils.ts\n"}

event: complete
data: {"success":true,"stdout":"...","stderr":"","exitCode":0,"summary":"..."}
```

**JavaScript client example:**
```javascript
const response = await fetch('http://localhost:8787/run/stream', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    repoUrl: 'https://github.com/user/repo.git',
    task: 'Add error handling to the API endpoints'
  })
});

const reader = response.body.getReader();
const decoder = new TextDecoder();

while (true) {
  const { done, value } = await reader.read();
  if (done) break;

  const text = decoder.decode(value);
  const lines = text.split('\n');

  for (const line of lines) {
    if (line.startsWith('data: ')) {
      const data = JSON.parse(line.slice(6));
      console.log(data);
    }
  }
}
```

## Sandbox Isolation Strategies

The `sandboxId` parameter controls how sandboxes are reused or isolated:

### Default (repo-based)
Without `sandboxId`, sandboxes are isolated by repository URL. Same repo = same sandbox (with cached clone).

```json
{ "repoUrl": "https://github.com/user/repo.git", "task": "..." }
// Sandbox ID: claude-sandbox-usergithubrepo
```

### User isolation
Provide a user ID to give each user their own sandbox:

```json
{
  "repoUrl": "https://github.com/user/repo.git",
  "task": "...",
  "sandboxId": "user-12345"
}
// Sandbox ID: claude-user-12345
```

### Session isolation
Use session IDs for completely isolated executions:

```json
{
  "repoUrl": "https://github.com/user/repo.git",
  "task": "...",
  "sandboxId": "session-abc123-xyz789"
}
// Sandbox ID: claude-session-abc123-xyz789
```

### Multi-tenant isolation
Combine tenant and user for SaaS applications:

```json
{
  "repoUrl": "https://github.com/user/repo.git",
  "task": "...",
  "sandboxId": "tenant-acme-user-456"
}
```

## Deployment

### 1. Set the secret

```bash
wrangler secret put ANTHROPIC_API_KEY
```

Enter your Anthropic API key when prompted.

### 2. Deploy

```bash
npm run deploy
```

Your Worker will be deployed to `https://claude-code-sandbox.<your-subdomain>.workers.dev`

## Project Structure

```
cloudflare-sandbox/
├── Dockerfile           # Sandbox container with Claude Code CLI
├── package.json         # Dependencies and scripts
├── tsconfig.json        # TypeScript configuration
├── wrangler.jsonc       # Wrangler config with container/DO bindings
├── .dev.vars.example    # Example environment variables
├── README.md            # This file
└── src/
    └── index.ts         # Worker entry point
```

## Configuration

### Sandbox Options

The sandbox is configured with these defaults in `src/index.ts`:

- **sleepAfter**: `30m` - Sandbox sleeps after 30 minutes of inactivity
- **timeout**: `300000ms` (5 minutes) - Maximum Claude Code execution time
- **max_instances**: `5` - Maximum concurrent sandbox instances

### Wrangler Settings

Edit `wrangler.jsonc` to customize:

- `name`: Worker name
- `containers[].max_instances`: Maximum concurrent sandboxes
- `containers[].instance_type`: `lite` or `standard`

## Security Notes

- The `ANTHROPIC_API_KEY` is passed securely via environment variables
- User tasks are written to a file to avoid shell injection
- Each repository gets its own isolated sandbox instance
- Sandboxes run in isolated containers with no access to the host system

## Troubleshooting

### Docker not running

```
Error: Docker daemon is not running
```

Start Docker Desktop or the Docker daemon.

### First run is slow

The first `npm run dev` builds the Docker image which includes installing Claude Code CLI. This takes 2-3 minutes. Subsequent runs reuse the cached image.

### Port already in use

```bash
# Use a different port
wrangler dev --port 8788
```

### Version mismatch errors

Ensure the Docker image version matches the npm package version. Both should be `0.6.10`.

## License

MIT
