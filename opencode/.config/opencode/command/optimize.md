---
description: Analyze code for performance and security improvements
---

# Code Optimization Analysis

Analyze code for performance issues, security vulnerabilities, and improvement opportunities.

## Workflow

### Step 1: Determine Scope
**If `$ARGUMENTS` provided:**
Analyze the specified files or directories.

**If no arguments:**
```bash
git diff --name-only HEAD~5
git status --porcelain
```
Analyze recently modified files.

### Step 2: Read and Understand Code
For each file:
- Read the complete file
- Understand the purpose and flow
- Identify dependencies and integrations
- Note the technology/framework in use

### Step 3: Performance Analysis
Check for common performance issues:

**General:**
- Unnecessary loops or iterations
- N+1 query patterns
- Missing caching opportunities
- Synchronous operations that could be async
- Large objects kept in memory
- Redundant calculations

**React/Frontend:**
- Missing `useMemo` or `useCallback` for expensive operations
- Unnecessary re-renders (missing memo, bad deps arrays)
- Large bundle imports (import entire library vs specific functions)
- Missing lazy loading for routes/components
- Unoptimized images or assets

**Node.js/Backend:**
- Blocking the event loop
- Missing streaming for large responses
- Inefficient database queries
- Missing connection pooling
- Memory leaks in event handlers

**Rust:**
- Unnecessary cloning
- Missing references where borrows would work
- Inefficient string handling
- Missing iterator combinators

### Step 4: Security Analysis
Check for vulnerabilities:

**Input Handling:**
- SQL injection (raw queries with user input)
- XSS (unescaped output to HTML)
- Command injection (shell commands with user input)
- Path traversal (file paths from user input)
- Missing input validation

**Authentication/Authorization:**
- Hardcoded credentials
- Weak password requirements
- Missing authentication on routes
- Broken access control
- Session fixation vulnerabilities
- JWT issues (weak secrets, no expiry)

**Data Protection:**
- Sensitive data in logs
- Secrets in code or config files
- Missing encryption for sensitive data
- Exposed error details to users
- Missing rate limiting

**Dependencies:**
- Known vulnerable packages
- Outdated dependencies
- Unnecessary dependencies

### Step 5: Code Quality Issues
Identify maintainability problems:
- Duplicated code
- Functions that are too long (> 50 lines)
- Deep nesting (> 3 levels)
- Missing error handling
- Unclear naming
- Dead code
- Missing types (in TypeScript)

### Step 6: Generate Report
Present findings in priority order:

```markdown
## Optimization Report

### Critical (Fix Immediately)
Security or severe performance issues.

**[Issue Title]**
- **File:** `path/to/file.ts:42`
- **Problem:** [Clear description]
- **Impact:** [What could go wrong]
- **Fix:** [Specific solution]

### Important (Should Fix)
Significant improvements.

**[Issue Title]**
- **File:** `path/to/file.ts:100`
- **Problem:** [Clear description]
- **Impact:** [Performance/maintainability cost]
- **Fix:** [Specific solution]

### Suggestions (Nice to Have)
Minor improvements and best practices.

**[Issue Title]**
- **File:** `path/to/file.ts:200`
- **Suggestion:** [What could be better]
- **Benefit:** [Why it matters]
```

### Step 7: Offer to Fix
> "Found 2 critical issues, 3 important issues, and 5 suggestions.
> 
> Would you like me to fix any of these? (all/critical/specific numbers/no)"

If user wants fixes, implement them following the standard workflow:
- Create plan
- Get confirmation
- Implement phase by phase
- Commit per logical step

## Focus Areas by Flag
- `/optimize security` - Focus only on security issues
- `/optimize performance` - Focus only on performance
- `/optimize quality` - Focus only on code quality
- No flag - Check everything

## Arguments
- No arguments: Analyze recently changed files
- `$ARGUMENTS`: Analyze specified files or focus area
