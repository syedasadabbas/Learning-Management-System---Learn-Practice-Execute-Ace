# Master Prompt for Claude Code: LMS Complete Enhancement
## Multi-Subagent Orchestration for Complete Platform Upgrade

**Target:** Code Queens Hub LMS  
**Scope:** Learning enhancements + Live classes + Presentations  
**Approach:** Parallel subagent execution  
**Timeline:** 54-96 hours total (15-25 hours wall-clock with parallel work)  
**Coordination:** Master orchestration with subagent task delegation  

---

## PRIMARY BRIEF FOR CLAUDE CODE

You are orchestrating the complete enhancement of the Code Queens Hub LMS. Your task is to:

1. **Spin up parallel subagents** for independent work streams
2. **Coordinate task dependencies** and integration points
3. **Ensure code quality** through comprehensive testing
4. **Merge all branches** into production-ready state

You have detailed specifications in these files (already in the repository):

```
Reference Files:
├─ LMS_ENHANCEMENT_STRATEGY.md (learning enhancements)
├─ TECHNICAL_SPECIFICATION.md (detailed schemas & APIs)
├─ LIVE_CLASSES_AND_PRESENTATIONS_STRATEGY.md (feature specs)
├─ LIVE_CLASSES_PRESENTATIONS_TECHNICAL_SPEC.md (implementation guide)
├─ COMPLETE_LMS_ENHANCEMENT_SUMMARY.md (overview & timeline)
└─ This file (orchestration guide)
```

---

## EXECUTION STRATEGY: PARALLEL SUBAGENTS

You will coordinate **7 specialized subagents** working in parallel:

```
┌─ SUBAGENT 1: Database Architect (8-12 hours)
│  └─ Migrations, schemas, indexes, Drizzle ORM types
│
├─ SUBAGENT 2: Backend API Developer (12-16 hours)
│  └─ All API routes, endpoints, business logic
│
├─ SUBAGENT 3: Frontend Component Engineer (16-20 hours)
│  └─ React components, UI/UX, state management
│
├─ SUBAGENT 4: Integration Specialist (8-12 hours)
│  └─ Jitsi Meet, Reveal.js, Socket.io WebSocket
│
├─ SUBAGENT 5: Real-time Systems Engineer (8-12 hours)
│  └─ WebSocket server, chat, Q&A, notifications
│
├─ SUBAGENT 6: QA & Testing Specialist (12-16 hours)
│  └─ Unit tests, E2E tests, integration tests
│
└─ SUBAGENT 7: Documentation & Deployment (4-8 hours)
   └─ Code comments, README, deployment guide
```

**Wall-clock time:** 15-25 hours (everything runs parallel)  
**Total effort:** 68-96 hours of development

---

## DETAILED SUBAGENT BRIEFS

### SUBAGENT 1: Database Architect
**Time:** 8-12 hours  
**Priority:** CRITICAL - Others depend on this  
**Deliverables:** Migrations + types ready to use

```
Your mission:
1. Create PostgreSQL migration file with all new tables:
   - assignment_samples
   - practice_problems
   - interview_questions
   - lecture_visualizations
   - live_classes
   - class_attendance
   - class_chat
   - class_qa
   - class_recordings
   - presentations
   - presentation_slides
   - presentation_submissions
   - presentation_feedback

2. Write Drizzle ORM schema definitions for all tables

3. Create indexes for performance:
   - Foreign key lookups
   - Status filtering
   - Time range queries
   - User/assignment lookups

4. Define relationships and constraints

5. Run migration on your test database to verify

6. Document schema in SCHEMA.md with relationships

Reference: TECHNICAL_SPECIFICATION.md Part 1 has exact schema

Acceptance criteria:
✓ Migration runs without errors
✓ All tables created with correct relationships
✓ All indexes present
✓ Drizzle types generated and exported
✓ No foreign key violations possible
```

---

### SUBAGENT 2: Backend API Developer
**Time:** 12-16 hours  
**Depends on:** Subagent 1 (database schema)  
**Deliverables:** All API routes with validation & auth

