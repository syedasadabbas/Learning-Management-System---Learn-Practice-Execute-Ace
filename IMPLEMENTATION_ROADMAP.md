# LMS Feature Integration Roadmap

**Project:** Code Queens LMS Enhancement  
**Start Date:** July 30, 2026  
**Current Stack:** Next.js 15, React 19, PostgreSQL, Drizzle ORM, TypeScript, NextAuth v5  
**Objective:** Integrate advanced features from 6 leading LMS platforms while maintaining existing architecture

---

## Executive Summary

This roadmap integrates **8 high-impact features** across **2 phases** (10 weeks total) from analysis of:
- Frappe LMS (Python/Vue.js) — 6,330 commits, modern best practices
- Moodle (PHP) — Enterprise standard, 121k+ commits
- 4 additional open-source LMS platforms

**Expected Outcomes:**
- 15-25% increase in submission rates (notifications)
- 10-15% re-engagement boost (badges/certificates)
- 30% reduction in instructor email load (forums)
- Data-driven teaching improvements (analytics)
- Institutional compliance and fraud detection (activity logs)

---

## Feature Breakdown & Implementation Details

### PHASE 1: Quick Wins (Weeks 1-4)

#### 1. Email Notifications System
**Effort:** 20 minutes - Multiple Subagents | **Impact:** High | **Complexity:** Low

**What it adds:**
- Real-time email alerts for quiz submissions, exam completion, assignment feedback, penalties
- Notification preferences per student
- Notification history dashboard
- Admin email template management

**Database Schema:**

```typescript
// Add to src/db/schema.ts
export const notificationTypes = pgEnum('notification_type', [
  'quiz_submitted',
  'exam_completed',
  'assignment_feedback',
  'penalty_issued',
  'forum_reply',
  'badge_earned',
  'grade_posted',
  'course_message',
]);

export const notificationStatus = pgEnum('notification_status', [
  'pending',
  'sent',
  'failed',
  'bounced',
]);

export const notifications = pgTable('notifications', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id').notNull().references(() => users.id),
  type: notificationTypes('type').notNull(),
  recipientEmail: varchar('recipient_email', 255).notNull(),
  subject: varchar('subject', 255).notNull(),
  body: text('body').notNull(),
  metadata: jsonb('metadata'), // context data (quiz_id, submission_id, etc.)
  status: notificationStatus('status').default('pending'),
  sentAt: timestamp('sent_at'),
  failureReason: text('failure_reason'),
  createdAt: timestamp('created_at').defaultNow(),
  updatedAt: timestamp('updated_at').defaultNow(),
});

export const notificationPreferences = pgTable('notification_preferences', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id').notNull().references(() => users.id),
  quizSubmitted: boolean('quiz_submitted').default(true),
  examCompleted: boolean('exam_completed').default(true),
  assignmentFeedback: boolean('assignment_feedback').default(true),
  penaltyIssued: boolean('penalty_issued').default(true),
  forumReply: boolean('forum_reply').default(true),
  badgeEarned: boolean('badge_earned').default(true),
  gradePosted: boolean('grade_posted').default(true),
  courseMessage: boolean('course_message').default(true),
  digestDaily: boolean('digest_daily').default(false),
  digestWeekly: boolean('digest_weekly').default(true),
  createdAt: timestamp('created_at').defaultNow(),
  updatedAt: timestamp('updated_at').defaultNow(),
});
```

**Key Files to Create/Modify:**
- `src/lib/services/notification.service.ts` — Notification logic
- `src/app/api/notifications/[id]/route.ts` — Notification CRUD
- `src/app/api/notifications/preferences/route.ts` — Preferences management
- `src/components/settings/NotificationPreferences.tsx` — Settings UI
- `src/app/(app)/settings/page.tsx` — Add notifications tab

**Testing Strategy:**
```typescript
// src/lib/services/__tests__/notification.service.test.ts
describe('NotificationService', () => {
  it('should send email notification on quiz submission', async () => {
    // Mock nodemailer transport
    // Test email sent with correct subject/body
    // Verify notification status = 'sent'
  });

  it('should respect user notification preferences', async () => {
    // Disable quiz_submitted preference
    // Submit quiz
    // Verify no email sent
  });

  it('should handle email failures gracefully', async () => {
    // Mock transport error
    // Verify status = 'failed', failureReason populated
  });
});
```

