---
description: Generate and update code documentation with file headers
---

# Documentation Generator

Generate comprehensive code documentation including file headers, function documentation, and README updates.

## Workflow

### Step 1: Determine Scope
**If `$ARGUMENTS` provided:**
Document the specified files or directories.

**If no arguments:**
```bash
git diff --name-only HEAD~5
git status --porcelain
```
Document recently modified files.

### Step 2: Analyze Files
For each file to document:
- Read the file contents
- Identify exports (functions, classes, components, types)
- Understand the purpose and relationships
- Check existing documentation

### Step 3: Generate File Headers
Every source file should have a header at the top:

**TypeScript/JavaScript:**
```typescript
/**
 * @file user-service.ts
 * @description Handles user authentication and profile management
 *
 * @exports
 * - createUser: Create a new user account
 * - authenticateUser: Validate credentials and return session
 * - getUserProfile: Fetch user profile by ID
 * - updateUserProfile: Update user profile data
 */
```

**React Components:**
```typescript
/**
 * @file Button.tsx
 * @description Reusable button component with variants
 *
 * @exports
 * - Button: Primary button component
 * - ButtonProps: TypeScript props interface
 *
 * @example
 * <Button variant="primary" onClick={handleClick}>
 *   Click me
 * </Button>
 */
```

**Rust:**
```rust
//! @file lib.rs
//! @description Core library for authentication handling
//!
//! # Exports
//! - `create_user`: Create a new user account
//! - `authenticate`: Validate credentials
//! - `UserError`: Error types for user operations
```

### Step 4: Generate Function Documentation
Document public functions and methods:

**TypeScript:**
```typescript
/**
 * Create a new user account
 *
 * @param email - User's email address
 * @param password - User's password (will be hashed)
 * @returns The created user object without password
 * @throws {ValidationError} If email is invalid
 * @throws {ConflictError} If email already exists
 *
 * @example
 * const user = await createUser('user@example.com', 'password123')
 */
export async function createUser(email: string, password: string): Promise<User> {
```

**Rust:**
```rust
/// Create a new user account
///
/// # Arguments
/// * `email` - User's email address
/// * `password` - User's password (will be hashed)
///
/// # Returns
/// The created user without password field
///
/// # Errors
/// - `ValidationError` if email is invalid
/// - `ConflictError` if email already exists
///
/// # Example
/// ```
/// let user = create_user("user@example.com", "password123").await?;
/// ```
pub async fn create_user(email: &str, password: &str) -> Result<User, UserError> {
```

### Step 5: Update README (If Applicable)
If documenting a module or package, update or create README section:

```markdown
## API Reference

### `createUser(email, password)`
Create a new user account.

**Parameters:**
- `email` (string) - User's email address
- `password` (string) - User's password

**Returns:** `Promise<User>` - The created user

**Example:**
```typescript
const user = await createUser('user@example.com', 'password123')
```
```

### Step 6: Present Changes
Show the documentation that will be added:

> "Documentation updates:
> 
> **user-service.ts**
> - Added file header
> - Documented 4 functions
> 
> **Button.tsx**
> - Added file header with example
> - Documented props interface
> 
> Apply these changes? (yes/no)"

### Step 7: Apply Documentation
Write the documentation to files.

## Documentation Standards

### File Headers Must Include:
- `@file` - Filename
- `@description` - What the file does (1-2 sentences)
- `@exports` - List of public exports with brief descriptions

### Function Docs Must Include:
- Brief description (first line)
- `@param` for each parameter
- `@returns` what it returns
- `@throws` for possible errors
- `@example` for non-obvious usage

### Do NOT:
- Document obvious things ("Gets the user" for `getUser`)
- Add empty or placeholder docs
- Document private/internal functions unless complex
- Over-document simple utility functions

## Arguments
- No arguments: Document recently changed files
- `$ARGUMENTS`: Document specified files/directories