```
Your mission:
Build complete API layer for all three features:

LEARNING ENHANCEMENT ROUTES (30 total):
  ├─ /api/assignments/[id]/samples (GET, POST, PUT, DELETE)
  ├─ /api/lectures/[id]/practice-problems (GET, search, filter)
  ├─ /api/practice-problems/[id] (GET with full details)
  ├─ /api/practice-problems/[id]/attempt (POST - submit solution)
  ├─ /api/interview-questions (GET with filters)
  ├─ /api/interview-questions/[id] (GET with full answer)
  └─ /api/lectures/[id]/visualizations (GET all visuals)

LIVE CLASSES ROUTES (20 total):
  ├─ /api/classes (GET, POST)
  ├─ /api/classes/upcoming (GET filtered by user)
  ├─ /api/classes/[id] (GET, PUT, DELETE)
  ├─ /api/classes/[id]/start (POST - instructor)
  ├─ /api/classes/[id]/end (POST - instructor)
  ├─ /api/classes/[id]/join (GET - get Jitsi config)
  ├─ /api/classes/[id]/recording (GET)
  ├─ /api/classes/[id]/attendance (GET - report)
  ├─ /api/classes/[id]/chat (GET, POST)
  ├─ /api/classes/[id]/qa (GET, POST, PUT)
  └─ Moderation endpoints for instructor

PRESENTATIONS ROUTES (15 total):
  ├─ /api/presentations (GET, POST)
  ├─ /api/presentations/[id] (GET, PUT, DELETE)
  ├─ /api/presentations/[id]/slides (GET, POST)
  ├─ /api/presentations/[id]/slides/[num] (PUT)
  ├─ /api/presentations/[id]/export (POST - multiple formats)
  ├─ /api/presentations/[id]/present (POST - start presentation)
  ├─ /api/presentations/[id]/theme (GET, PUT)
  └─ /api/presentations/submissions (POST - student submit)

For each route:
  ✓ Full validation of request data
  ✓ Authorization checks (student/instructor/admin)
  ✓ Error handling with proper status codes
  ✓ Database transactions where needed
  ✓ Logging for audit trail
  ✓ Input sanitization

Special considerations:
  ✓ Idempotent operations (safe to retry)
  ✓ Pagination for list endpoints
  ✓ Proper HTTP status codes (201 for create, etc.)
  ✓ Meaningful error messages
  ✓ API documentation in route comments

Reference: TECHNICAL_SPECIFICATION.md Part 2 has all specs

Acceptance criteria:
✓ All 65+ routes implemented
✓ Every route has validation
✓ Auth checks on restricted routes
✓ Error handling comprehensive
✓ Tests exist for critical paths
✓ No SQL injection possible
```

---

### SUBAGENT 3: Frontend Component Engineer
**Time:** 16-20 hours  
**Depends on:** Subagent 2 (API routes ready)  
**Deliverables:** React components, fully styled, responsive

```
Your mission:
Build ALL React components for the three features:

LEARNING ENHANCEMENT COMPONENTS (20+):
  ├─ <AssignmentSampleShowcase />
  ├─ <SampleCard />
  ├─ <CodeSnippetViewer />
  ├─ <PracticeProblemCard />
  ├─ <ProgressiveHintRevealer />
  ├─ <TestResultsBreakdown />
  ├─ <QuestionExplanationViewer />
  ├─ <CommonMistakesDisplay />
  ├─ <BoxModelVisualizer />
  ├─ <FlexboxPlayground />
  ├─ <HTTPCycleDiagram />
  └─ Other visualization components

LIVE CLASSES COMPONENTS (15+):
  ├─ <ClassScheduler />
  ├─ <LiveClassRoom />
  ├─ <JitsiEmbed />
  ├─ <ChatPanel />
  ├─ <QAPanel />
  ├─ <ParticipantsPanel />
  ├─ <ClassRecording />
  ├─ <AttendanceReport />
  ├─ <ClassCalendar />
  └─ Live indicators, status badges

PRESENTATIONS COMPONENTS (18+):
  ├─ <PresentationBuilder />
  ├─ <SlideEditor />
  ├─ <SlideContentEditor />
  ├─ <SlideThumbnails />
  ├─ <PresentationViewer />
  ├─ <PresentationExporter />
  ├─ <ThemeSelector />
  ├─ <SpeakerNotes />
  ├─ <PresenterView />
  └─ Slide type components (title, content, code, image)

For each component:
  ✓ TypeScript with full type safety
  ✓ Responsive design (mobile, tablet, desktop)
  ✓ Accessibility (WCAG 2.1 AA)
  ✓ Dark mode support (if applicable)
  ✓ Error boundaries
  ✓ Loading states
  ✓ Proper styling with Tailwind
  ✓ Keyboard navigation
  ✓ Touch-friendly on mobile

Integration requirements:
  ✓ Call correct API endpoints
  ✓ Handle loading/error/success states
  ✓ Real-time updates via WebSocket where needed
  ✓ Form validation before submit
  ✓ Optimistic UI updates

Reference: TECHNICAL_SPECIFICATION.md Part 3 has all specs

Acceptance criteria:
✓ All 50+ components implemented
✓ Zero TypeScript errors
✓ Responsive on all screen sizes
✓ Lighthouse accessibility > 95
✓ No console warnings
✓ API calls are correct
✓ Proper error handling
```

