# Agent Tools

This directory contains tools available to AI agents for grounding their decisions in current information.

## Web Search Tool

The web search tool allows agents to search the internet for current information, best practices, documentation, and trends.

### Configuration

The web search tool uses one of three providers (in order of preference):

1. **Tavily API** (recommended for AI agents)
   - Set `TAVILY_API_KEY` environment variable
   - Free tier available at https://tavily.com

2. **SerpAPI** (comprehensive Google search)
   - Set `SERPAPI_API_KEY` environment variable
   - Free tier available at https://serpapi.com

3. **Google Search** (fallback, requires no API key)
   - Works without configuration but less reliable

### Usage

Agents can use the `web_search` tool to search for information:

```json
{
  "toolUse": {
    "tool": "web_search",
    "input": {
      "query": "React 18 performance best practices 2026",
      "limit": 3
    }
  }
}
```

### Available to All Roles

All roles (orchestrator, pm, architect, tech lead, reviewer, security, devops, etc.) have access to web search to ground their decisions in current best practices and industry standards.

### Examples

- **Architect**: "Docker container orchestration patterns 2026"
- **Security**: "OWASP top 10 vulnerabilities 2026"
- **DevOps**: "Kubernetes deployment best practices"
- **PM**: "Latest SaaS pricing models 2026"
- **Reviewer**: "Node.js async best practices 2026"

### Implementation

- Tool definition: `web-search-tool.ts`
- Tool executor: `web-search-executor.ts`
- Integration: `src/lib/agents/run.ts` (tool loop in `runAgentTurn`)
- LLM support: `src/lib/llm/providers/openrouter.ts` (tool passing)
