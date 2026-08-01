# How to Use the Master Prompt with Claude Code
## Quick Start Guide

**Time to understand this:** 5 minutes  
**Time to execute:** 15-25 hours (wall-clock)  
**Result:** Complete LMS upgrade to production

---

## WHAT YOU'LL DO

Copy the master prompt below and paste it into Claude Code. Claude will:

1. ✅ Read all your reference documents automatically
2. ✅ Create 7 parallel subagents for different components
3. ✅ Coordinate their work to build everything in parallel
4. ✅ Handle integration and testing
5. ✅ Deliver production-ready code

---

## THE COMPLETE PROMPT TO GIVE CLAUDE CODE

```markdown
You are orchestrating the complete enhancement of the Code Queens Hub LMS. 
Your task is to implement THREE major features in parallel using subagents:

1. LEARNING ENHANCEMENTS (enhanced content, samples, visualizations)
2. LIVE CLASSES (video conferencing, chat, attendance, recording)
3. PRESENTATIONS (slide builder, live presentation, export)

Reference these files from the /lms repository:
- LMS_ENHANCEMENT_STRATEGY.md
- TECHNICAL_SPECIFICATION.md
- LIVE_CLASSES_AND_PRESENTATIONS_STRATEGY.md
- LIVE_CLASSES_PRESENTATIONS_TECHNICAL_SPEC.md
- CLAUDE_CODE_MASTER_PROMPT.md

ORCHESTRATION STRATEGY:
Spin up 7 parallel subagents to work simultaneously:

1. DATABASE ARCHITECT (8-12 hours)
   - Create all migrations and Drizzle ORM schemas
   - Run migration to verify
   - Generate TypeScript types
   Reference: TECHNICAL_SPECIFICATION.md Part 1

2. BACKEND API DEVELOPER (12-16 hours)
   - Build 65+ API routes for all features
   - Implement validation and auth
   - Write unit tests for core logic
   Reference: TECHNICAL_SPECIFICATION.md Part 2

3. FRONTEND COMPONENT ENGINEER (16-20 hours)
   - Build 50+ React components
   - Style with Tailwind (responsive)
   - Ensure accessibility (WCAG 2.1 AA)
   Reference: TECHNICAL_SPECIFICATION.md Part 3

4. INTEGRATION SPECIALIST (8-12 hours)
   - Integrate Jitsi Meet (video conferencing)
   - Integrate Reveal.js (presentations)
   - Wire up Socket.io for WebSocket
   Reference: LIVE_CLASSES_PRESENTATIONS_TECHNICAL_SPEC.md Part 4

5. REAL-TIME SYSTEMS ENGINEER (8-12 hours)
   - Build WebSocket server for chat
   - Implement Q&A system
   - Set up email notifications
   Reference: LIVE_CLASSES_PRESENTATIONS_TECHNICAL_SPEC.md Part 5

6. QA & TESTING SPECIALIST (12-16 hours)
   - Write unit tests (Jest + Supertest)
   - Write integration tests
   - Write E2E tests (Playwright)
   - Aim for 85%+ coverage
   Reference: TECHNICAL_SPECIFICATION.md Part 5

7. DOCUMENTATION & DEPLOYMENT (4-8 hours)
   - Document all code with JSDoc
   - Update CHANGELOG.log
   - Prepare deployment guide
   - Verify everything is mergeable
   Reference: CLAUDE_CODE_MASTER_PROMPT.md PHASE 4

DEPENDENCIES & TIMING:
- Subagent 1 (Database) MUST complete first
- Subagent 2 (API) can start once 1 is done
- Subagents 3 & 4 (Components & Integration) can start after 2
- Subagent 5 (Real-time) starts after 4
- Subagent 6 (Testing) starts testing as components appear
- Subagent 7 (Documentation) wraps everything

EXPECTATIONS:
✓ Each subagent works independently on their parts
✓ All pull from the same git feature branch
✓ Frequent commits with clear messages
✓ Tests written as code is developed
✓ No console.log in production code
✓ All TypeScript strict mode
✓ Accessibility tested
✓ Mobile responsive
✓ Lighthouse score > 90

CRITICAL PATHS:
Before starting:
1. Create feature branch: git checkout -b feature/lms-complete-enhancement
2. Read CLAUDE_CODE_MASTER_PROMPT.md thoroughly
3. Understand the 7 subagent briefs
4. Start Subagent 1 (Database) first - everything blocks on this

After each subagent completes:
1. Run tests: npm run test
2. Check types: npm run typecheck
3. Check linting: npm run lint
4. Update CHANGELOG.log
5. Commit with clear message
6. Ready for next dependent subagent

Final checklist before merge:
- [ ] All tests passing
- [ ] Lighthouse > 90
- [ ] Accessibility > 95
- [ ] No TypeScript errors
- [ ] No console warnings
- [ ] Database migration tested
- [ ] API endpoints working
- [ ] Components responsive
- [ ] Real-time latency < 500ms
- [ ] Code documented
- [ ] CHANGELOG.log updated
- [ ] Ready for production

ESTIMATED TIMELINE:
- Parallel execution: 15-25 hours wall-clock time
- Total development effort: 68-96 hours
- Can go to production immediately after

QUESTIONS TO ANSWER FIRST:
1. Will you self-host Jitsi or use meet.jitsi.org?
2. How many subagents can work in parallel?
3. Any hard deadline or flexible?
4. Need phased rollout or deploy everything at once?

START NOW:
1. Create the feature branch
2. Begin with Subagent 1 (Database Architect)
3. Follow the orchestration workflow
4. Reference the detailed briefs for each subagent
5. Run tests constantly
6. Commit frequently
7. Merge when all subagents complete

You have everything you need. Build the future of Code Queens Hub LMS! 🚀
```

