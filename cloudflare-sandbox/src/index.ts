import { getSandbox, proxyToSandbox, type Sandbox } from '@cloudflare/sandbox';

// Re-export Sandbox class for Wrangler to bind as a Durable Object
export { Sandbox } from '@cloudflare/sandbox';

// Environment type with bindings
type Env = {
  Sandbox: DurableObjectNamespace<Sandbox>;
  ANTHROPIC_API_KEY: string;
};

// Request body type for /run endpoint
interface RunRequest {
  repoUrl: string;
  task: string;
  branch?: string;           // Optional: branch to checkout (default: main)
  sandboxId?: string;        // Optional: custom sandbox ID for isolation
  includeSummary?: boolean;  // Optional: include AI-generated summary (default: true)
}

// Response type for /run endpoint
interface RunResponse {
  success: boolean;
  stdout: string;
  stderr: string;
  exitCode: number;
  duration?: number;
  repoPath?: string;
  commit?: string;
  summary?: string;  // Brief summary of changes
}

// Error response type
interface ErrorResponse {
  error: string;
  details?: string;
}

// SSE event types for streaming
type SSEEventType = 'status' | 'stdout' | 'stderr' | 'complete' | 'error';

/**
 * Validates the request body for the /run endpoint
 */
function validateRunRequest(body: unknown): body is RunRequest {
  if (!body || typeof body !== 'object') return false;
  const obj = body as Record<string, unknown>;

  if (typeof obj.repoUrl !== 'string' || !obj.repoUrl.trim()) return false;
  if (typeof obj.task !== 'string' || !obj.task.trim()) return false;

  // Basic URL validation for Git URLs
  const repoUrl = obj.repoUrl.trim();
  const isValidUrl = repoUrl.startsWith('https://') ||
                     repoUrl.startsWith('git@') ||
                     repoUrl.startsWith('http://');

  // Validate optional fields if present
  if (obj.branch !== undefined && typeof obj.branch !== 'string') return false;
  if (obj.sandboxId !== undefined && typeof obj.sandboxId !== 'string') return false;
  if (obj.includeSummary !== undefined && typeof obj.includeSummary !== 'boolean') return false;

  return isValidUrl;
}

/**
 * Generates a sandbox ID based on the provided ID or repo URL
 * Supports multiple isolation strategies:
 * - Custom ID: Use sandboxId from request for user/session isolation
 * - Repo-based: Default, creates ID from repo URL hash
 */
function getSandboxId(repoUrl: string, customId?: string): string {
  if (customId) {
    // Sanitize custom ID: lowercase, alphanumeric + hyphens only
    const sanitized = customId
      .toLowerCase()
      .replace(/[^a-z0-9-]/g, '-')
      .replace(/-+/g, '-')
      .slice(0, 50);
    return `claude-${sanitized}`;
  }

  // Default: hash from repo URL
  const hash = repoUrl
    .replace(/[^a-zA-Z0-9]/g, '')
    .slice(-20);
  return `claude-sandbox-${hash}`;
}

/**
 * Extracts repo name from URL for the target directory
 */
function getRepoName(repoUrl: string): string {
  const parts = repoUrl.replace(/\.git$/, '').split('/');
  return parts[parts.length - 1] || 'repo';
}

/**
 * Extracts a brief summary from Claude Code output
 * Looks for common patterns in Claude's responses
 */
function extractSummary(stdout: string): string {
  const lines = stdout.trim().split('\n');

  // Look for explicit summary markers
  const summaryMarkers = ['summary:', 'changes:', 'modified:', 'created:', 'updated:'];
  for (const line of lines) {
    const lower = line.toLowerCase();
    if (summaryMarkers.some(marker => lower.includes(marker))) {
      return line.trim();
    }
  }

  // Look for file operation patterns
  const fileOps: string[] = [];
  const patterns = [
    /(?:created|modified|updated|deleted|added)\s+[`']?([^`'\n]+)[`']?/gi,
    /(?:wrote to|edited|changed)\s+[`']?([^`'\n]+)[`']?/gi
  ];

  for (const pattern of patterns) {
    const matches = stdout.matchAll(pattern);
    for (const match of matches) {
      fileOps.push(match[0].trim());
    }
  }

  if (fileOps.length > 0) {
    const unique = [...new Set(fileOps)].slice(0, 5);
    return `Changes: ${unique.join(', ')}${fileOps.length > 5 ? ` (+${fileOps.length - 5} more)` : ''}`;
  }

  // Fallback: first non-empty line or truncated output
  const firstLine = lines.find(l => l.trim().length > 0);
  if (firstLine) {
    return firstLine.length > 100 ? firstLine.slice(0, 100) + '...' : firstLine;
  }

  return 'Task completed';
}