**Integration Points:**
- Hook into existing quiz submission flow (`src/app/api/quizzes/[quizId]/submit`)
- Hook into assignment grading flow (`src/app/api/instructor/submissions/[id]/grade`)
- Hook into penalty issuance (`src/lib/penalties/`)

---

#### 2. Certificates and Completion Tracking
**Effort:** 30 minutes - Multiple Subagents | **Impact:** High | **Complexity:** Medium

**What it adds:**
- Automatic certificate generation on 100% course completion
- Downloadable PDF certificates with student name, completion date, course title
- Shareable public links with verification
- Certificate template customization (admin panel)

**Database Schema:**

```typescript
export const certificates = pgTable('certificates', {
  id: uuid('id').primaryKey().defaultRandom(),
  studentId: uuid('student_id').notNull().references(() => users.id),
  courseId: uuid('course_id').notNull().references(() => courses.id),
  templateId: uuid('template_id').references(() => certificateTemplates.id),
  issuedAt: timestamp('issued_at').notNull().defaultNow(),
  expiresAt: timestamp('expires_at'), // null = no expiry
  pdfUrl: varchar('pdf_url', 500).notNull(), // Vercel Blob URL
  verificationToken: varchar('verification_token', 255).unique(), // Public sharing
  verifiedAt: timestamp('verified_at'), // When verification was done
  revokedAt: timestamp('revoked_at'), // Admin revocation
  createdAt: timestamp('created_at').defaultNow(),
});

export const certificateTemplates = pgTable('certificate_templates', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: varchar('name', 255).notNull(),
  description: text('description'),
  htmlTemplate: text('html_template').notNull(), // Handlebars template
  logoUrl: varchar('logo_url', 500),
  accentColor: varchar('accent_color', 7).default('#2563eb'), // Hex color
  fontFamily: varchar('font_family', 100).default('Inter'),
  isActive: boolean('is_active').default(true),
  createdBy: uuid('created_by').references(() => users.id),
  createdAt: timestamp('created_at').defaultNow(),
  updatedAt: timestamp('updated_at').defaultNow(),
});
```

**Key Files to Create/Modify:**
- `src/lib/services/certificate.service.ts` — PDF generation (use `@react-pdf/renderer`)
- `src/app/api/certificates/route.ts` — Generate certificate on completion
- `src/app/api/certificates/[id]/verify/route.ts` — Public verification
- `src/app/(app)/certificates/page.tsx` — Certificate gallery
- `src/components/certificates/CertificateCard.tsx` — Display component
- `src/app/admin/certificates/templates/page.tsx` — Template management

**Testing Strategy:**
```typescript
// src/lib/services/__tests__/certificate.service.test.ts
describe('CertificateService', () => {
  it('should generate certificate when course is 100% complete', async () => {
    // Mark all weeks/assignments complete for student
    // Trigger completion check
    // Verify certificate created in DB
    // Verify PDF generated and uploaded
  });

  it('should create public verification link', async () => {
    // Generate certificate
    // Create verification token
    // Visit public URL without auth
    // Verify certificate details display correctly
  });

  it('should handle PDF generation errors', async () => {
    // Mock PDF renderer error
    // Verify error logged and retry possible
  });
});
```

**Integration Points:**
- Hook into progress calculation (`src/lib/progress/`)
- Auto-trigger on progress.week_unlocked all weeks logic
- Add certificate check to leaderboard query

---

#### 3. Badges and Gamification
**Effort:** 1 hour - Multiple Subagents | **Impact:** Medium | **Complexity:** Medium

**What it adds:**
- Earn badges for achievements (first submission, perfect quiz, 7-day streak, etc.)
- Badge display on profile and leaderboard
- Badge notifications when earned
- Admin badge management

**Database Schema:**

