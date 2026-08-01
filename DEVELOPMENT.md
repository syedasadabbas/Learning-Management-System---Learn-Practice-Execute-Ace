# Development Workflow & Git Strategy

## Git Workflow

### Branch Strategy

```
main (production, stable)
 ├─ feature/email-notifications
 ├─ feature/certificates
 ├─ feature/badges
 ├─ feature/activity-logs
 ├─ feature/discussion-forums
 ├─ feature/peer-review
 ├─ feature/analytics
 ├─ feature/prerequisites
 └─ bugfix/[issue-name]
```

### Creating a Feature Branch

```bash
# Start from main with latest code
git checkout main
git pull origin main

# Create feature branch
git checkout -b feature/email-notifications

# Do work, commit frequently with clear messages
git add src/db/schema.ts
git commit -m "feat(email-notifications): add notifications table

- Create notifications table with status tracking
- Add notification_preferences for user opt-in/out
- Index on user_id and created_at for performance

CHANGELOG.log: EMAIL-001, EMAIL-002, EMAIL-003"
```

### Commit Message Format

```
<type>(<scope>): <subject>

<body>

<footer>
```

**Types:**
- `feat` — New feature
- `fix` — Bug fix
- `refactor` — Code restructuring without feature change
- `test` — Test additions/modifications
- `docs` — Documentation only
- `chore` — Build, dependencies, tooling

**Scope:** Feature name or file affected (`email-notifications`, `schema`, `api`, etc.)

**Subject:** 50 chars max, imperative mood

**Body:** Detailed explanation, bullet points acceptable. Reference CHANGELOG.log entries.

**Footer:** Reference issues/PRs: `Closes #123` or CHANGELOG.log ID

### Example Commits (Phase 1)

```
feat(email-notifications): add notification service layer

- Create NotificationService with send/update/getPreferences methods
- Implement retry logic (3 attempts, exponential backoff 2^n seconds)
- Use existing nodemailer integration, no new dependencies
- Log all attempts to activity_logs for audit trail
- Graceful error handling prevents cascade failures

CHANGELOG.log: EMAIL-005

feat(email-notifications): create notification API endpoints

- POST /api/notifications/preferences to update preferences
- GET /api/notifications to list user's notifications (paginated)
- PATCH /api/notifications/[id] to mark as read
- Rate limit preferences endpoint to 10/min per user
- All endpoints require student role auth

Tests: 8 unit tests in notification.service.test.ts
CHANGELOG.log: EMAIL-007, EMAIL-008, EMAIL-009

test(notifications): add unit test suite

- 12 tests for NotificationService covering:
  - Send on quiz_submitted, respect preferences, handle failures
  - Retry logic exponential backoff correctness
  - Preference persistence and retrieval
- Mock nodemailer transport
- 90%+ code coverage target

CHANGELOG.log: EMAIL-006
```

### Pull Request Workflow

1. **Push feature branch:**
   ```bash
   git push origin feature/email-notifications
   ```

2. **Create PR on GitHub:**
   - Title: "feat(email-notifications): add email notification system"
   - Description (use template below):
     ```markdown
     ## Feature Summary
     Adds email notifications for quiz submissions, exam completion, assignment feedback, and penalties.

     ## Changes
     - 2 new tables: `notifications`, `notification_preferences`
     - NotificationService with retry logic
     - 4 new API endpoints
     - Settings UI for notification preferences
     - Hooks into quiz/exam/assignment flows

     ## Tests
     - [x] Unit tests pass (npm run test — 12 new tests)
     - [x] E2E tests pass (npm run test:e2e — 5 new scenarios)
     - [x] TypeScript checks (npm run typecheck)
     - [x] ESLint passes (npm run lint)
     - [x] Database migration tested on staging

     ## Database
     - [x] Migrations generated and previewed
     - [x] No existing data affected
     - [x] Backwards compatible
     - [x] Tested rollback procedure

     ## Deployment
     - [x] Feature flag implemented (optional)
     - [x] Can deploy to production with no downtime
     - [x] Rollback plan tested

     Closes #[issue-number] (if any)
     ```

3. **Code review:**
   - Peer reviews required (at least 1 approval)
   - Address comments, push fixes
   - Re-request review

4. **Merge to main:**
   ```bash
   # Squash commits if many, keep logical unit
   git merge --squash feature/email-notifications
   # Or keep history:
   git merge --no-ff feature/email-notifications

   git push origin main
   ```

5. **Delete branch:**
   ```bash
   git branch -d feature/email-notifications
   git push origin --delete feature/email-notifications
   ```

## Development Workflow

### Daily Standup

**What to report:**
- What you completed yesterday
- What you're working on today
- Any blockers