/**
 * Formats a Server-Sent Event message
 */
function formatSSE(event: SSEEventType, data: unknown): string {
  const jsonData = JSON.stringify(data);
  return `event: ${event}\ndata: ${jsonData}\n\n`;
}

/**
 * Handles the POST /run endpoint (non-streaming)
 */
async function handleRunRequest(request: Request, env: Env): Promise<Response> {
  // Parse and validate request body
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json(
      { error: 'Invalid JSON in request body' } satisfies ErrorResponse,
      { status: 400 }
    );
  }

  if (!validateRunRequest(body)) {
    return Response.json(
      {
        error: 'Invalid request body',
        details: 'Required: repoUrl (git URL), task (string). Optional: branch, sandboxId, includeSummary'
      } satisfies ErrorResponse,
      { status: 400 }
    );
  }

  const { repoUrl, task, branch = 'main', sandboxId: customSandboxId, includeSummary = true } = body;

  // Check for API key
  if (!env.ANTHROPIC_API_KEY) {
    return Response.json(
      { error: 'ANTHROPIC_API_KEY not configured' } satisfies ErrorResponse,
      { status: 500 }
    );
  }

  try {
    // Get or create sandbox instance with configurable ID
    const sandboxId = getSandboxId(repoUrl, customSandboxId);
    const sandbox = getSandbox(env.Sandbox, sandboxId, {
      normalizeId: true,
      sleepAfter: '30m',
      keepAlive: false,
      containerTimeouts: {
        instanceGetTimeoutMS: 60000,
        portReadyTimeoutMS: 120000
      }
    });

    // Set the Anthropic API key in the sandbox environment
    await sandbox.setEnvVars({
      ANTHROPIC_API_KEY: env.ANTHROPIC_API_KEY
    });

    // Determine target directory
    const repoName = getRepoName(repoUrl);
    const targetDir = `/workspace/${repoName}`;

    // Clean up existing directory if it exists (fresh clone each time)
    const dirExists = await sandbox.exists(targetDir);
    if (dirExists) {
      await sandbox.exec(`rm -rf ${targetDir}`);
    }

    // Clone the repository
    const checkoutResult = await sandbox.gitCheckout(repoUrl, {
      targetDir,
      branch
    });

    // Write the task to a file to avoid shell injection
    const taskFilePath = '/workspace/.claude-task.txt';
    await sandbox.writeFile(taskFilePath, task);

    // Run Claude Code CLI with the task from file
    const claudeCommand = `cat ${taskFilePath} | claude -p --dangerously-skip-permissions`;

    const result = await sandbox.exec(claudeCommand, {
      cwd: targetDir,
      timeout: 300000
    });

    // Clean up task file
    await sandbox.deleteFile(taskFilePath);

    const response: RunResponse = {
      success: result.success,
      stdout: result.stdout,
      stderr: result.stderr,
      exitCode: result.exitCode,
      duration: result.duration,
      repoPath: checkoutResult.repoPath,
      commit: checkoutResult.commit
    };

    // Add summary if requested
    if (includeSummary && result.success) {
      response.summary = extractSummary(result.stdout);
    }

    return Response.json(response, {
      status: result.success ? 200 : 500
    });

  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error occurred';

    return Response.json(
      {
        error: 'Sandbox execution failed',
        details: errorMessage
      } satisfies ErrorResponse,
      { status: 500 }
    );
  }
}

/**
 * Handles the POST /run/stream endpoint (SSE streaming)
 */