---

### SUBAGENT 4: Integration Specialist
**Time:** 8-12 hours  
**Depends on:** Subagent 2 (API ready), Subagent 3 (components ready)  
**Deliverables:** Third-party integrations working

```
Your mission:
Integrate external libraries and services:

JITSI MEET INTEGRATION (3-4 hours):
  1. Install @jitsi/react-sdk or use iframe approach
  2. Create wrapper component <JitsiEmbed />
  3. Implement these handlers:
     - onVideoConferenceJoined: Mark attendance
     - onVideoConferenceLeft: Calculate time present
     - onParticipantJoined: Log to chat
     - onParticipantLeft: Log to chat
  4. Configure Jitsi settings:
     - Room name from API
     - Password from API
     - Enable/disable features based on settings
  5. Handle JWT tokens for secure rooms (optional)
  6. Test with multiple participants

REVEAL.JS INTEGRATION (3-4 hours):
  1. Install reveal.js
  2. Create <RevealPresentation /> wrapper
  3. Handle these features:
     - Initialize from slides JSON
     - Navigation (next/prev/goto)
     - Speaker notes display
     - Fullscreen presentation mode
     - PDF export
  4. Custom theming system
  5. Keyboard shortcuts
  6. Touch navigation (mobile)

SOCKET.IO SETUP (2-3 hours):
  1. Set up Socket.io server
  2. Namespace for classes: /classes
  3. Rooms per class for broadcasting
  4. Handlers:
     - message: broadcast to class
     - question: send Q&A message
     - reaction: emoji reactions
     - typing: typing indicator
  5. Middleware for authentication
  6. Graceful disconnect handling

FRAMER MOTION (1-2 hours):
  1. Install framer-motion
  2. Add animations to:
     - Slide transitions
     - Component entrance/exit
     - Hover effects
     - Loading states
  3. Keep performance high (60fps)

Reference: LIVE_CLASSES_PRESENTATIONS_TECHNICAL_SPEC.md has details

Acceptance criteria:
✓ Jitsi loads in iframe without errors
✓ Socket.io connects automatically
✓ Reveal.js renders presentations correctly
✓ No third-party lib errors in console
✓ All libraries properly typed in TS
✓ Can switch between Jitsi URLs if needed
```

---

### SUBAGENT 5: Real-time Systems Engineer
**Time:** 8-12 hours  
**Depends on:** Subagent 2 (API ready), Subagent 4 (Socket.io setup)  
**Deliverables:** WebSocket server fully functional