```typescript
export const badgeTypes = pgEnum('badge_type', [
  'first_submission',
  'perfect_quiz',
  'consecutive_days',
  'high_score',
  'peer_review_master',
  'forum_helper',
  'all_assignments_ontime',
  'coding_genius',
]);

export const badges = pgTable('badges', {
  id: uuid('id').primaryKey().defaultRandom(),
  type: badgeTypes('type').unique().notNull(),
  name: varchar('name', 255).notNull(),
  description: text('description'),
  iconUrl: varchar('icon_url', 500).notNull(),
  criteria: jsonb('criteria').notNull(), // { type: 'quiz_score', value: 95 }
  points: integer('points').default(10), // Leaderboard points
  rarity: varchar('rarity', 20).default('common'), // common/rare/epic/legendary
  isActive: boolean('is_active').default(true),
  createdAt: timestamp('created_at').defaultNow(),
});

export const userBadges = pgTable('user_badges', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id').notNull().references(() => users.id),
  badgeId: uuid('badge_id').notNull().references(() => badges.id),
  earnedAt: timestamp('earned_at').defaultNow(),
  progress: jsonb('progress'), // For badges with milestones
  createdAt: timestamp('created_at').defaultNow(),
}, (table) => ({
  unique: uniqueIndex().on(table.userId, table.badgeId),
}));
```

**Key Files to Create/Modify:**
- `src/lib/services/badge.service.ts` — Badge earning logic
- `src/app/api/badges/route.ts` — Badge CRUD
- `src/app/api/me/badges/route.ts` — Get user's badges
- `src/components/badges/BadgeCard.tsx` — Display component
- `src/components/badges/BadgePopover.tsx` — Detail view
- Hook badge triggers in:
  - Quiz submission → check perfect_quiz
  - Assignment submission → check first_submission
  - Leaderboard update → check high_score, consecutive_days

**Testing Strategy:**
```typescript
// src/lib/services/__tests__/badge.service.test.ts
describe('BadgeService', () => {
  it('should award first_submission badge', async () => {
    // Submit first assignment
    // Verify badge created
    // Verify notification sent
  });

  it('should track consecutive_days badge progress', async () => {
    // Record 7 consecutive login days
    // Verify badge earned on day 7
  });

  it('should not award duplicate badges', async () => {
    // Attempt to earn same badge twice
    // Verify only one record in DB
  });
});
```

---

#### 4. Activity Logs and Audit Trail
**Effort:** 30 minutes - Multiple Subagents | **Impact:** High | **Complexity:** Low

**What it adds:**
- Complete audit trail of all student/instructor actions
- Admin view to search and filter activity logs
- Compliance export (CSV)
- Fraud detection (suspicious pattern alerts)

**Database Schema:**

```typescript
export const activityActionTypes = pgEnum('activity_action', [
  'login',
  'logout',
  'quiz_start',
  'quiz_submit',
  'exam_start',
  'exam_submit',
  'assignment_submit',
  'assignment_review',
  'profile_update',
  'password_change',
  'file_upload',
  'code_execute',
  'forum_post',
  'forum_reply',
  'peer_review',
  'module_complete',
]);

export const activityLogs = pgTable('activity_logs', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id').notNull().references(() => users.id),
  action: activityActionTypes('action').notNull(),
  entityType: varchar('entity_type', 50), // 'quiz', 'assignment', 'user', etc.
  entityId: uuid('entity_id'),
  ipAddress: varchar('ip_address', 45),
  userAgent: text('user_agent'),
  details: jsonb('details'), // Additional context
  status: varchar('status', 20).default('success'), // success/failed
  errorMessage: text('error_message'),
  createdAt: timestamp('created_at').defaultNow(),
}, (table) => ({
  userIdIdx: index().on(table.userId),
  createdAtIdx: index().on(table.createdAt),
  entityIdx: index().on(table.entityType, table.entityId),
}));
```

**Key Files to Create/Modify:**
- `src/lib/services/activity-log.service.ts` — Logging service
- `src/middleware.ts` — Add activity logging to middleware
- `src/app/api/activity-logs/route.ts` — Admin query endpoint
- `src/app/(staff)/admin/activity-logs/page.tsx` — Admin view
- `src/components/admin/ActivityLogsTable.tsx` — Table with filters

**Testing Strategy:**
```typescript
// src/lib/services/__tests__/activity-log.service.test.ts
describe('ActivityLogService', () => {
  it('should log user login action', async () => {
    // User logs in
    // Verify activity_logs row created with action=login
  });

  it('should log sensitive actions only', async () => {
    // Track which actions are logged
    // Verify password_change logged but not password value
  });

  it('should filter logs by date range and user', async () => {
    // Create multiple log entries
    // Query with filters
    // Verify correct rows returned
  });
});
```

**Integration Points:**
- Add to auth handlers (`src/lib/auth.ts`)
- Add to middleware (`src/middleware.ts`)
- Hook into all API endpoints that modify data

---

### PHASE 2: Core Features (Weeks 5-10)