async function handleStreamRequest(request: Request, env: Env): Promise<Response> {
  // Parse and validate request body
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json(
      { error: 'Invalid JSON in request body' } satisfies ErrorResponse,
      { status: 400 }
    );
  }

  if (!validateRunRequest(body)) {
    return Response.json(
      {
        error: 'Invalid request body',
        details: 'Required: repoUrl (git URL), task (string). Optional: branch, sandboxId, includeSummary'
      } satisfies ErrorResponse,
      { status: 400 }
    );
  }

  const { repoUrl, task, branch = 'main', sandboxId: customSandboxId, includeSummary = true } = body;

  // Check for API key
  if (!env.ANTHROPIC_API_KEY) {
    return Response.json(
      { error: 'ANTHROPIC_API_KEY not configured' } satisfies ErrorResponse,
      { status: 500 }
    );
  }

  // Create a TransformStream for SSE
  const { readable, writable } = new TransformStream();
  const writer = writable.getWriter();
  const encoder = new TextEncoder();

  // Helper to send SSE events
  const sendEvent = async (event: SSEEventType, data: unknown) => {
    await writer.write(encoder.encode(formatSSE(event, data)));
  };

  // Run the sandbox execution in the background
  (async () => {
    try {
      await sendEvent('status', { message: 'Initializing sandbox...' });

      // Get or create sandbox instance
      const sandboxId = getSandboxId(repoUrl, customSandboxId);
      const sandbox = getSandbox(env.Sandbox, sandboxId, {
        normalizeId: true,
        sleepAfter: '30m',
        keepAlive: false,
        containerTimeouts: {
          instanceGetTimeoutMS: 60000,
          portReadyTimeoutMS: 120000
        }
      });

      // Set the Anthropic API key
      await sandbox.setEnvVars({
        ANTHROPIC_API_KEY: env.ANTHROPIC_API_KEY
      });

      await sendEvent('status', { message: 'Cloning repository...' });

      // Clone the repository
      const repoName = getRepoName(repoUrl);
      const targetDir = `/workspace/${repoName}`;

      // Clean up existing directory if it exists (fresh clone each time)
      const dirExists = await sandbox.exists(targetDir);
      if (dirExists) {
        await sandbox.exec(`rm -rf ${targetDir}`);
      }

      const checkoutResult = await sandbox.gitCheckout(repoUrl, {
        targetDir,
        branch
      });

      await sendEvent('status', {
        message: 'Repository cloned',
        repoPath: checkoutResult.repoPath,
        commit: checkoutResult.commit
      });

      // Write the task to a file
      const taskFilePath = '/workspace/.claude-task.txt';
      await sandbox.writeFile(taskFilePath, task);

      await sendEvent('status', { message: 'Running Claude Code...' });

      // Run Claude Code with streaming output
      const claudeCommand = `cat ${taskFilePath} | claude -p --dangerously-skip-permissions`;

      let fullStdout = '';
      let fullStderr = '';

      const result = await sandbox.exec(claudeCommand, {
        cwd: targetDir,
        timeout: 300000,
        stream: true,
        onOutput: async (stream: string, data: string) => {
          if (stream === 'stdout') {
            fullStdout += data;
            await sendEvent('stdout', { data });
          } else {
            fullStderr += data;
            await sendEvent('stderr', { data });
          }
        }
      });

      // Clean up task file
      await sandbox.deleteFile(taskFilePath);

      // Send completion event with full results
      const completeData: RunResponse = {
        success: result.success,
        stdout: fullStdout || result.stdout,
        stderr: fullStderr || result.stderr,
        exitCode: result.exitCode,
        duration: result.duration,
        repoPath: checkoutResult.repoPath,
        commit: checkoutResult.commit
      };

      // Add summary if requested
      if (includeSummary && result.success) {
        completeData.summary = extractSummary(completeData.stdout);
      }

      await sendEvent('complete', completeData);

    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error occurred';
      await sendEvent('error', { error: errorMessage });
    } finally {
      await writer.close();
    }
  })();

  return new Response(readable, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
      'Access-Control-Allow-Origin': '*'
    }
  });
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    // Required for preview URLs - must be first
    const proxyResponse = await proxyToSandbox(request, env);
    if (proxyResponse) return proxyResponse;

    const url = new URL(request.url);

    // CORS headers for API usage
    const corsHeaders = {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type'
    };

    // Handle CORS preflight
    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: corsHeaders });
    }

    // Health check endpoint
    if (url.pathname === '/' && request.method === 'GET') {
      return Response.json({
        status: 'ok',
        service: 'Claude Code Sandbox API',
        version: '1.1.0',
        endpoints: {
          'GET /': 'Health check and API info',
          'POST /run': 'Run Claude Code on a repository (JSON response)',
          'POST /run/stream': 'Run Claude Code with streaming output (SSE)'
        },
        usage: {
          endpoint: 'POST /run',
          body: {
            repoUrl: 'https://github.com/user/repo.git',
            task: 'Describe what Claude Code should do',
            branch: '(optional) Branch to checkout, default: main',
            sandboxId: '(optional) Custom sandbox ID for isolation',
            includeSummary: '(optional) Include summary in response, default: true'
          }
        }
      }, { headers: corsHeaders });
    }

    // Main /run endpoint (non-streaming)
    if (url.pathname === '/run' && request.method === 'POST') {
      const response = await handleRunRequest(request, env);
      const headers = new Headers(response.headers);
      Object.entries(corsHeaders).forEach(([key, value]) => {
        headers.set(key, value);
      });
      return new Response(response.body, {
        status: response.status,
        headers
      });
    }

    // Streaming /run/stream endpoint (SSE)
    if (url.pathname === '/run/stream' && request.method === 'POST') {
      return handleStreamRequest(request, env);
    }

    return Response.json(
      { error: 'Not found', path: url.pathname } satisfies ErrorResponse,
      { status: 404, headers: corsHeaders }
    );
  }
};
