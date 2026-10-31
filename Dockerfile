# Runs the Vedha MCP server (stdio) from source. Playwright's image ships the matching browsers.
# docker build -t vedha-mcp . && docker run -i --rm vedha-mcp --allow-domain example.com
FROM mcr.microsoft.com/playwright:v1.64.1-noble
WORKDIR /app
RUN corepack enable
COPY . .
RUN pnpm install --frozen-lockfile && pnpm build
ENTRYPOINT ["node", "packages/mcp/dist/bin.js"]
CMD ["--allow-domain", "example.com"]
