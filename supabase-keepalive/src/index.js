/**
 * Supabase Keepalive Worker
 *
 * Prevents Supabase free tier databases from hibernating by pinging them on a schedule.
 * Supports multiple Supabase projects via environment variables.
 */

// Constants for KV history storage
const HISTORY_RETENTION_MS = 24 * 60 * 60 * 1000; // 24 hours
const KV_HISTORY_KEY = 'keepalive:history';

/**
 * Discovers all configured Supabase projects from environment variables.
 * Looks for SUPABASE_URL_N and SUPABASE_ANON_KEY_N pairs.
 *
 * @param {object} env - Worker environment variables
 * @returns {Array<{name: string, url: string, anonKey: string}>}
 */
function discoverProjects(env) {
  const projects = [];

  // Check for numbered projects (1-99)
  for (let i = 1; i <= 99; i++) {
    const url = env[`SUPABASE_URL_${i}`];
    const anonKey = env[`SUPABASE_ANON_KEY_${i}`];

    if (url && anonKey) {
      // Extract project name from URL (e.g., "my-project" from "https://my-project.supabase.co")
      const projectName = extractProjectName(url, i);
      projects.push({
        name: projectName,
        url: url,
        anonKey: anonKey,
      });
    } else if (url || anonKey) {
      // Warn about incomplete configuration
      console.warn(`Incomplete config for project ${i}: missing ${!url ? 'URL' : 'ANON_KEY'}`);
    }
  }

  return projects;
}

/**
 * Extracts a human-readable project name from a Supabase URL.
 *
 * @param {string} url - The Supabase URL
 * @param {number} index - Fallback index if extraction fails
 * @returns {string}
 */
function extractProjectName(url, index) {
  try {
    const hostname = new URL(url).hostname;
    const projectId = hostname.split('.')[0];
    return projectId || `project-${index}`;
  } catch {
    return `project-${index}`;
  }
}

/**
 * Pings a single Supabase project to keep it alive.
 * Queries the keepalive table to register database activity.
 *
 * REQUIRED: Create the keepalive table in each Supabase project:
 *   CREATE TABLE public.keepalive (
 *     id integer PRIMARY KEY DEFAULT 1,
 *     pinged_at timestamptz DEFAULT now()
 *   );
 *   INSERT INTO public.keepalive (id) VALUES (1);
 *   -- Enable read access for anon role
 *   ALTER TABLE public.keepalive ENABLE ROW LEVEL SECURITY;
 *   CREATE POLICY "Allow anonymous read" ON public.keepalive FOR SELECT USING (true);
 *
 * @param {object} project - Project configuration
 * @returns {Promise<object>} - Ping result
 */
async function pingProject(project) {
  const startTime = Date.now();

  try {
    // Query the keepalive table - this executes a real database query to prevent hibernation
    const response = await fetch(`${project.url}/rest/v1/keepalive?select=id`, {
      method: 'GET',
      headers: {
        'apikey': project.anonKey,
        'Authorization': `Bearer ${project.anonKey}`,
      },
    });

    const duration = Date.now() - startTime;
    const success = response.ok;

    const result = {
      project: project.name,
      success: success,
      statusCode: response.status,
      duration: duration,
      timestamp: new Date().toISOString(),
    };

    if (success) {
      console.log(`✓ ${project.name}: OK (${response.status}) - ${duration}ms`);
    } else {
      console.error(`✗ ${project.name}: Failed (${response.status}) - ${duration}ms`);
    }

    return result;
  } catch (error) {
    const duration = Date.now() - startTime;

    console.error(`✗ ${project.name}: Error - ${error.message}`);

    return {
      project: project.name,
      success: false,
      error: error.message,
      duration: duration,
      timestamp: new Date().toISOString(),
    };
  }
}

/**
 * Saves ping run results to KV storage with 24-hour history.
 * Automatically filters out entries older than 24 hours.
 *
 * @param {object} env - Worker environment variables
 * @param {object} runData - Ping results to save
 * @param {string} trigger - How the run was triggered ('cron' or 'manual')
 */
async function saveRunToKV(env, runData, trigger) {
  try {
    // Read existing history from KV
    const existingData = await env.KEEPALIVE_STATUS.get(KV_HISTORY_KEY);
    let history = existingData ? JSON.parse(existingData) : { runs: [] };

    // Add the new run
    const newRun = {
      timestamp: new Date().toISOString(),
      trigger: trigger,
      success: runData.success,
      results: runData.results,
      summary: runData.summary,
    };

    history.runs.push(newRun);

    // Filter out entries older than 24 hours
    const cutoffTime = Date.now() - HISTORY_RETENTION_MS;
    history.runs = history.runs.filter(run => {
      const runTime = Date.parse(run.timestamp);
      return runTime >= cutoffTime;
    });

    // Update lastUpdated timestamp
    history.lastUpdated = new Date().toISOString();

    // Save back to KV
    await env.KEEPALIVE_STATUS.put(KV_HISTORY_KEY, JSON.stringify(history));
    console.log(`✓ Saved run to KV history (${history.runs.length} entries)`);
  } catch (error) {
    // Log error but don't throw - keepalive should continue even if KV fails
    console.error(`✗ Failed to save to KV: ${error.message}`);
  }
}

