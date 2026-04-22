# Web Search Implementation for AI Agents

## Summary

All AI agents in the L'Olympus system now have access to web search tools, allowing them to ground their decisions in current best practices, industry standards, documentation, and trends.

## What Changed

### 1. **LLM Type System** (`src/lib/llm/types.ts`)
- Added `Tool` and `ToolFunction` types
- Extended `ChatRequest` to support optional `tools` array
- Models can now receive tool definitions

### 2. **Web Search Tool** (`src/lib/agents/tools/web-search-tool.ts`)
- Defined `webSearchTool` compatible with OpenAI/Claude API
- Tool name: `web_search`
- Parameters: `query` (required), `limit` (optional, 1-5)
- Available to all agent roles

### 3. **Web Search Executor** (`src/lib/agents/tools/web-search-executor.ts`)
- Implements actual web search functionality
- Supports 3 providers (in priority order):
  1. **Tavily API** (AI-optimized, recommended)
  2. **SerpAPI** (Google search integration)
  3. **Google Search** (basic fallback, no API key needed)
- Returns structured `WebSearchResult[]` with title, URL, and snippet

### 4. **OpenRouter Provider** (`src/lib/llm/providers/openrouter.ts`)
- Extended to pass `tools` to the OpenAI-compatible API
- Converts tool definitions to OpenAI format

### 5. **Agent Execution Loop** (`src/lib/agents/run.ts`)
- Added tool calling loop (max 3 iterations per agent turn)
- When LLM emits a `toolUse` object, the system:
  1. Detects the tool call in the response
  2. Executes the tool (web_search)
  3. Formats the result as a "tool" message
  4. Re-submits to LLM with the search results
  5. Repeats until no more tool calls
- Logs web searches for visibility

## Benefits for Each Role

- **Orchestrator**: Search for similar requirements/projects to set realistic expectations
- **PM**: Verify market trends, competitor features, user preferences
- **Architect**: Find latest design patterns, tech stack comparisons, best practices
- **Tech Lead**: Discover current implementation patterns, performance benchmarks
- **Backend Dev**: Find API best practices, security patterns, optimization techniques
- **Frontend Dev**: Discover UI/UX patterns, component libraries, accessibility standards
- **DevOps**: Find deployment best practices, infrastructure patterns, scaling strategies
- **Security**: Verify CVE databases, security vulnerabilities, compliance standards
- **Reviewer**: Validate code against current standards, find recent best practices
- **QA**: Find testing best practices, automation frameworks, test patterns

## Configuration

### Option 1: Tavily (Recommended)
```bash
TAVILY_API_KEY=your_api_key_here
```
- Best for AI agent research
- Free tier: 1000 searches/month at https://tavily.com
- Returns highly relevant, AI-optimized results

### Option 2: SerpAPI
```bash
SERPAPI_API_KEY=your_api_key_here
```
- Comprehensive Google search integration
- Free tier: 100 searches/month at https://serpapi.com
- Good for general searches

### Option 3: No API Key (Fallback)
- Uses basic Google search without API key
- Less reliable but works without configuration
- No rate limits but may be blocked

## Usage Example

When an agent needs to ground their decision, they can emit:

```json
{
  "toolUse": {
    "tool": "web_search",
    "input": {
      "query": "React 18 performance optimization best practices 2026",
      "limit": 3
    }
  }
}
```

The system will:
1. Execute the web search
2. Return top 3 results with title, URL, and snippet
3. Re-submit to the agent with the results
4. Agent incorporates the information into their response

## Limitations

- Maximum 3 web search iterations per agent turn (prevents infinite loops)
- Limited to 5 results per search (balances usefulness with token usage)
- Search results are supplementary, not authoritative (agent makes final decisions)
- Tool calling supported by Claude 3+ and GPT-4 models on OpenRouter

## Future Improvements

- Add rate limiting per agent/role
- Cache search results to reduce API calls
- Add semantic ranking to results
- Support additional search providers
- Add web scraping for full article content
- Add custom search filters (date range, domain filters)

## Testing

To test the implementation:

1. Set a web search API key (preferably Tavily)
2. Run an agent turn (any role)
3. Agent may emit `web_search` tool calls
4. Check server logs for "searching web:" messages
5. Verify search results appear in agent response

## Files Modified

- `src/lib/llm/types.ts` - Added Tool types
- `src/lib/llm/providers/openrouter.ts` - Added tool passing
- `src/lib/agents/run.ts` - Added tool execution loop
- `.env` - Added web search API key comments

## Files Created

- `src/lib/agents/tools/web-search-tool.ts` - Tool definition
- `src/lib/agents/tools/web-search-executor.ts` - Tool executor
- `src/lib/agents/tools/README.md` - Tool documentation