**Example:**
```
Yesterday:
- Completed EMAIL-001 (notifications table schema)
- EMAIL-002 (notification_preferences table)
- Drafted EMAIL-005 (NotificationService)

Today:
- Finish NotificationService implementation
- Write unit tests (EMAIL-006)
- Start API endpoints (EMAIL-007)

Blockers:
- Need clarification on digest email frequency (daily vs weekly)
```

### Feature Development Cycle

**Per feature (Email Notifications = 1 week):**

1. **Plan (2 hours)**
   - Review IMPLEMENTATION_ROADMAP.md
   - Break feature into tasks
   - Identify files to create/modify
   - Estimate effort per task

2. **Database Schema (1-2 hours)**
   - Add enums (if needed)
   - Add tables (if needed)
   - Add columns to existing tables (if needed)
   - Generate migrations: `npm run db:generate`
   - Preview SQL: `cat src/db/migrations/0001_*.sql`
   - Verify no data loss on existing tables

3. **Service Layer (4-6 hours)**
   - Create service file (e.g., `notification.service.ts`)
   - Implement core methods with good error handling
   - Use TypeScript strictly (no `any` types)
   - Add JSDoc comments on public methods
   - Write unit tests alongside

4. **API Endpoints (2-4 hours)**
   - Create route files in `src/app/api/`
   - Implement GET/POST/PATCH/DELETE handlers
   - Add validation with Zod schemas
   - Add authentication checks
   - Return proper HTTP status codes
   - Log requests in activity_logs

5. **React Components (3-5 hours)**
   - Create component files in `src/components/`
   - Use TypeScript with proper prop types
   - Keep components small and focused
   - Use TailwindCSS for styling
   - Add loading/error states
   - Test with @testing-library/react

6. **Testing (2-3 hours)**
   - Unit tests for services (vitest)
   - Component tests (testing-library/react)
   - E2E tests (playwright)
   - Run full test suite: `npm run test && npm run test:e2e`
   - Aim for 80%+ code coverage

7. **Integration (1-2 hours)**
   - Hook into existing flows (e.g., quiz submission)
   - Verify no breaking changes
   - Test with realistic data (100+ records)
   - Check performance impact

8. **Code Review & Polish (1-2 hours)**
   - Self review code changes
   - Fix linting/TypeScript issues
   - Update CHANGELOG.log
   - Prepare PR description
   - Request peer review

### Testing Commands

```bash
# Unit tests (watch mode during development)
npm run test:watch

# Full test suite before PR
npm run test
npm run test:e2e

# Coverage report
npm run test -- --coverage

# TypeScript check
npm run typecheck

# ESLint
npm run lint --fix

# All checks together
npm run typecheck && npm run lint && npm run test
```

### Database Development

```bash
# After adding tables/columns to src/db/schema.ts
npm run db:generate

# Preview the migration SQL before applying
cat src/db/migrations/0001_*.sql

# Apply on local dev database
npm run db:push

# Push on staging before production
# (Use different DATABASE_URL env var)

# Backup production before applying
pg_dump ${PROD_DATABASE_URL} > backup_$(date +%Y%m%d_%H%M%S).sql
npm run db:push # Apply to production

# Verify schema
npm run db:verify-schema
```

### Common Workflows

#### Debugging a Failed Test

```bash
# Run single test file in watch mode
npm run test:watch notification.service.test.ts

# Run specific test case
npm run test:watch -t "should send email on quiz submission"

# Run with verbose output
npm run test -- --reporter=verbose

# Debug in Node
node --inspect-brk ./node_modules/vitest/vitest.mjs run notification.service.test.ts
# Then open chrome://inspect
```

#### Reverting a Change

```bash
# If commits not yet pushed
git reset --soft HEAD~1  # Keep changes in staging
git reset --hard HEAD~1  # Discard changes

# If commits already pushed
git revert HEAD  # Creates new commit that undoes changes
git push origin feature/my-feature

# To rollback an entire feature branch
git checkout main
git reset --hard origin/main
```

#### Creating a Hotfix

```bash
# For production bugs, branch from main
git checkout main
git pull
git checkout -b hotfix/notification-delivery-bug

# Make fix, test thoroughly
npm run test && npm run test:e2e

# Create PR with "HOTFIX:" prefix
git push origin hotfix/notification-delivery-bug
# Open PR, mark as priority
```

### Code Quality Standards

#### TypeScript
- No `any` types (use `unknown` with type guards if needed)
- Strict mode enabled
- Explicit return types on functions
- Use discriminated unions for complex types

#### Components
- Functional components only (hooks)
- Props properly typed (interface or type)
- No inline style objects (use className + Tailwind)
- Responsive design (mobile-first)
- Accessibility: alt text, ARIA labels, keyboard navigation

