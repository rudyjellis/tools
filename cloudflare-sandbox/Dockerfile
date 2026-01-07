# Cloudflare Sandbox base image - version MUST match @cloudflare/sandbox npm version
FROM docker.io/cloudflare/sandbox:0.6.10

# Install Claude Code CLI globally
# The CLI requires Node.js which is included in the base image
RUN npm install -g @anthropic-ai/claude-code

# Install additional useful tools for development workflows
RUN apt-get update && apt-get install -y --no-install-recommends \
    git \
    curl \
    ca-certificates \
    sudo \
    && rm -rf /var/lib/apt/lists/*

# Create a non-root user for running Claude Code
# Claude Code blocks --dangerously-skip-permissions when running as root
RUN useradd -m -s /bin/bash claude && \
    echo "claude ALL=(ALL) NOPASSWD:ALL" >> /etc/sudoers

# Create workspace directory and set ownership
RUN mkdir -p /workspace && chown -R claude:claude /workspace

# Switch to non-root user
USER claude

# Set working directory
WORKDIR /workspace

# Required during local development to access exposed ports
# In production, all ports are automatically accessible
EXPOSE 3000
EXPOSE 8080
