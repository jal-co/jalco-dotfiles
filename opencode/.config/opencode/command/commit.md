---
description: Create conventional commits with automatic security review
---

# Smart Commit

Create well-formatted conventional commits with automatic security review.

## Workflow

### Step 1: Check Staged Changes
```bash
git status --porcelain
git diff --cached --stat
```

**If no changes staged:**
> "No changes staged. Would you like me to stage all changes with `git add .`?"

Wait for confirmation, then stage if approved.

### Step 2: Security Review
Analyze staged changes for security issues:

```bash
git diff --cached
```

**Check for:**
- Hardcoded secrets, API keys, tokens, passwords
- Private keys or certificates
- Database connection strings with credentials
- AWS/GCP/Azure credentials
- `.env` files being committed
- Sensitive data in comments or logs
- SQL injection vulnerabilities
- XSS attack vectors
- Insecure authentication patterns

**If critical issues found:**
> "BLOCKED: Security issues detected
> 
> **Critical Issues:**
> 1. [File:line] Hardcoded API key found: `sk-...`
> 2. [File:line] Password in plain text
> 
> **Proposed Fixes:**
> 1. Move API key to environment variable
> 2. Remove password, use environment variable
> 
> Please fix these issues before committing."

Stop here. Do not proceed with commit.

**If warnings found:**
> "Security warnings detected:
> 
> 1. [File:line] Console.log with potentially sensitive data
> 
> Proceed anyway? (yes/no)"

Wait for user confirmation.

**If clean:**
Continue to Step 3.

### Step 3: Analyze Changes
Review the diff to understand what changed:
- New features added
- Bugs fixed
- Refactoring done
- Documentation updated
- Tests added
- Dependencies changed

### Step 4: Generate Commit Message
Create a conventional commit message:

**Format:** `type: description`

**Types:**
- `feat` - New feature
- `fix` - Bug fix
- `docs` - Documentation only
- `refactor` - Code restructuring, no behavior change
- `test` - Adding or updating tests
- `chore` - Maintenance, dependencies, configs
- `perf` - Performance improvement
- `style` - Formatting, no code change
- `ci` - CI/CD changes

**Rules:**
- No emoji
- No scope in parentheses
- Lowercase start
- Imperative mood ("add" not "added")
- Max 72 characters
- Describe the "what", not the "how"

**Examples:**
- `feat: add user authentication flow`
- `fix: handle null response from API`
- `docs: update installation instructions`
- `refactor: extract validation into separate module`
- `test: add unit tests for auth service`
- `chore: update typescript to 5.3`

### Step 5: Present and Confirm
> "Proposed commit:
> ```
> feat: add user profile settings page
> ```
> 
> Changes:
> - Added ProfileSettings component
> - Added profile API endpoints
> - Updated navigation
> 
> Commit with this message? (yes/edit/cancel)"

**If user says "edit":**
Ask what they want to change and regenerate.

### Step 6: Execute Commit
```bash
git commit -m "type: description"
```

### Step 7: Offer to Push
> "Commit created: `abc1234`
> 
> Push to remote? (yes/no)"

If yes:
```bash
git push
```

## Arguments
- No arguments: Analyze all staged changes
- `$ARGUMENTS`: Use as commit message directly (still run security review)