#### Services
- Single responsibility principle
- Pure functions where possible
- Proper error handling (try-catch)
- Logging on errors
- TypeScript interfaces for contracts

#### API Routes
- Always return JSON with consistent shape
- Proper HTTP status codes (201 Created, 204 No Content, 400 Bad Request, 401 Unauthorized, 403 Forbidden, 404 Not Found, 500 Server Error)
- Validate all inputs with Zod
- Require authentication where appropriate
- Rate limit sensitive endpoints
- Log all requests

#### Tests
- One assertion per test case (when possible)
- Descriptive test names
- Use beforeEach/afterEach for setup/teardown
- Mock external dependencies
- Test both happy path and error cases
- E2E tests for critical user flows only (slow)

### Documentation

#### Code Comments
```typescript
// Good: explains WHY, not WHAT
// Retry with exponential backoff to avoid overwhelming email service
const delay = Math.pow(2, attempt) * 1000; // 1s, 2s, 4s...

// Bad: obvious from code
// Set i to 0
let i = 0;
```

#### JSDoc for Public Methods
```typescript
/**
 * Send an email notification to a user.
 * 
 * @param userId - User's UUID
 * @param type - Notification type (quiz_submitted, exam_completed, etc)
 * @param metadata - Additional context (quizId, score, etc)
 * @returns Notification object with ID and status
 * @throws DatabaseError if notification record creation fails
 * 
 * @example
 * ```ts
 * await notificationService.sendNotification(
 *   userId,
 *   'quiz_submitted',
 *   { quizId: '123', score: 85 }
 * );
 * ```
 */
export async function sendNotification(
  userId: string,
  type: NotificationType,
  metadata: Record<string, unknown>
): Promise<Notification> {
  // implementation
}
```

#### README Updates
When adding features, update top-level README.md with:
- New feature description
- Where to find it in UI
- How to use it
- Database changes (if any)

### Common Issues & Solutions

#### "Database is locked" error

```bash
# Close other connections
npm run db:studio # Closes Drizzle Studio
# Then retry db:push
npm run db:push
```

#### Test fails with "Cannot find module" for new file

```bash
# Restart test watcher
npm run test:watch
# Vite caches module imports

# Or clear cache
rm -rf node_modules/.vite
npm run test:watch
```

#### ESLint error: "Unused variable"

```typescript
// If intentionally unused (error handling):
const [_error, result] = await somePromise();

// Or use eslint-disable comment (sparingly):
// eslint-disable-next-line @typescript-eslint/no-unused-vars
const debugData = JSON.stringify(response, null, 2);
```

#### TypeScript error: "Type 'string' is not assignable to type 'UUID'"

```typescript
// Good: Use UUIDs properly with type system
const userId: UUID = '123' as UUID; // Cast if coming from untrusted source
const userId: UUID = crypto.randomUUID(); // Generate properly typed

// Verify at runtime:
import { z } from 'zod';
const UUIDSchema = z.string().uuid();
const userId = UUIDSchema.parse(input);
```

## Continuous Integration (GitHub Actions)

After merging to main, GitHub Actions automatically:

1. **Run all tests:**
   ```bash
   npm run typecheck && npm run lint && npm run test && npm run test:e2e
   ```

2. **Build application:**
   ```bash
   npm run build
   ```

3. **Deploy to staging** (if all checks pass)

4. **Run smoke tests** on staging deployment

Check `.github/workflows/` for configurations.

## Deployment Checklist

Before merging to main:

- [ ] Feature complete and tested locally
- [ ] All tests pass: `npm run test && npm run test:e2e`
- [ ] TypeScript clean: `npm run typecheck`
- [ ] ESLint clean: `npm run lint`
- [ ] Database migrations generated and previewed
- [ ] Migrations tested on staging database
- [ ] CHANGELOG.log updated with all changes
- [ ] PR description complete with test results
- [ ] Code reviewed and approved (≥1 reviewer)
- [ ] No merge conflicts with main
- [ ] Rollback plan documented

After merge (automatic):
- [ ] Staging deployment succeeds
- [ ] Smoke tests pass on staging
- [ ] Team reviews deployment on staging
- [ ] Approve production deployment
- [ ] Production deployment succeeds
- [ ] Monitor error logs for 1 hour post-deployment

## Getting Help

- **Architecture questions:** Check `IMPLEMENTATION_ROADMAP.md`
- **Database schema:** Check `src/db/schema.ts`
- **API design:** Check existing endpoints in `src/app/api/`
- **Component patterns:** Check `src/components/`
- **Testing:** Check existing test files (`__tests__` folders)
- **Build issues:** Check `next.config.js`, `tsconfig.json`

---

**Last Updated:** July 30, 2026  
**Owner:** Code Queens Engineering Team
