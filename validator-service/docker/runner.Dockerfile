# Runner base image — executes user's Node.js code.
#
# Security model:
#   - Non-root user (runner)
#   - No shell (no bash/sh in PATH for the runner user)
#   - Minimal packages — only Node.js runtime
#   - No git, no curl, no wget
#   - Network is locked to none by the worker at container creation time
#   - Credentials: none (worker passes zero env vars to this container)
#
# node_modules are pre-installed by Container 1 (validate mode) into
# /dev/shm/job/repo before this container starts, so npm install is not
# needed here and would fail anyway (network=none).

FROM node:20-alpine

# Create a non-root user with no home directory and no shell.
RUN addgroup -S runner && \
    adduser -S -G runner -H -s /sbin/nologin runner

# Working directory is the user's repo, pre-populated by Container 1.
WORKDIR /dev/shm/job/repo

# Drop to non-root.
USER runner

# npm start is the standard Node.js entrypoint.
# The user's package.json scripts.start is what actually runs.
CMD ["npm", "start"]