#### 5. Discussion Forums
**Effort:** 2 hours - Multiple Subagents | **Impact:** High | **Complexity:** High

**Database Schema:**

```typescript
export const forumTopics = pgTable('forum_topics', {
  id: uuid('id').primaryKey().defaultRandom(),
  weekId: uuid('week_id').notNull().references(() => weeks.id),
  title: varchar('title', 255).notNull(),
  description: text('description'),
  createdBy: uuid('created_by').notNull().references(() => users.id),
  isPinned: boolean('is_pinned').default(false),
  isLocked: boolean('is_locked').default(false),
  postCount: integer('post_count').default(0),
  lastPostAt: timestamp('last_post_at'),
  createdAt: timestamp('created_at').defaultNow(),
  updatedAt: timestamp('updated_at').defaultNow(),
});

export const forumPosts = pgTable('forum_posts', {
  id: uuid('id').primaryKey().defaultRandom(),
  topicId: uuid('topic_id').notNull().references(() => forumTopics.id),
  userId: uuid('user_id').notNull().references(() => users.id),
  content: text('content').notNull(),
  isSolution: boolean('is_solution').default(false), // Instructor marks best answer
  upvotes: integer('upvotes').default(0),
  createdAt: timestamp('created_at').defaultNow(),
  updatedAt: timestamp('updated_at').defaultNow(),
}, (table) => ({
  topicIdx: index().on(table.topicId),
  userIdx: index().on(table.userId),
}));
```

**Key Files:**
- `src/components/forum/ForumTopicList.tsx`
- `src/components/forum/ForumPostViewer.tsx`
- `src/components/forum/PostComposer.tsx`
- `src/app/api/forum/topics/route.ts`
- `src/app/(app)/weeks/[weekId]/forum/page.tsx`

---

#### 6. Peer Review System
**Effort:** 2 hours - Multiple Subagents | **Impact:** High | **Complexity:** High

**Database Schema:**

```typescript
export const peerReviews = pgTable('peer_reviews', {
  id: uuid('id').primaryKey().defaultRandom(),
  submissionId: uuid('submission_id').notNull().references(() => submissions.id),
  reviewerId: uuid('reviewer_id').notNull().references(() => users.id),
  rubricId: uuid('rubric_id').references(() => gradingRubrics.id),
  content: text('content').notNull(),
  rubricScores: jsonb('rubric_scores'), // { criterion_1: 8, criterion_2: 9 }
  totalScore: integer('total_score'),
  visibility: varchar('visibility', 20).default('anonymous'), // 'anonymous' or 'named'
  createdAt: timestamp('created_at').defaultNow(),
});

export const gradingRubrics = pgTable('grading_rubrics', {
  id: uuid('id').primaryKey().defaultRandom(),
  assignmentId: uuid('assignment_id').references(() => assignments.id),
  name: varchar('name', 255).notNull(),
  criteria: jsonb('criteria').notNull(), // [ { name: 'Clarity', maxPoints: 10 } ]
  createdBy: uuid('created_by').references(() => users.id),
  createdAt: timestamp('created_at').defaultNow(),
});
```

---

#### 7. Advanced Analytics Dashboard
**Effort:** 1.5 hours - Multiple Subagents | **Impact:** High | **Complexity:** High

**Key Visualizations:**
- Course completion rates per week
- Student performance distribution
- Problem difficulty analysis
- Time-on-task heatmaps
- Student engagement metrics (login frequency, submission patterns)
- Predictive alerts for at-risk students

**Key Files:**
- `src/app/(staff)/instructor/analytics-v2/page.tsx`
- `src/components/analytics/CourseProgressChart.tsx`
- `src/components/analytics/PerformanceDistribution.tsx`
- `src/lib/analytics/queries.ts` — Optimized aggregation queries
- `src/app/api/analytics/[metric]/route.ts` — Analytics API

---

#### 8. Course Prerequisites and Learning Paths
**Effort:** 1 hour - Multiple Subagents | **Impact:** Medium | **Complexity:** Medium

**Database Schema:**