```
Your mission:
Build real-time systems using Socket.io:

CHAT SYSTEM (3-4 hours):
  1. Create /api/ws/chat socket handler
  2. Implement features:
     - Send message: emit, persist to DB, broadcast
     - Edit message: update DB, broadcast edit
     - Delete message: soft delete, broadcast
     - Pin message: admin only
     - Typing indicators
     - Emoji reactions
  3. Rate limiting (max 5 msgs/sec per user)
  4. Content moderation (flag for instructor)
  5. Database persistence:
     - All messages saved to class_chat table
     - Retrieve history on join
  6. Handle disconnects gracefully

Q&A SYSTEM (3-4 hours):
  1. Create /api/ws/qa socket handler
  2. Features:
     - Ask question (student)
     - Answer question (instructor)
     - Upvote questions
     - Pin questions
     - Mark as answered
  3. Real-time notification when answered
  4. Database persistence:
     - Save to class_qa table
     - Retrieve on page load
  5. Sorting:
     - By newest
     - By most upvotes
     - Unanswered first

ENGAGEMENT TRACKING (2-3 hours):
  1. Track student actions:
     - Messages sent
     - Questions asked
     - Screen shares
  2. Calculate engagement score real-time
  3. Send to database after class
  4. Notify instructor of low engagement

EMAIL NOTIFICATIONS (2-3 hours):
  1. Send email when class scheduled (to students)
  2. Send email 15 min before class
  3. Send email recording is available
  4. Send email assignment due soon
  5. Use nodemailer or SendGrid
  6. Queue with Bull or similar

Reference: LIVE_CLASSES_PRESENTATIONS_TECHNICAL_SPEC.md Part 2

Acceptance criteria:
✓ Messages broadcast to all in class < 500ms
✓ Questions persist in database
✓ Engagement calculated correctly
✓ Emails send reliably
✓ No memory leaks on disconnect
✓ Can handle 100+ concurrent users
✓ Graceful degradation if socket fails
```

---

### SUBAGENT 6: QA & Testing Specialist
**Time:** 12-16 hours  
**Depends on:** All other subagents (integration phase)  
**Deliverables:** Comprehensive test suite, 85%+ coverage

```
Your mission:
Ensure everything works through comprehensive testing:

UNIT TESTS (4-5 hours):
  1. Test all API route logic
  2. Test all utility functions
  3. Test data validation
  4. Test authorization checks
  5. Mock database responses
  6. Use Jest + Supertest

Examples to test:
  ✓ Can create class with valid data
  ✓ Cannot create class without title
  ✓ Only instructor can schedule
  ✓ Recording flag persists correctly
  ✓ Practice problem hints reveal progressively
  ✓ Quiz scoring is accurate

INTEGRATION TESTS (4-5 hours):
  1. Test API + Database integration
  2. Test Socket.io events
  3. Test file uploads/storage
  4. Test notifications
  5. Use real database (test instance)

Scenarios to test:
  ✓ Student joins class → attendance recorded
  ✓ Send chat message → saved to DB, broadcasted
  ✓ Ask question → saved to DB, appears for instructor
  ✓ Complete practice problem → grading works
  ✓ Export presentation → file generated correctly
  ✓ Record class → can play back

E2E TESTS (3-4 hours):
  1. Test complete user workflows
  2. Test cross-browser compatibility
  3. Test mobile responsiveness
  4. Use Playwright

Complete workflows:
  ✓ Instructor schedules → Student joins → Chat works → Class ends
  ✓ Create presentation → Edit slides → Export PDF
  ✓ Student attempts practice → Sees hints → Checks solution
  ✓ Quiz attempt → Answers → Sees explanation

PERFORMANCE TESTS (1-2 hours):
  1. Page load times < 3 seconds
  2. API response times < 500ms
  3. Socket.io latency < 200ms
  4. No memory leaks
  5. Lighthouse scores > 90

Reference: TECHNICAL_SPECIFICATION.md Part 5 has test specs

Acceptance criteria:
✓ 85%+ code coverage
✓ All critical paths tested
✓ Zero flaky tests
✓ Performance benchmarks met
✓ No console errors
✓ Mobile tests passing
✓ Accessibility tests 95%+
```

---

### SUBAGENT 7: Documentation & Deployment
**Time:** 4-8 hours  
**Depends on:** All other subagents (final phase)  
**Deliverables:** Code ready for production, documented