/**
 * Retrieves ping history from KV storage.
 *
 * @param {object} env - Worker environment variables
 * @returns {Promise<object|null>} - History object or null if not found/error
 */
async function getStatusFromKV(env) {
  try {
    const data = await env.KEEPALIVE_STATUS.get(KV_HISTORY_KEY);
    if (!data) {
      return null;
    }
    return JSON.parse(data);
  } catch (error) {
    console.error(`✗ Failed to read from KV: ${error.message}`);
    return null;
  }
}

/**
 * Handles the /status endpoint request.
 * Returns the last ping results and 24-hour history summary.
 *
 * @param {object} env - Worker environment variables
 * @returns {Promise<Response>} - HTTP response with status data
 */
async function handleStatusEndpoint(env) {
  const history = await getStatusFromKV(env);

  // No data case - first run hasn't happened yet
  if (!history || history.runs.length === 0) {
    return new Response(
      JSON.stringify(
        {
          service: 'supabase-keepalive',
          status: 'no_data',
          message: 'No ping history available yet. The worker runs every 6 hours.',
          nextRun: 'Runs every 6 hours',
        },
        null,
        2
      ),
      {
        status: 200,
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*',
        },
      }
    );
  }

  // Get the last run from history
  const lastRun = history.runs[history.runs.length - 1];

  // Determine overall health status
  const allHealthy = lastRun.success;
  const statusCode = allHealthy ? 200 : 503;
  const statusText = allHealthy ? 'healthy' : 'degraded';

  // Find oldest run timestamp
  const oldestRun = history.runs.length > 0 ? history.runs[0].timestamp : null;

  const response = {
    service: 'supabase-keepalive',
    lastRun: lastRun.timestamp,
    nextRun: 'Runs every 6 hours',
    status: statusText,
    trigger: lastRun.trigger,
    results: lastRun.results,
    summary: lastRun.summary,
    history: {
      available: true,
      runCount: history.runs.length,
      oldestRun: oldestRun,
    },
  };

  return new Response(JSON.stringify(response, null, 2), {
    status: statusCode,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
    },
  });
}

/**
 * Runs the keepalive logic for all configured projects.
 *
 * @param {object} env - Worker environment variables
 * @param {string} trigger - How the run was triggered ('cron', 'manual', or 'unknown')
 * @returns {Promise<object>} - Summary of all ping results
 */
async function runKeepalive(env, trigger = 'unknown') {
  const projects = discoverProjects(env);

  if (projects.length === 0) {
    console.warn('No Supabase projects configured. Add SUPABASE_URL_N and SUPABASE_ANON_KEY_N environment variables.');
    const resultsData = {
      success: false,
      message: 'No projects configured',
      results: [],
      summary: {
        total: 0,
        succeeded: 0,
        failed: 0,
      },
    };

    // Save to KV even with no projects configured
    await saveRunToKV(env, resultsData, trigger);

    return resultsData;
  }

  console.log(`Pinging ${projects.length} Supabase project(s)...`);

  // Ping all projects concurrently
  const results = await Promise.all(projects.map(pingProject));

  const succeeded = results.filter(r => r.success).length;
  const failed = results.filter(r => !r.success).length;

  console.log(`Completed: ${succeeded}/${results.length} succeeded, ${failed} failed`);

  const resultsData = {
    success: failed === 0,
    message: `Pinged ${results.length} project(s): ${succeeded} succeeded, ${failed} failed`,
    results: results,
    summary: {
      total: results.length,
      succeeded: succeeded,
      failed: failed,
    },
  };

  // Save results to KV
  await saveRunToKV(env, resultsData, trigger);

  return resultsData;
}

export default {
  /**
   * HTTP request handler - manual trigger endpoint for testing.
   */
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    // Health check endpoint
    if (url.pathname === '/health') {
      return new Response(JSON.stringify({ status: 'ok' }), {
        headers: { 'Content-Type': 'application/json' },
      });
    }

    // Status endpoint - returns last ping results and history
    if (url.pathname === '/status') {
      return await handleStatusEndpoint(env);
    }

    // Manual trigger endpoint - run keepalive and return results
    const results = await runKeepalive(env, 'manual');

    return new Response(JSON.stringify(results, null, 2), {
      status: results.success ? 200 : 207,
      headers: { 'Content-Type': 'application/json' },
    });
  },

  /**
   * Scheduled event handler - cron trigger.
   */
  async scheduled(event, env, ctx) {
    console.log(`Scheduled keepalive triggered at ${new Date().toISOString()}`);
    await runKeepalive(env, 'cron');
  },
};