```typescript
export const coursePrerequisites = pgTable('course_prerequisites', {
  id: uuid('id').primaryKey().defaultRandom(),
  courseId: uuid('course_id').notNull().references(() => courses.id),
  prerequisiteCourseId: uuid('prerequisite_course_id').notNull().references(() => courses.id),
  minScore: integer('min_score'), // Minimum score to satisfy prerequisite
  createdAt: timestamp('created_at').defaultNow(),
});

export const learningPaths = pgTable('learning_paths', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: varchar('name', 255).notNull(),
  description: text('description'),
  courseOrder: uuid('course_order').array(), // Ordered course IDs
  createdBy: uuid('created_by').references(() => users.id),
  createdAt: timestamp('created_at').defaultNow(),
});
```

---

## Database Migration Strategy

### Safe Migration Process

1. **Pre-migration backup:**
   ```bash
   # Backup production database
   pg_dump neon_connection_string > backup_$(date +%Y%m%d_%H%M%S).sql
   ```

2. **Generate Drizzle migrations:**
   ```bash
   npm run db:generate
   ```

3. **Verify migration SQL** before applying:
   ```bash
   cat src/db/migrations/0001_*.sql
   ```

4. **Test on staging database:**
   ```bash
   npm run db:push # On staging environment
   npm run test # Verify no data loss
   ```

5. **Apply to production:**
   ```bash
   npm run db:push # On production
   ```

6. **Verify migration:**
   ```bash
   npm run db:verify-schema
   ```

### Rollback Procedure

If migration fails:
```bash
# Restore from backup
psql neon_connection_string < backup_$(date +%Y%m%d_%H%M%S).sql

# Revert code to previous commit
git revert HEAD
npm install
npm run build
npm start
```

---

## Git Workflow

### Branch Strategy

```
main (production)
 ├─ feature/email-notifications (4 commits)
 ├─ feature/certificates (5 commits)
 ├─ feature/badges (4 commits)
 ├─ feature/activity-logs (3 commits)
 ├─ feature/discussion-forums (8 commits)
 ├─ feature/peer-review (8 commits)
 ├─ feature/analytics (6 commits)
 └─ feature/prerequisites (4 commits)
```

### Commit Message Format

```
feat(email-notifications): add email service layer

- Create notifications table and schema
- Implement nodemailer integration
- Add notification preferences to settings
- Trigger emails on quiz submission

CHANGELOG.log: EMAIL-NOTIFICATIONS-001
```

### Pull Request Template

```markdown
## Feature: [Feature Name]
- Week: [1-10]
- Phase: [Phase 1/2]
- Files: [X files changed, Y insertions, Z deletions]

## Tests
- [x] Unit tests pass (npm run test)
- [x] E2E tests pass (npm run test:e2e)
- [x] No database errors
- [x] No TypeScript errors (npm run typecheck)
- [x] No ESLint errors (npm run lint)

## Migration
- [x] Database schema updated
- [x] Existing data safe (no data loss)
- [x] Backwards compatible
```

---

## Testing Strategy

### Unit Tests (vitest)

For each feature, create `__tests__` directory:
```
src/lib/services/__tests__/
  ├─ notification.service.test.ts (15 tests)
  ├─ certificate.service.test.ts (12 tests)
  ├─ badge.service.test.ts (10 tests)
  └─ activity-log.service.test.ts (8 tests)
```

**Test Coverage Target:** 80%+ for business logic

### Component Tests (@testing-library/react)

```
src/components/__tests__/
  ├─ NotificationPreferences.test.tsx (8 tests)
  ├─ BadgeCard.test.tsx (6 tests)
  ├─ ActivityLogsTable.test.tsx (10 tests)
```

### E2E Tests (playwright)

```
tests/e2e/
  ├─ notifications.spec.ts (12 tests)
  ├─ certificates.spec.ts (8 tests)
  ├─ badges.spec.ts (10 tests)
  ├─ activity-logs.spec.ts (6 tests)
```

### Performance Testing

- Dashboard page load: < 2 seconds
- Activity logs filter: < 500ms for 10k records
- Analytics chart render: < 1 second

### Test Commands

```bash
# Unit tests
npm run test

# Watch mode
npm run test:watch

# E2E tests
npm run test:e2e

# E2E with UI
npm run test:e2e:ui

# Coverage report
npm run test -- --coverage

# Lint
npm run lint

# Type check
npm run typecheck
```

---

## Deployment Checklist

### Pre-Deployment
- [ ] All tests pass locally (`npm run test && npm run test:e2e`)
- [ ] Database migrations tested on staging
- [ ] ESLint and TypeScript checks clean (`npm run lint && npm run typecheck`)
- [ ] No console errors in browser DevTools
- [ ] Staging environment fully tested
- [ ] Rollback plan documented and tested

