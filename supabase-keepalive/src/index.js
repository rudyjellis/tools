/**
 * Supabase Keepalive Worker
 *
 * Prevents Supabase free tier databases from hibernating by pinging them on a schedule.
 * Supports multiple Supabase projects via environment variables.
 */

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
 * Makes a lightweight GET request to the REST API endpoint.
 *
 * @param {object} project - Project configuration
 * @returns {Promise<object>} - Ping result
 */
async function pingProject(project) {
  const startTime = Date.now();

  try {
    // Ping the REST API base endpoint - this is lightweight and registers activity
    const response = await fetch(`${project.url}/rest/v1/`, {
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
 * Runs the keepalive logic for all configured projects.
 *
 * @param {object} env - Worker environment variables
 * @returns {Promise<object>} - Summary of all ping results
 */
async function runKeepalive(env) {
  const projects = discoverProjects(env);

  if (projects.length === 0) {
    console.warn('No Supabase projects configured. Add SUPABASE_URL_N and SUPABASE_ANON_KEY_N environment variables.');
    return {
      success: false,
      message: 'No projects configured',
      results: [],
      summary: {
        total: 0,
        succeeded: 0,
        failed: 0,
      },
    };
  }

  console.log(`Pinging ${projects.length} Supabase project(s)...`);

  // Ping all projects concurrently
  const results = await Promise.all(projects.map(pingProject));

  const succeeded = results.filter(r => r.success).length;
  const failed = results.filter(r => !r.success).length;

  console.log(`Completed: ${succeeded}/${results.length} succeeded, ${failed} failed`);

  return {
    success: failed === 0,
    message: `Pinged ${results.length} project(s): ${succeeded} succeeded, ${failed} failed`,
    results: results,
    summary: {
      total: results.length,
      succeeded: succeeded,
      failed: failed,
    },
  };
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

    // Run keepalive and return results
    const results = await runKeepalive(env);

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
    await runKeepalive(env);
  },
};
