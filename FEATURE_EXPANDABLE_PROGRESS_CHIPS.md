# Expandable Progress Chips Feature

## Overview

This feature enhances the streaming progress chips in the chat UI to be expandable and clickable, allowing users to see individual artifacts, source files, and blocks at a glance and navigate to them directly.

## Changes Made

### 1. Enhanced Stream Envelope Parser (`src/lib/utils/stream-envelope.ts`)

**New Exports:**
- `StreamingEnvelopePreview` type now includes:
  - `blocks: Array<{ kind: string; title?: string }>` - Full list of blocks being streamed
  - `writes: Array<{ path: string }>` - Full list of artifacts being written
  - `sourceWrites: Array<{ path: string }>` - Full list of source files being written

**New Functions:**
- `extractAllBlocks(raw: string)` - Extracts all blocks from streaming envelope with their kind and title
- `extractAllWrites(raw: string)` - Extracts all artifact writes with their paths
- `extractAllSourceWrites(raw: string)` - Extracts all source file writes with their paths
- `extractJsonProperty(jsonStr: string, propertyKey: string)` - Helper to extract string properties from partial JSON objects

### 2. Enhanced Message Bubble Component (`src/components/chat/message-bubble.tsx`)

**New State:**
- `expandedChip` - Tracks which progress chip is currently expanded (if any)

**Updated Components:**

#### `StreamingBody`
- Now receives `expandedChip` and `onToggleChip` props
- Uses `useProjectNavigation()` hook to get `openArtifact` function
- Passes artifact click handler to `buildProgressChips`

#### `buildProgressChips`
- Now accepts `onArtifactClick` callback parameter
- Creates `ProgressChipItem[]` for each chip type:
  - **Blocks**: Lists each block with its title or kind
  - **Writes**: Lists each artifact path with click handler to open it
  - **Source Writes**: Lists each source file path with click handler to open it

#### `ProgressChip`
- Now supports expandable state with chevron icon
- When expanded, shows a dropdown list of individual items
- Each item is clickable and can trigger navigation
- Styling:
  - Chevron rotates 180° when expanded
  - Items have hover effects for better UX
  - Maintains color coding (neutral, accent, warn)

### 3. Tests (`src/lib/utils/stream-envelope.test.ts`)

Added comprehensive tests for:
- `extractAllBlocks` - Verifies extraction of blocks with kind and title
- `extractAllWrites` - Verifies extraction of artifact paths
- `extractAllSourceWrites` - Verifies extraction of source file paths
- Partial streaming scenarios - Ensures extraction works during incomplete streaming
- Empty arrays - Verifies correct handling when no items exist

## User Experience

### Before
- Progress chips showed only a count and the latest item
- Example: "1 CARD · GATE" or "1 ARTIFACT · REQUIREMENTS.MD"
- No way to see all items or navigate to them directly

### After
- Progress chips are now expandable buttons with a chevron icon
- Clicking expands to show all individual items
- Each item is clickable and navigates to the artifact in the Artifacts panel
- Example interaction:
  1. User sees "2 ARTIFACTS · ARCHITECTURE.MD"
  2. Clicks the chip to expand
  3. Sees list: "ARCHITECTURE.md", "ADR-0001-technology-stack.md"
  4. Clicks on any item to open it in the Artifacts view

## Technical Details

### Streaming Envelope Extraction

The new extraction functions parse incomplete JSON during streaming:
- Safely handle partial objects and arrays
- Track object boundaries using depth counting
- Extract properties from incomplete JSON strings
- Return empty arrays when no items found

### Click Handler Integration

- Uses existing `useProjectNavigation()` hook
- Calls `openArtifact(path)` for artifact/source file items
- Maintains consistency with existing artifact navigation

### State Management

- Expansion state is local to the `MessageBubble` component
- Only one chip can be expanded at a time
- Clicking the same chip again collapses it
- Expanding a different chip automatically collapses the previous one

## Files Modified

1. `src/lib/utils/stream-envelope.ts` - Enhanced parser with new extraction functions
2. `src/components/chat/message-bubble.tsx` - Enhanced UI with expandable chips
3. `src/lib/utils/stream-envelope.test.ts` - Added comprehensive tests

## Backward Compatibility

- All existing functionality is preserved
- New properties in `StreamingEnvelopePreview` are optional
- Chips without items render as before (non-expandable)
- No breaking changes to public APIs