### Deployment Steps
- [ ] Merge PR to main after code review
- [ ] Tag release (`git tag v1.1.0`)
- [ ] Build production image (`npm run build`)
- [ ] Deploy to Vercel (auto on main push)
- [ ] Run database migrations on production
- [ ] Smoke test critical paths
- [ ] Monitor error logs for 1 hour

### Post-Deployment
- [ ] Verify all features working in production
- [ ] Check database performance (no slow queries)
- [ ] Monitor email delivery rates
- [ ] Verify notifications sending
- [ ] Check PDF generation for certificates
- [ ] Review activity logs for errors

---

## Success Metrics

| Feature | Metric | Target | Measurement |
|---------|--------|--------|-------------|
| Email Notifications | Email open rate | 35%+ | Vercel Analytics |
| Certificates | Download rate | 80%+ | PDF download events |
| Badges | Engagement | 60%+ weekly active | User session frequency |
| Activity Logs | Coverage | 100% of actions | Audit trail completeness |
| Forums | Posts per week | 50+ | Forum post count |
| Peer Review | Participation | 90%+ | Review submissions |
| Analytics | Usage | 3x/week per instructor | Dashboard page views |
| Prerequisites | Enforcement | 100% | Enrollment validation |

---

## Technology Dependencies

### New npm Packages Required

```json
{
  "dependencies": {
    "@react-pdf/renderer": "^3.10.0",
    "handlebars": "^4.7.7",
    "@vercel/blob": "^0.20.0",
    "react-toastify": "^10.0.0"
  },
  "devDependencies": {
    "@testing-library/react": "^16.1.0",
    "@testing-library/jest-dom": "^6.6.3"
  }
}
```

**Installation:**
```bash
npm install @react-pdf/renderer handlebars @vercel/blob react-toastify
npm install --save-dev @testing-library/react @testing-library/jest-dom
```

### Estimated Install Time
- Dependencies: 2 minutes
- Peer dependencies: Included with Next.js

---

## Risk Assessment

| Feature | Risk | Mitigation |
|---------|------|-----------|
| Email Notifications | Delivery failure | Implement retry logic, queue system |
| Certificates | PDF generation overhead | Cache templates, use serverless functions |
| Badges | Duplicate awards | Unique constraint in DB |
| Activity Logs | Storage bloat | Implement retention policy (90 days) |
| Forums | Spam content | Moderation queue, flagging system |
| Peer Review | Bias in grading | Anonymous reviews by default |
| Analytics | Performance | Query optimization, caching |
| Prerequisites | Broken course chains | Validation before course creation |

---

## Timeline

| Phase | Feature | Week | Status |
|-------|---------|------|--------|
| **Phase 1** | Email Notifications | 1 | Pending |
| | Certificates | 2 | Pending |
| | Badges | 3 | Pending |
| | Activity Logs | 4 | Pending |
| **Phase 2** | Discussion Forums | 5-6 | Pending |
| | Peer Review | 7-8 | Pending |
| | Analytics | 9-10 | Pending |
| | Prerequisites | 10-11 | Pending |
| **Finalize** | Testing & Docs | 11-12 | Pending |

---

## Team Assignments (Recommended)

- **Backend Lead:** Database schema, API endpoints, services (email, certificate generation, analytics)
- **Frontend Lead:** UI components, dashboards, forms
- **QA Lead:** Test automation, performance testing, migration verification
- **DevOps:** Deployment, monitoring, rollback procedures

---

## References & Inspiration

- **Frappe LMS** — Discussion forum implementation, certificate generation
- **Moodle** — Badges system, activity logs, grading rubrics
- **Canvas** — Analytics dashboard design
- **Blackboard** — Peer review workflow
- **Coursera** — Badge rarity tiers, achievement notifications

---

## Document Maintenance

**Last Updated:** July 30, 2026  
**Next Review:** August 6, 2026 (after Phase 1 kick-off)  
**Owner:** Code Queens Engineering Team

---

## Questions & Support

For questions on implementation details, refer to:
- Database schema reference → `src/db/schema.ts`
- API patterns → `src/app/api/` folder
- Component patterns → `src/components/` folder
- Testing patterns → `src/**/__tests__/` folders

Contact engineering lead for clarifications on architecture decisions.
