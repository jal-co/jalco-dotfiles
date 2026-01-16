---
description: Create a pull request with professional description
---

# Create Pull Request

Generate a professional, human-sounding pull request description and create the PR.

## Workflow

### Step 1: Analyze Branch
```bash
git branch --show-current
git log main..HEAD --oneline
git diff main..HEAD --stat
```

Understand:
- Branch name (often indicates feature/fix type)
- Number of commits
- Files changed
- Overall scope of changes

### Step 2: Review Changes in Detail
```bash
git diff main..HEAD
```

Identify:
- What was added, modified, removed
- The purpose of the changes
- Any breaking changes
- Dependencies added or removed

### Step 3: Generate PR Description
Create a clear, professional description:

```markdown
## Summary
[1-2 sentences explaining what this PR does and why]

## Changes
- [Bullet point of key change 1]
- [Bullet point of key change 2]
- [Bullet point of key change 3]

## Testing
[How this was tested or how to test it]
```

**Writing Style:**
- Write like a human, not AI
- Be concise and direct
- Use active voice
- No buzzwords or filler
- Focus on what matters to reviewers

**Bad (AI-sounding):**
> "This pull request introduces a comprehensive authentication system that leverages industry-standard practices to ensure robust security measures are implemented across the application."

**Good (Human):**
> "Adds email/password authentication using JWT tokens. Users can now sign up, log in, and reset passwords."

### Step 4: Generate PR Title
Format: Same as commit messages
- `feat: add user authentication`
- `fix: resolve payment processing timeout`

### Step 5: Present for Review
> "**PR Title:** feat: add user authentication
> 
> **Description:**
> ## Summary
> Adds email/password authentication with JWT tokens.
> 
> ## Changes
> - Add login and signup pages
> - Create auth API endpoints
> - Add JWT middleware for protected routes
> - Store sessions in database
> 
> ## Testing
> - Manual testing of signup/login flows
> - Added unit tests for auth utilities
> 
> ---
> Create this PR? (yes/edit/cancel)"

### Step 6: Create PR
```bash
gh pr create --title "feat: add user authentication" --body "$(cat <<'EOF'
## Summary
Adds email/password authentication with JWT tokens.

## Changes
- Add login and signup pages
- Create auth API endpoints
- Add JWT middleware for protected routes
- Store sessions in database

## Testing
- Manual testing of signup/login flows
- Added unit tests for auth utilities
EOF
)"
```

### Step 7: Report Success
> "PR created: https://github.com/user/repo/pull/123
> 
> Ready for review."

## Arguments
- No arguments: Auto-generate everything
- `$ARGUMENTS`: Use as PR title, generate description based on changes