```
Your mission:
Polish code and prepare for deployment:

CODE DOCUMENTATION (2-3 hours):
  1. JSDoc comments on all functions
  2. TypeScript types documented
  3. Complex logic explained
  4. API endpoint comments with examples
  5. Component prop documentation
  6. README for each module

Example format:
  /**
   * Get live class recording
   * @param classId - ID of the class
   * @returns HLS stream URL and metadata
   * @throws 404 if class not found
   * @throws 403 if not authorized
   */

GIT & REPO SETUP (1-2 hours):
  1. Create feature branches (if not done)
  2. Write commit messages following conventions
  3. Update CHANGELOG.log with all changes
  4. Create .gitignore entries
  5. Remove any debugging code
  6. Remove console.logs (except errors)

DEPLOYMENT GUIDE (1 hour):
  1. Database migration steps
  2. Environment variables needed
  3. Build & deploy commands
  4. Post-deploy verification checklist
  5. Rollback procedure

CONFIGURATION (1 hour):
  1. .env.example with all needed vars
  2. Database config for different environments
  3. Jitsi configuration options
  4. Socket.io settings
  5. File storage settings
  6. Email settings

SUMMARY DOCUMENT (1 hour):
  1. What was built (features)
  2. How to use new features
  3. Known limitations
  4. Future enhancement ideas
  5. Support/troubleshooting

Acceptance criteria:
✓ Every function has JSDoc
✓ No console.log (except errors)
✓ All TS types strict
✓ .env.example complete
✓ CHANGELOG.log updated
✓ README clear and complete
✓ No TODO comments without reason
✓ Ready to merge to main
```

---

## ORCHESTRATION WORKFLOW

### PHASE 1: Parallel Setup (0-2 hours)
```
1. Create feature branch: git checkout -b lms/complete-enhancement
2. Start Subagent 1: Database Architect
   └─ Blocks: All others need schema
3. While waiting, start documentation prep
4. Run tests on database schema
```

### PHASE 2: Parallel Development (2-20 hours)
```
After Subagent 1 completes → Start Subagent 2 (Backend)
After Subagent 2 completes → Start Subagent 3 (Components)
Parallel: Subagent 4 (Integrations) can start after 2 is halfway
Parallel: Subagent 5 (Real-time) starts after 4 starts
Once components exist: Subagent 6 (Testing) starts testing them
Final: Subagent 7 (Documentation) wraps everything
```

### PHASE 3: Integration & Testing (20-24 hours)
```
1. All subagents finish their work
2. Run complete test suite
3. Fix any integration issues
4. Performance testing
5. Security review
6. Final merge to develop branch
```

### PHASE 4: Handoff to Production (24-25 hours)
```
1. Review all changes
2. Database migration plan
3. Deployment checklist
4. Go/no-go decision
5. Deploy to production
6. Monitor for errors
```

---

## CRITICAL SUCCESS FACTORS

### DO THIS:
✅ Use `git checkout -b feature/lms-enhancement` before starting  
✅ Commit frequently with clear messages  
✅ Each subagent pushes to same branch  
✅ Write tests as you go (not after)  
✅ Run `npm run lint`, `npm run typecheck` before commits  
✅ Update CHANGELOG.log after each subagent completes  
✅ Test on multiple browsers/devices  
✅ Check accessibility with Lighthouse  
✅ Review all error handling  
✅ Document as you build  

### DON'T DO THIS:
❌ Wait for one subagent to finish before starting next  
❌ Write code without types/validation  
❌ Skip error handling  
❌ Ignore console warnings  
❌ Create console.log everywhere  
❌ Forget to test edge cases  
❌ Deploy without E2E tests  
❌ Leave TODOs without reason  

---

## INTEGRATION POINTS CHECKLIST

Make sure these connect properly:

**Database → API:**
- [ ] All tables can be queried correctly
- [ ] Foreign keys work both ways
- [ ] Indexes improve query speed
- [ ] Transactions prevent data loss

**API → Components:**
- [ ] All endpoints are called with correct params
- [ ] Error responses handled gracefully
- [ ] Loading states show while fetching
- [ ] Data formatted for component display

**Components → Real-time (WebSocket):**
- [ ] Chat component listens to Socket.io events
- [ ] Q&A updates in real-time
- [ ] Notifications appear instantly
- [ ] No duplicate messages

**External → LMS:**
- [ ] Jitsi loads in iframe
- [ ] Reveal.js renders presentations
- [ ] Can switch between Jitsi rooms
- [ ] Presentation export works

---

## TESTING STRATEGY SUMMARY

Each subagent should test their own work:

**Subagent 1 (Database):**
- Migration runs without errors
- All tables exist with right columns
- Can query with Drizzle ORM