---

## STEP-BY-STEP EXECUTION

### Step 1: Prepare Your Repo (5 minutes)

```bash
# Go to your LMS directory
cd C:\Users\Hp\My Github Projects\lms

# Create feature branch
git checkout -b feature/lms-complete-enhancement

# Verify branch created
git branch -v
```

### Step 2: Open Claude Code

Open Claude Code and run:

```bash
claude code /path/to/your/lms
```

### Step 3: Give Claude Code the Master Prompt

Copy the prompt from above and paste it into Claude Code. You can say:

```
Read CLAUDE_CODE_MASTER_PROMPT.md from the repository and execute 
the orchestration strategy with 7 parallel subagents as specified. 
Start with database architect. Reference all the spec documents 
in your decision-making.
```

### Step 4: Monitor Progress

Claude Code will:
- Spin up subagents automatically
- Coordinate their work
- Show you progress on each subagent
- Ask you questions if needed
- Merge code frequently

### Step 5: Review & Deploy

When complete (15-25 hours later):
- All code will be on your feature branch
- Everything tested and documented
- Ready to create pull request
- Ready to deploy to production

---

## WHAT THE MASTER PROMPT DOES

The prompt tells Claude Code to:

1. **Read all specifications** (automatic)
   - Already in your repo
   - Claude understands the architecture
   - Knows exactly what to build

2. **Create 7 subagents** (parallel work)
   - Each specializes in one area
   - Work simultaneously
   - Coordinate dependencies
   - Share same git branch

3. **Build systematically**
   - Database first (foundation)
   - API layer next
   - Components after
   - Integration and testing throughout
   - Documentation as final layer

4. **Ensure quality**
   - Tests written as code develops
   - TypeScript strict mode
   - Accessibility verified
   - Performance benchmarked
   - Security reviewed

5. **Deliver production-ready code**
   - All documented
   - Fully tested
   - Mergeable immediately
   - Deployable to production
   - Zero technical debt

---

## TIMELINE BREAKDOWN

With parallel subagents:

```
Hour 0-2:    Subagent 1 (Database) 
             └─ Creates all tables, migrations, indexes

Hour 2-8:    Subagent 2 (API) starts
             └─ Builds all routes while 1 verifies schema

Hour 4-12:   Subagent 3 (Components) starts
             └─ Builds React UI while 2 writes routes

Hour 6-14:   Subagent 4 (Integration) starts
             └─ Wires up Jitsi, Reveal.js, Socket.io

Hour 8-16:   Subagent 5 (Real-time) starts
             └─ Builds WebSocket server

Hour 8-18:   Subagent 6 (Testing) starts testing
             └─ Unit + Integration + E2E tests

Hour 18-24:  Subagent 7 (Documentation) wraps
             └─ Code docs + deployment guide

Hour 24-25:  Final integration & QA
             └─ Everything merged, verified, ready

WALL-CLOCK: 15-25 hours
TOTAL EFFORT: 68-96 developer hours
(Much faster than the 10-12 weeks with serial work!)
```

---

## IF SOMETHING GOES WRONG

Claude Code can handle issues:

**Problem: Subagent gets stuck**
- Solution: Ask Claude Code to have that subagent "start over on [task]"

**Problem: Merge conflict**
- Solution: Claude Code resolves it automatically

**Problem: Test fails**
- Solution: Claude Code debugs and fixes the code

**Problem: TypeScript errors**
- Solution: Claude Code fixes types

**Problem: Need to rollback**
- Solution: `git reset --hard origin/develop` (back to safe state)