**Subagent 2 (Backend):**
- Each route returns correct data
- Auth checks work
- Invalid input rejected
- 50+ API unit tests

**Subagent 3 (Components):**
- Components render without errors
- Props work correctly
- State updates properly
- 30+ component tests

**Subagent 4 (Integration):**
- Jitsi loads in iframe
- Reveal.js renders correctly
- Socket.io connects
- Integration tests pass

**Subagent 5 (Real-time):**
- Messages broadcast < 500ms
- Questions appear instantly
- Notifications work
- Real-time tests pass

**Subagent 6 (Testing):**
- Complete test suite passing
- 85%+ code coverage
- E2E workflows work
- Performance benchmarks met

**Subagent 7 (Documentation):**
- Code is well commented
- README is clear
- Deployment guide works
- Everything mergeable

---

## ROLLBACK & SAFETY

If something goes wrong:

```bash
# Revert to last known good state
git revert HEAD

# Or go back to develop
git reset --hard origin/develop

# Or create new branch and start over
git checkout -b feature/lms-enhancement-v2
```

Every subagent should commit frequently so you can see exactly what changed.

---

## FINAL CHECKLIST BEFORE DEPLOYMENT

- [ ] All tests passing (unit + integration + E2E)
- [ ] Lighthouse score > 90
- [ ] Accessibility audit 95%+
- [ ] No TypeScript errors
- [ ] No console warnings (except intentional)
- [ ] No console.log in production code
- [ ] Database migration tested
- [ ] API endpoints all working
- [ ] Components responsive on mobile
- [ ] Jitsi integration working
- [ ] Socket.io real-time working
- [ ] Error handling complete
- [ ] Authorization checks on restricted routes
- [ ] Logging for audit trail
- [ ] Code reviewed for security
- [ ] Documentation complete
- [ ] CHANGELOG.log updated
- [ ] Ready to merge to develop
- [ ] Ready to deploy to staging
- [ ] Ready to deploy to production

---

## SUCCESS METRICS

After deployment, you should see:

**Technical:**
- ✅ 0 runtime errors in first week
- ✅ 99% uptime on live classes
- ✅ < 500ms chat latency
- ✅ 85%+ test coverage
- ✅ 95%+ accessibility compliance

**User Experience:**
- ✅ Students see better learning materials
- ✅ Classes run smoothly
- ✅ Presentations look professional
- ✅ Real-time features work instantly
- ✅ Mobile experience smooth

**Business:**
- ✅ No regressions in existing features
- ✅ Easy to add more features after
- ✅ Cost = $0 (free stack)
- ✅ Data privacy maintained
- ✅ Zero vendor lock-in

---

## READY TO BUILD?

Everything is specified and ready:

1. ✅ Database schema documented
2. ✅ API routes specified with examples
3. ✅ Components designed
4. ✅ Integration points clear
5. ✅ Testing strategy defined
6. ✅ Deployment plan ready
7. ✅ Success metrics defined

**Estimated time to complete:**
- **With serial execution:** 10-12 weeks
- **With parallel subagents:** 15-25 hours wall-clock time
- **Total effort:** 68-96 hours development

**You're ready to launch the next generation of Code Queens Hub LMS!** 🚀

---

## QUESTIONS FOR YOUR TEAM

Before starting, confirm:

1. **Infrastructure:**
   - Will self-host Jitsi or use meet.jitsi.org?
   - Storage for recordings ready?
   - CDN configured or direct serving?

2. **Priority:**
   - Do all three features at once or phased?
   - Any existing migrations needed?
   - Backward compatibility required?

3. **Resources:**
   - How many subagents can run in parallel?
   - Any constraints on deployment windows?
   - Who reviews code before merge?

4. **Timeline:**
   - Hard deadline or flexible?
   - Can deploy to staging first for testing?
   - Need phased rollout or big bang?

---

**This prompt is your blueprint. Hand it to Claude Code and watch it orchestrate the team.** 🎯

**Timeline:** 15-25 hours to production  
**Cost:** $0 (everything free/open-source)  
**Quality:** Production-ready from day one  
**Scalability:** Ready for 1000+ students  

Let's build the future of Code Queens Hub! 💪