---

## CUSTOMIZATION OPTIONS

If you want to modify the approach:

**Option 1: Sequential instead of Parallel**
- Just ask Claude Code to do one subagent at a time
- Timeline becomes 10-12 weeks instead of 15-25 hours
- Less resource-intensive but slower

**Option 2: Skip a Feature**
- Just ask to skip Presentations (or Live Classes, or Learning)
- Timeline reduces accordingly
- Still parallel for remaining features

**Option 3: Phased Rollout**
- Ask Claude Code to build in phases:
  - Phase 1: Learning enhancements only
  - Phase 2: Live classes after Phase 1 tested
  - Phase 3: Presentations after Phase 2 tested
- Reduces risk, extends timeline

**Option 4: Self-Hosted Jitsi**
- Tell Claude Code which Jitsi URL to use
- Uses that instead of meet.jitsi.org
- Everything else stays same

---

## MONITORING DURING EXECUTION

You should see:

**Every 30 minutes:**
- New commits with clear messages
- Test results showing progress
- Component previews available
- API endpoints documented

**Every 2 hours:**
- Subagent completes their section
- Code review happens
- Integration tests run
- Merge to main branch

**Every 6 hours:**
- Checkpoint review
- What's done vs remaining
- Any blockers identified
- Course correction if needed

**Every 12 hours:**
- Major features operational
- Subagents passing off
- Testing in progress
- Documentation building

---

## SUCCESS INDICATORS

You'll know it's working when you see:

✅ **Git commits** appearing frequently (every 15-30 min)  
✅ **Test results** showing green (most passing)  
✅ **TypeScript** no errors  
✅ **Database** tables created and accessible  
✅ **API routes** documented and callable  
✅ **Components** rendering without errors  
✅ **E2E tests** running successfully  
✅ **Documentation** being written  

---

## WHAT TO HAVE READY

Before starting, prepare:

1. **Git credentials** (if pushing to remote)
2. **Database connection string** (for migrations)
3. **Environment variables** (.env file)
4. **Node.js and npm** installed
5. **Enough disk space** (at least 5GB free)
6. **Coffee/energy drinks** (optional but recommended 😄)

---

## AFTER COMPLETION

Once Claude Code finishes (15-25 hours):

1. **Review the code** (30 minutes)
   - Read through changes
   - Check test coverage
   - Verify documentation

2. **Run locally** (15 minutes)
   - `npm install`
   - `npm run db:migrate`
   - `npm run dev`
   - Test features manually

3. **Deploy to staging** (30 minutes)
   - Run full test suite
   - Check Lighthouse scores
   - Verify accessibility
   - Get stakeholder approval

4. **Deploy to production** (15 minutes)
   - Run final checks
   - Deploy
   - Monitor for errors
   - Celebrate! 🎉

---

## TOTAL TIME INVESTMENT

```
Your time:
├─ Reading specs: 2 hours (done - you have them)
├─ Setup & kickoff: 1 hour
├─ Monitoring during build: 2 hours (can be async)
├─ Code review: 1 hour
├─ Deployment: 1 hour
└─ Total YOUR time: ~5-7 hours

Claude Code's time:
├─ Database: 8-12 hours
├─ API: 12-16 hours
├─ Components: 16-20 hours
├─ Integration: 8-12 hours
├─ Real-time: 8-12 hours
├─ Testing: 12-16 hours
├─ Documentation: 4-8 hours
└─ Total effort: 68-96 hours

PARALLEL EXECUTION: 15-25 hours wall-clock
```

---

## THE BOTTOM LINE

✨ **What you get:**
- Complete LMS enhancement
- Learning enhancements (visualizations, samples, practice)
- Live classes (video, chat, attendance, recording)
- Presentations (builder, presentation, export)
- 85%+ test coverage
- Production-ready code
- Complete documentation

💰 **What it costs:**
- $0 (everything free/open-source)
- Your time: ~5-7 hours
- Claude Code time: 68-96 hours

⏰ **How long:**
- 15-25 hours wall-clock (parallel)
- vs 10-12 weeks if done serially

🚀 **Ready to start?**
Copy the master prompt above and paste it into Claude Code. That's it!

---

## QUESTIONS?

If you have questions during execution:
- Ask Claude Code directly (it'll understand context)
- Reference the spec documents (detailed and comprehensive)
- Check CHANGELOG.log for what's been done
- Review git log for commit details

---

**You're ready! Launch the enhancement and watch your LMS transform.** 🎯

Time to build: 15-25 hours  
Quality: Production-ready  
Cost: $0  
Result: Amazing LMS  

Let's go! 🚀
