# Live Classes, Sessions & Presentations Strategy
## Code Queens Hub LMS — Extended Learning Features

**Document Version:** 1.0  
**Date:** August 1, 2026  
**Status:** Ready for Implementation  
**Cost:** Completely Free & Open-Source  

---

## TABLE OF CONTENTS

1. [Executive Overview](#executive-overview)
2. [Live Classes & Sessions System](#live-classes--sessions-system)
3. [Presentations Module](#presentations-module)
4. [Technology Stack (Free Options)](#technology-stack-free-options)
5. [Database Schema](#database-schema)
6. [Architecture & Integration](#architecture--integration)
7. [Implementation Roadmap](#implementation-roadmap)
8. [API Specifications](#api-specifications)
9. [Component Specifications](#component-specifications)
10. [Testing & Deployment](#testing--deployment)

---

## EXECUTIVE OVERVIEW

### What You're Adding

**Two Major Features:**

1. **Live Classes & Sessions**
   - Schedule and host live classes
   - Real-time video/audio conferencing
   - Screen sharing
   - Chat and Q&A
   - Attendance tracking
   - Recording & playback
   - Totally free using open-source solutions

2. **Presentations Module**
   - Create presentations within LMS
   - Instructor creates slide decks
   - Students can create presentations for assignments
   - Present live during classes
   - Export/download presentations
   - Presentation feedback and grading

### Free Technology Stack

| Component | Solution | Cost | Why |
|-----------|----------|------|-----|
| **Video Conferencing** | Jitsi Meet (self-hosted) | Free | Open-source, no licensing |
| **Screen Sharing** | Jitsi built-in | Free | Included in Jitsi |
| **Chat** | Custom WebSocket + PostgreSQL | Free | Built into app |
| **Recording** | Jitsi (optional) + custom storage | Free | S3 alternative or local storage |
| **Presentations** | Reveal.js + custom builder | Free | Open-source framework |
| **File Storage** | MinIO or local filesystem | Free | Self-hosted or filesystem |
| **Scheduling** | PostgreSQL + React Calendar | Free | Custom implementation |

**Total Cost:** $0/month (except your own server hosting)

---

## LIVE CLASSES & SESSIONS SYSTEM

### 2.1 Feature Overview

#### For Instructors

```
Dashboard
├─ Schedule Class
│  ├─ Select date/time
│  ├─ Add to week/lecture
│  ├─ Set duration
│  └─ Add description
├─ Manage Classes
│  ├─ View upcoming
│  ├─ Edit details
│  ├─ View attendance
│  └─ Access recordings
├─ Class Interface (Live)
│  ├─ Video/Audio controls
│  ├─ Screen sharing
│  ├─ Chat moderation
│  ├─ Participant list
│  ├─ Q&A management
│  ├─ Recording indicator
│  └─ Presentation controls
└─ Analytics
   ├─ Attendance report
   ├─ Engagement metrics
   └─ Recording statistics
```

#### For Students

```
Dashboard
├─ View Upcoming Classes
│  ├─ Week number
│  ├─ Date/time
│  ├─ Duration
│  └─ Topic
├─ Join Class (Live)
│  ├─ Video/Audio controls
│  ├─ Chat
│  ├─ Ask question
│  ├─ View screen share
│  └─ View presentation
└─ Playback
   ├─ Recordings list
   ├─ Video player
   ├─ Chat history
   └─ Transcript search
```

### 2.2 Architecture Design

#### Live Class Session Flow

```
1. Instructor Creates Class
   └─ POST /api/classes
      └─ Creates DB record
         └─ Returns join URL + code

2. Class Time Approaches
   └─ Email notification to students
   └─ "Join Class" button appears

3. Instructor Starts Session
   └─ POST /api/classes/[id]/start
      └─ Initializes Jitsi room
      └─ Updates status to ACTIVE
      └─ Starts optional recording

4. Students Join
   └─ GET /api/classes/[id]/join
      └─ Validates enrollment
      └─ Returns Jitsi config
      └─ Records attendance
      └─ Connects via iframe

5. Live Session
   ├─ Video/audio stream via Jitsi
   ├─ Chat via WebSocket
   ├─ Q&A via custom system
   ├─ Screen share via Jitsi
   └─ Instructor shares presentation

6. Class Ends
   └─ POST /api/classes/[id]/end
      └─ Finalizes recording (if enabled)
      └─ Marks class as completed
      └─ Makes recording available

7. Playback Available
   └─ Students can watch recording
   └─ Searchable by transcript
   └─ Comments/notes possible
```

### 2.3 Technology Choices Explained

#### Why Jitsi Meet?

```
✅ Advantages:
   - 100% open-source (AGPL 3.0)
   - Self-hostable (you own the data)
   - No licensing costs
   - Great UX out of the box
   - Built-in screen sharing
   - Recording capability
   - Works on desktop + mobile
   - Can be embedded in iframes
   - Excellent documentation

❌ Alternatives Rejected:
   - Zoom: Requires paid tiers for features
   - Google Meet: Requires Google Workspace
   - Microsoft Teams: Requires Office 365
   - BBB (BigBlueButton): More complex to host
   - Whereby: Paid service
```

#### Self-Hosting Jitsi

**Two Options:**

**Option A: Recommended (Easiest)**
```
Use: jitsi.meet.org
- Free public instance
- No setup required
- Can set room names
- Embedded via iframe
- Custom branding available
- Good for testing

Limitation: Public, rooms aren't private
Solution: Use hard-to-guess room names + password
Or: Self-host your own instance
```

**Option B: Advanced (Best Privacy)**
```
Deploy: Self-hosted Jitsi on your server
Resources: ~2GB RAM, ~20GB storage
Docker: Official Docker image available
Cost: Only server infrastructure
Benefits:
  - Complete privacy
  - Custom branding
  - Full control
  - Recordings stored locally
```

**For MVP:** Use jitsi.org with password protection  
**For Production:** Self-host Jitsi on your server

### 2.4 Live Class Database Schema

#### Table: `live_classes`

```sql
CREATE TABLE live_classes (
  id SERIAL PRIMARY KEY,
  
  -- Relationship
  week_id INTEGER REFERENCES weeks(id) ON DELETE CASCADE,
  lecture_id INTEGER REFERENCES lectures(id) ON DELETE SET NULL,
  instructor_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  
  -- Basic Info
  title VARCHAR(255) NOT NULL,
  description TEXT,
  
  -- Scheduling
  scheduled_at TIMESTAMP WITH TIME ZONE NOT NULL,
  duration_minutes INTEGER NOT NULL DEFAULT 60,
  
  -- Status
  status ENUM('scheduled', 'active', 'ended', 'cancelled') 
    DEFAULT 'scheduled',
  
  -- Jitsi Configuration
  jitsi_room_name VARCHAR(255),          -- Unique room identifier
  jitsi_password VARCHAR(255),           -- Optional room password
  enable_recording BOOLEAN DEFAULT TRUE,
  
  -- Recording
  recording_url VARCHAR(500),            -- URL to recorded video
  recording_status ENUM(
    'not_started', 
    'recording', 
    'processing', 
    'available', 
    'failed'
  ) DEFAULT 'not_started',
  
  -- Metadata
  max_participants INTEGER,              -- Optional limit
  allow_chat BOOLEAN DEFAULT TRUE,
  allow_qa BOOLEAN DEFAULT TRUE,
  allow_screen_share BOOLEAN DEFAULT TRUE,
  
  -- Engagement
  attendance_count INTEGER DEFAULT 0,
  engagement_score DECIMAL(5,2),        -- Calculated after class
  
  -- Timestamps
  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  started_at TIMESTAMP WITH TIME ZONE,
  ended_at TIMESTAMP WITH TIME ZONE,
  
  -- Archive
  is_archived BOOLEAN DEFAULT FALSE
);

CREATE INDEX idx_live_classes_week_id ON live_classes(week_id);
CREATE INDEX idx_live_classes_instructor_id ON live_classes(instructor_id);
CREATE INDEX idx_live_classes_status ON live_classes(status);
CREATE INDEX idx_live_classes_scheduled_at ON live_classes(scheduled_at);
```

---

#### Table: `class_attendance`

```sql
CREATE TABLE class_attendance (
  id SERIAL PRIMARY KEY,
  
  class_id INTEGER NOT NULL REFERENCES live_classes(id) ON DELETE CASCADE,
  student_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  
  -- Attendance Tracking
  joined_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
  left_at TIMESTAMP WITH TIME ZONE,
  time_present_minutes INTEGER,
  
  -- Engagement
  messages_sent INTEGER DEFAULT 0,
  questions_asked INTEGER DEFAULT 0,
  screen_share_count INTEGER DEFAULT 0,
  
  -- Status
  marked_present BOOLEAN DEFAULT TRUE,
  participation_score INTEGER DEFAULT 0,  -- 0-100
  
  UNIQUE(class_id, student_id)
);

CREATE INDEX idx_class_attendance_class_id ON class_attendance(class_id);
CREATE INDEX idx_class_attendance_student_id ON class_attendance(student_id);
```

---

#### Table: `class_chat`

```sql
CREATE TABLE class_chat (
  id SERIAL PRIMARY KEY,
  
  class_id INTEGER NOT NULL REFERENCES live_classes(id) ON DELETE CASCADE,
  sender_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  
  -- Message
  message TEXT NOT NULL,
  message_type ENUM('text', 'system', 'poll', 'announcement') 
    DEFAULT 'text',
  
  -- Moderation
  is_pinned BOOLEAN DEFAULT FALSE,
  is_deleted BOOLEAN DEFAULT FALSE,
  
  -- Threading (for Q&A)
  parent_message_id INTEGER REFERENCES class_chat(id),
  
  -- Timestamps
  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  edited_at TIMESTAMP WITH TIME ZONE,
  
  UNIQUE(class_id, id)
);

CREATE INDEX idx_class_chat_class_id ON class_chat(class_id);
CREATE INDEX idx_class_chat_sender_id ON class_chat(sender_id);
```

---

#### Table: `class_qa`

```sql
CREATE TABLE class_qa (
  id SERIAL PRIMARY KEY,
  
  class_id INTEGER NOT NULL REFERENCES live_classes(id) ON DELETE CASCADE,
  student_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  instructor_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  
  -- Question
  question TEXT NOT NULL,
  is_answered BOOLEAN DEFAULT FALSE,
  
  -- Answer
  answer TEXT,
  answered_at TIMESTAMP WITH TIME ZONE,
  
  -- Engagement
  upvotes INTEGER DEFAULT 0,
  is_pinned BOOLEAN DEFAULT FALSE,
  
  -- Timestamps
  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_class_qa_class_id ON class_qa(class_id);
CREATE INDEX idx_class_qa_student_id ON class_qa(student_id);
```

---

#### Table: `class_recordings`

```sql
CREATE TABLE class_recordings (
  id SERIAL PRIMARY KEY,
  
  class_id INTEGER NOT NULL UNIQUE REFERENCES live_classes(id),
  
  -- Recording Details
  file_name VARCHAR(500),
  file_path VARCHAR(500),                -- Local or S3 path
  file_size_mb INTEGER,
  duration_seconds INTEGER,
  
  -- Metadata
  recording_started_at TIMESTAMP WITH TIME ZONE,
  recording_ended_at TIMESTAMP WITH TIME ZONE,
  transcription JSONB,                  -- Optional: speech-to-text
  
  -- Access
  is_public BOOLEAN DEFAULT FALSE,
  accessible_by ENUM('students', 'instructors', 'all') 
    DEFAULT 'students',
  
  -- Playback
  hls_url VARCHAR(500),                 -- HTTP Live Streaming URL
  dash_url VARCHAR(500),                -- DASH URL (optional)
  
  -- Timestamps
  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  deleted_at TIMESTAMP WITH TIME ZONE
);

CREATE INDEX idx_class_recordings_class_id ON class_recordings(class_id);
```

---

### 2.5 Live Class Features Breakdown

#### Class Scheduling

```typescript
interface ScheduleClassRequest {
  title: string;              // "Week 1: HTML Foundations"
  description: string;        // What will be covered
  week_id: number;           // Which week it belongs to
  lecture_id?: number;       // Optional: link to lecture
  scheduled_at: Date;        // When class happens
  duration_minutes: number;  // 60, 90, 120, etc.
  max_participants?: number; // Limit (optional)
  enable_recording: boolean; // Record the session?
  allow_chat: boolean;       // Allow student chat?
  allow_qa: boolean;         // Allow Q&A?
  allow_screen_share: boolean;
}
```

#### Live Session Features

**For Instructor:**
```
1. Start/Stop Recording
   - Toggle recording on/off
   - Recording indicator visible to all
   
2. Screen Sharing
   - Share entire screen
   - Share specific application
   - Pause sharing
   
3. Presentation Mode
   - Show presentation (see Presentations section)
   - Advance slides
   - Show presenter notes
   
4. Participant Management
   - View who's present
   - Mute/unmute participants
   - Remove disruptive users
   - See engagement metrics real-time
   
5. Chat Moderation
   - See all messages
   - Pin important messages
   - Delete inappropriate content
   - Highlight announcements
   
6. Q&A Management
   - See incoming questions
   - Answer questions in real-time
   - Pin answered questions
   - Mark questions as "will answer later"
   
7. Attendance
   - Automatic tracking
   - Manual mark-as-present
   - Export attendance report
```

**For Student:**
```
1. Join Class
   - One-click join (if authenticated)
   - Guest join with name (optional)
   - Video/audio controls
   - Muted by default
   
2. Participate
   - Send chat messages
   - Ask questions
   - Share screen (if allowed)
   - React with emojis
   
3. View Content
   - Instructor's video
   - Screen share
   - Presentation slides
   - Chat history
   
4. Watch Recording (After Class)
   - Full video playback
   - Searchable transcript
   - Timeline comments
   - Download (if allowed)
```

---

## PRESENTATIONS MODULE

### 3.1 Feature Overview

#### What is a Presentation?

A presentation is a **slide-based document** that:
- Can be created by instructors OR students
- Can be used in live classes
- Can be presented remotely
- Can be graded (for student presentations)
- Can be exported (PDF, HTML, PowerPoint)
- Integrates with LMS

#### Presentation Types

```
1. Instructor Presentations
   - Created by instructors
   - Used to teach content
   - Presented in live classes
   - Can be embedded in lectures
   - Archived for reference

2. Student Presentations
   - Created by students
   - Assignment: "Create presentation on topic X"
   - Presented live (graded)
   - Or submitted recorded (asynchronous)
   - Graded on content, delivery, design

3. Guest Presentations
   - External presenter shares deck
   - Uploaded and presented live
   - Recorded for students
```

### 3.2 Presentation Creation Interface

#### What Students See (Creation)

```
┌─ PRESENTATION BUILDER ─────────────────────────────┐
│                                                     │
│  Title: "My Web Design Portfolio"                  │
│  Description: An overview of my web projects       │
│  Status: Draft                                      │
│  Theme: Default (select other)                     │
│                                                     │
│  ┌─ SLIDE EDITOR (Left) ──────────────┐            │
│  │                                     │            │
│  │  Slide 1 [Thumbnail]                │            │
│  │  Slide 2 [Thumbnail]                │            │
│  │  + Add Slide                        │            │
│  │                                     │            │
│  └─────────────────────────────────────┘            │
│                                                     │
│  ┌─ SLIDE CONTENT (Right) ────────────┐            │
│  │                                     │            │
│  │  [Title]        [+] Text           │            │
│  │  [Add Subtitle] [+] Image          │            │
│  │                 [+] Code Block     │            │
│  │                 [+] Embed Video    │            │
│  │                 [+] List           │            │
│  │                                     │            │
│  └─────────────────────────────────────┘            │
│                                                     │
│  [Save Draft] [Preview] [Publish] [Share]         │
│                                                     │
└─────────────────────────────────────────────────────┘
```

#### Slide Types Available

```
1. Title Slide
   - Main title
   - Subtitle
   - Author/date

2. Content Slide
   - Title + body text
   - Bullet points
   - Numbered lists

3. Two-Column Slide
   - Left content
   - Right content
   - Side-by-side layout

4. Image Slide
   - Large image
   - Caption
   - Optional text

5. Code Slide
   - Code block
   - Language selection
   - Syntax highlighting
   - Line numbers

6. Quote Slide
   - Large quote text
   - Author attribution

7. Blank Slide
   - Custom layout

8. Section Slide
   - Section divider
   - Large text
   - Transition point

9. Comparison Slide
   - Before/after
   - Side-by-side comparison

10. Chart/Graph Slide
    - Embed chart
    - Data visualization
```

### 3.3 Presentation Technology

#### Why Reveal.js?

```
✅ Advantages:
   - Open-source (MIT license)
   - Web-based (works in browser)
   - Beautiful default themes
   - Markdown support
   - Speaker notes
   - PDF export
   - Easy to embed
   - Great documentation
   - Mobile responsive
   - Touch/keyboard navigation
   - Custom CSS styling
   - No special software needed

Custom Extension:
   - Build React wrapper
   - Custom slide builder UI
   - Database integration
   - Student submission system
```

#### Architecture

```
Database
  ↓ (Store presentation JSON)
  ↓
API Routes
  ├─ /api/presentations (CRUD)
  ├─ /api/presentations/[id]/slides
  ├─ /api/presentations/[id]/export
  └─ /api/presentations/[id]/present
  ↓
React Components
  ├─ PresentationBuilder (edit)
  ├─ SlideEditor (slide level)
  └─ PresentationViewer (view/present)
  ↓
Reveal.js
  ├─ Render slides
  ├─ Handle navigation
  ├─ Fullscreen mode
  └─ PDF export
```

### 3.4 Presentation Database Schema

#### Table: `presentations`

```sql
CREATE TABLE presentations (
  id SERIAL PRIMARY KEY,
  
  -- Ownership
  creator_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  assignment_id INTEGER REFERENCES assignments(id) ON DELETE SET NULL,
  
  -- Content
  title VARCHAR(255) NOT NULL,
  description TEXT,
  
  -- Metadata
  theme VARCHAR(50) DEFAULT 'default',   -- 'default', 'dark', 'minimal', etc.
  is_published BOOLEAN DEFAULT FALSE,
  is_template BOOLEAN DEFAULT FALSE,     -- Can be reused
  
  -- Storage
  slides_json JSONB NOT NULL,            -- Full presentation data
  -- Format: {
  --   version: 1,
  --   slides: [
  --     { type: 'title', title: '', subtitle: '' },
  --     { type: 'content', title: '', body: '' }
  --   ],
  --   metadata: { theme, author, created_at }
  -- }
  
  -- Presentation Mode Settings
  show_speaker_notes BOOLEAN DEFAULT TRUE,
  show_slide_numbers BOOLEAN DEFAULT TRUE,
  allow_export BOOLEAN DEFAULT TRUE,
  
  -- Sharing
  is_public BOOLEAN DEFAULT FALSE,
  shared_with_roles JSONB,              -- ['student', 'instructor']
  
  -- Class Integration
  related_class_id INTEGER REFERENCES live_classes(id),
  
  -- Timestamps
  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  published_at TIMESTAMP WITH TIME ZONE,
  
  -- Statistics
  view_count INTEGER DEFAULT 0,
  presentation_count INTEGER DEFAULT 0  -- Times presented live
);

CREATE INDEX idx_presentations_creator_id ON presentations(creator_id);
CREATE INDEX idx_presentations_assignment_id ON presentations(assignment_id);
CREATE INDEX idx_presentations_is_published ON presentations(is_published);
```

---

#### Table: `presentation_slides`

```sql
CREATE TABLE presentation_slides (
  id SERIAL PRIMARY KEY,
  
  presentation_id INTEGER NOT NULL REFERENCES presentations(id),
  
  -- Slide Position
  slide_number INTEGER NOT NULL,
  
  -- Slide Content
  type VARCHAR(50) NOT NULL,             -- 'title', 'content', 'image', etc.
  title VARCHAR(255),
  body TEXT,
  speaker_notes TEXT,
  
  -- Content by Type
  content_json JSONB,                   -- Type-specific data
  -- Examples:
  -- Code slide: { code: '', language: 'javascript' }
  -- Image slide: { url: '', alt: '', caption: '' }
  -- Chart slide: { type: 'bar', data: [...] }
  
  -- Layout
  layout VARCHAR(50),                    -- 'default', 'two-column', 'centered'
  
  -- Styling
  background_color VARCHAR(7),           -- Hex color
  background_image_url VARCHAR(500),
  text_color VARCHAR(7),
  
  -- Metadata
  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  
  UNIQUE(presentation_id, slide_number)
);

CREATE INDEX idx_presentation_slides_presentation_id 
  ON presentation_slides(presentation_id);
```

---

#### Table: `presentation_submissions`

```sql
CREATE TABLE presentation_submissions (
  id SERIAL PRIMARY KEY,
  
  -- Relationship
  assignment_id INTEGER NOT NULL REFERENCES assignments(id),
  presentation_id INTEGER NOT NULL REFERENCES presentations(id),
  student_id INTEGER NOT NULL REFERENCES users(id),
  
  -- Submission Type
  submission_type ENUM('recorded', 'live', 'document') DEFAULT 'recorded',
  
  -- For Recorded Submissions
  video_url VARCHAR(500),                -- Recording of presentation
  video_duration_seconds INTEGER,
  
  -- For Live Submissions
  presentation_date TIMESTAMP WITH TIME ZONE,  -- When presented
  audience_count INTEGER,                -- How many watched live
  
  -- Grading
  score INTEGER,                         -- 0-100
  feedback TEXT,
  rubric_scores JSONB,                  -- By criteria
  graded_by INTEGER REFERENCES users(id),
  graded_at TIMESTAMP WITH TIME ZONE,
  
  -- Timestamps
  submitted_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  
  status ENUM('submitted', 'under_review', 'graded') DEFAULT 'submitted'
);

CREATE INDEX idx_presentation_submissions_student_id 
  ON presentation_submissions(student_id);
CREATE INDEX idx_presentation_submissions_assignment_id 
  ON presentation_submissions(assignment_id);
```

---

#### Table: `presentation_feedback`

```sql
CREATE TABLE presentation_feedback (
  id SERIAL PRIMARY KEY,
  
  presentation_id INTEGER NOT NULL REFERENCES presentations(id),
  from_user_id INTEGER NOT NULL REFERENCES users(id),
  to_user_id INTEGER NOT NULL REFERENCES users(id),
  
  -- Feedback
  feedback_type ENUM('peer', 'instructor', 'self') DEFAULT 'peer',
  comment TEXT NOT NULL,
  rating INTEGER,                        -- 1-5 stars
  
  -- Specific Feedback
  category VARCHAR(50),                  -- 'content', 'design', 'delivery'
  improvement_suggestions TEXT,
  
  -- Timestamps
  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_presentation_feedback_presentation_id 
  ON presentation_feedback(presentation_id);
```

---

### 3.5 Presentation Features

#### Creation Features

```
1. Slide Management
   - Add/remove/duplicate/reorder slides
   - Copy slides from other presentations
   - Slide templates for quick creation
   
2. Content Editing
   - Rich text editor (heading, bold, italic, etc.)
   - Image upload and insert
   - Embed videos (YouTube, Vimeo)
   - Code blocks with syntax highlighting
   - Math equations (LaTeX)
   - Data tables
   
3. Design
   - Pre-built themes (10+ options)
   - Custom colors and fonts
   - Background images
   - Animations and transitions
   - Speaker notes
   
4. Collaboration (Optional Phase 2)
   - Share draft for feedback
   - Comments on slides
   - Version history
   
5. Preview
   - Full presentation view
   - Slideshow mode
   - Speaker notes view
   - Print preview
```

#### Presentation Mode Features

```
For Presenter:
  ✓ Fullscreen presentation
  ✓ Speaker notes (not visible to audience)
  ✓ Slide navigation (next/prev, jump to)
  ✓ Timer/clock
  ✓ Drawing tools (pen/highlighter)
  ✓ Laser pointer
  ✓ Presentation notes on second screen
  ✓ Slide thumbnails navigation
  
For Audience:
  ✓ See presentation fullscreen
  ✓ Slide numbers
  ✓ Slide navigation (if allowed)
  ✓ Take notes on slides (optional)
  ✓ Q&A interface
```

#### Export Options

```
1. PDF Export
   - Slides only
   - Slides + speaker notes
   - Handout format (2/4/6 slides per page)
   
2. HTML Export
   - Self-contained HTML file
   - Works offline
   - Reveal.js embedded
   
3. PowerPoint Export
   - .pptx format
   - For use in other applications
   
4. Image Export
   - PNG/JPG of each slide
   - For sharing on social media
```

---

## TECHNOLOGY STACK (FREE OPTIONS)

### 4.1 Architecture Overview

```
Frontend Layer
├─ React Components (Next.js)
├─ Presentation Builder (React)
├─ Live Session UI (React)
├─ Chat/Q&A (WebSocket)
└─ Reveal.js Wrapper

Integration Layer
├─ Jitsi Embed (Video conferencing)
├─ WebSocket (Real-time chat)
├─ REST API (Recordings, schedules)
└─ Database (PostgreSQL)

Backend Services
├─ Node.js/Next.js API Routes
├─ PostgreSQL Database
├─ File Storage (Local/MinIO)
├─ WebSocket Server
└─ Background Jobs (node-cron)

External Services (Free)
├─ Jitsi Meet (self-hosted or public)
├─ Reveal.js (open-source library)
└─ Optional: MinIO (self-hosted S3)
```

### 4.2 Detailed Tech Stack

#### Video Conferencing

```
PRIMARY: Jitsi Meet (Self-hosted or Free Cloud)

For MVP (Easy):
  - Use: meet.jitsi.org (public instance)
  - Cost: $0
  - Setup: 5 minutes
  - Limitation: Public rooms
  - Security: Use strong room names + passwords

For Production (Best):
  - Self-host Jitsi on your server
  - Docker: Available official image
  - Cost: Server hosting only
  - Security: Complete privacy
  - Storage: Local recordings
  
Integration with Next.js:
  - Jitsi Web SDK
  - Embed in iframe
  - Control via JavaScript API
  - Custom branding

Implementation:
```typescript
// pages/classes/[id]/join.tsx
import { JitsiMeetExternalAPI } from 'jitsi-meet-external-api';

interface JitsiConfig {
  roomName: string;
  userInfo: {
    displayName: string;
    email: string;
  };
  parentNode: HTMLElement;
  configOverwrite: {
    disableAudioLevels: boolean;
    enableWelcomePage: false;
    disableProfile: false;
  };
  interfaceConfigOverwrite: {
    DISPLAY_WELCOME_BANNER: false;
  };
}

const jitsi = new JitsiMeetExternalAPI(domain, JitsiConfig);

jitsi.addEventListener('videoConferenceJoined', () => {
  // Mark student as present
  // Log to database
});

jitsi.addEventListener('videoConferenceLeft', () => {
  // Record end time
  // Calculate attendance
});
```
---

#### Presentation Framework

```
PRIMARY: Reveal.js

Why Reveal.js:
  ✓ Open-source (MIT license)
  ✓ Pure HTML/CSS/JS
  ✓ No special software needed
  ✓ PDF export built-in
  ✓ Speaker mode with notes
  ✓ Vertical slides support
  ✓ Markdown support
  ✓ Plugin system
  ✓ Touch/keyboard navigation
  ✓ Customizable themes

Custom React Wrapper:

```typescript
// components/presentations/RevealPresentation.tsx

import Reveal from 'reveal.js';
import 'reveal.js/dist/reveal.css';

interface RevealPresentationProps {
  slides: Slide[];
  theme: string;
  isPresenting: boolean;
  onSlideChange?: (slideNumber: number) => void;
}

export const RevealPresentation: React.FC<RevealPresentationProps> = ({
  slides,
  theme,
  isPresenting,
  onSlideChange,
}) => {
  const revealRef = useRef<HTMLDivElement>(null);
  const revealInstance = useRef<Reveal.default>();

  useEffect(() => {
    // Initialize Reveal
    revealInstance.current = new Reveal(revealRef.current, {
      hash: true,
      transition: 'slide',
      controlsTutorial: false,
      controls: !isPresenting,
      progress: true,
    });

    revealInstance.current.initialize();

    revealInstance.current.on('slidechanged', (event) => {
      onSlideChange?.(event.indexh);
    });

    return () => {
      revealInstance.current?.destroy();
    };
  }, []);

  return (
    <div className="reveal">
      <div className="slides" ref={revealRef}>
        {slides.map((slide) => (
          <section key={slide.id}>
            <h1>{slide.title}</h1>
            <p>{slide.content}</p>
          </section>
        ))}
      </div>
    </div>
  );
};
```

File Storage for Presentations:
  - Local filesystem for MVP
  - MinIO (self-hosted S3) for scale
  - Save as JSON + assets folder
```

#### Real-time Chat

```
WebSocket Implementation

Server (Node.js):
  - Socket.io or native WebSocket
  - Listen for messages
  - Broadcast to class
  - Persist to database
  - Handle disconnect

Client (React):
  - Connect on class join
  - Send/receive messages
  - Render chat history
  - Typing indicators
  - Mention system (@username)

Implementation:
```typescript
// utils/classWebSocket.ts
import io from 'socket.io-client';

class ClassWebSocket {
  private socket: Socket;

  connect(classId: number, userId: number) {
    this.socket = io(process.env.NEXT_PUBLIC_WS_URL, {
      auth: { classId, userId },
    });

    this.socket.on('message', (data) => {
      // Handle incoming message
    });
  }

  sendMessage(message: string) {
    this.socket.emit('message', { text: message });
  }

  askQuestion(question: string) {
    this.socket.emit('question', { text: question });
  }

  disconnect() {
    this.socket.disconnect();
  }
}
```

Middleware (Node.js):
```typescript
// pages/api/ws/[...slug].ts
import { WebSocketServer } from 'ws';
import { Server } from 'socket.io';

export const io = new Server(httpServer, {
  cors: { origin: process.env.NEXT_PUBLIC_URL },
});

io.on('connection', (socket) => {
  const { classId, userId } = socket.handshake.auth;

  // Join class room
  socket.join(`class:${classId}`);

  // Handle messages
  socket.on('message', async (data) => {
    // Save to database
    await db.insert(classChat).values({
      class_id: classId,
      sender_id: userId,
      message: data.text,
    });

    // Broadcast to class
    io.to(`class:${classId}`).emit('message', {
      userId,
      text: data.text,
      timestamp: new Date(),
    });
  });

  socket.on('disconnect', () => {
    // Handle disconnect
  });
});
```
---

#### File Storage

```
For Recordings:
  Option 1: Local Filesystem (MVP)
    - Store in /public/recordings or external disk
    - Serve via HTTP
    - Simple, but limited scalability
    - Cost: None
    
  Option 2: MinIO (Production)
    - Self-hosted S3-compatible storage
    - Can be containerized
    - Scalable and reliable
    - Cost: Server infrastructure only

For Presentations:
  Option 1: Database (Recommended)
    - Store as JSON in JSONB column
    - Full-text search support
    - Version history easy
    - Cost: None (already have database)
    
  Option 2: File Storage
    - Save as .json files
    - Version control friendly
    - Easier to backup
    - Cost: Storage space

Implementation:
```typescript
// lib/storage/presentations.ts
interface SavePresentationOptions {
  presentation: Presentation;
  creatorId: number;
}

async function savePresentation(options: SavePresentationOptions) {
  // Option 1: Database (Recommended)
  await db.insert(presentations).values({
    creator_id: options.creatorId,
    title: options.presentation.title,
    slides_json: options.presentation.slides, // JSONB
    // ... other fields
  });

  // Option 2: File Storage
  const filename = `presentations/${options.creatorId}/${Date.now()}.json`;
  await storage.save(filename, JSON.stringify(options.presentation));
}

// For recordings: Use Jitsi recording + custom storage
async function saveRecording(classId: number, file: File) {
  const filename = `recordings/class-${classId}-${Date.now()}.mp4`;
  
  // Local filesystem
  const path = `/public/${filename}`;
  await fs.writeFile(path, await file.arrayBuffer());
  
  // Save reference to database
  await db.insert(classRecordings).values({
    class_id: classId,
    file_path: path,
    file_size_mb: file.size / (1024 * 1024),
    duration_seconds: 0, // Get from Jitsi
  });
}
```
---

#### Background Jobs

```
For Automatic Tasks:
  - Email notifications (class reminders)
  - Recording processing (after capture)
  - Attendance reports (end of week)
  - Session cleanup (mark ended classes)

Solution: node-cron (free)

Implementation:
```typescript
// lib/jobs/scheduler.ts
import cron from 'node-cron';

// Send class reminders 15 minutes before
cron.schedule('*/5 * * * *', async () => {
  const upcomingClasses = await db.query(
    'SELECT * FROM live_classes WHERE scheduled_at < NOW() + INTERVAL 15 minutes AND status = "scheduled"'
  );

  for (const cls of upcomingClasses) {
    const students = await db.query(
      'SELECT * FROM users WHERE cohort_id = ? AND role = "student"',
      [cls.week_id] // Get students in week
    );

    for (const student of students) {
      await sendEmail({
        to: student.email,
        subject: `Class starting in 15 minutes: ${cls.title}`,
        html: `<p>Join here: <a href="/classes/${cls.id}/join">Join Class</a></p>`,
      });
    }
  }
});

// Process recordings after class ends
cron.schedule('*/10 * * * *', async () => {
  const recordingsToProcess = await db.query(
    'SELECT * FROM class_recordings WHERE recording_status = "recording"'
  );

  for (const recording of recordingsToProcess) {
    // Check if Jitsi recording is complete
    const status = await jitsiApi.getRecordingStatus(recording.class_id);
    
    if (status === 'completed') {
      // Move to permanent storage
      // Update database
      // Make available to students
    }
  }
});
```
---

## ARCHITECTURE & INTEGRATION

### 5.1 System Diagram

```
┌─────────────────────────────────────────────────────────────┐
│                     Client (Browser)                        │
│  ┌────────────────┐  ┌──────────────┐  ┌──────────────┐   │
│  │ Class Schedule │  │ Live Session │  │  Presentation│   │
│  │    Calendar    │  │   Interface  │  │   Builder    │   │
│  └────────────────┘  └──────────────┘  └──────────────┘   │
└──────────────┬──────────────────────────┬──────────────────┘
               │                          │
        ┌──────v──────────────────────────v──────┐
        │        Next.js Frontend Routes         │
        │  /classes, /presentations, /live       │
        └──────────┬───────────────┬──────────────┘
                   │               │
        ┌──────────v───┐   ┌───────v────────┐
        │  REST API    │   │   WebSocket    │
        │  Routes      │   │   Server       │
        └──────┬───────┘   └────────┬───────┘
               │                    │
        ┌──────v────────────────────v──────┐
        │      Node.js Backend              │
        │  (Authentication, Business Logic) │
        └──────┬─────────────────────┬──────┘
               │                     │
       ┌───────v────────┐  ┌────────v──────┐
       │   PostgreSQL   │  │   File System  │
       │   Database     │  │   /Recordings  │
       └────────────────┘  └────────────────┘
               │
       ┌───────v────────┐
       │   Jitsi Meet   │ ◄─── Embedded in iframe
       │   (Video API)  │
       └────────────────┘
```

### 5.2 User Flow Integration

#### Before Class
```
Instructor Creates Class
  ↓ (POST /api/classes)
  ↓ DB records class
  ↓ Email sent to students
  ↓
Student Sees in Upcoming Classes
  ↓ (GET /api/classes/my-classes)
  ↓ Notification bell lights up
  ↓ Calendar shows event
  ↓
15 Minutes Before
  ↓ Email reminder sent
  ↓ "Join Class" button highlights
```

#### During Class
```
Instructor Starts Class
  ↓ (POST /api/classes/[id]/start)
  ↓ Jitsi room initialized
  ↓ Recording starts (if enabled)
  ↓ Status → ACTIVE
  ↓
Students Join
  ↓ (GET /api/classes/[id]/join)
  ↓ Jitsi token generated
  ↓ Iframe loaded
  ↓ Attendance marked
  ↓
Live Features
  ├─ Video streaming (Jitsi)
  ├─ Chat (WebSocket)
  ├─ Q&A (WebSocket)
  ├─ Screen share (Jitsi)
  └─ Presentation (Reveal.js)
```

#### After Class
```
Class Ends
  ↓ (POST /api/classes/[id]/end)
  ↓ Recording finalized
  ↓ Status → ENDED
  ↓ Chat archived
  ↓
Recording Available
  ↓ (GET /api/classes/[id]/recording)
  ↓ Students can watch
  ↓ Transcript available
  ↓
Attendance Report
  ↓ Automatically generated
  ↓ Instructor can download
```

---

## IMPLEMENTATION ROADMAP

### Phase 1: Live Classes Foundation (Weeks 1-2)

**Week 1:**
- [ ] Database schema (classes, attendance, chat)
- [ ] API routes: CRUD classes, start/end
- [ ] Jitsi integration setup
- [ ] Simple class scheduling UI
- [ ] Tests for core APIs

**Week 2:**
- [ ] Join class interface
- [ ] Jitsi embedding
- [ ] Attendance tracking
- [ ] Basic chat (WebSocket setup)
- [ ] E2E tests for class flow

### Phase 2: Presentations Foundation (Weeks 2-3)

**Week 2-3:**
- [ ] Database schema (presentations, slides)
- [ ] Reveal.js setup and wrapper
- [ ] Presentation builder basic UI
- [ ] Slide editor (text, title)
- [ ] Save/load functionality
- [ ] Preview mode

### Phase 3: Advanced Live Features (Weeks 3-4)

**Week 3:**
- [ ] Q&A system
- [ ] Chat moderation
- [ ] Screen sharing (via Jitsi)
- [ ] Recording setup
- [ ] Engagement metrics

**Week 4:**
- [ ] Presentation in live class
- [ ] Recording playback
- [ ] Transcript search (optional)
- [ ] Attendance reports

### Phase 4: Advanced Presentations (Weeks 4-5)

**Week 4-5:**
- [ ] Extended slide types (code, image, video)
- [ ] Themes and styling
- [ ] Speaker notes
- [ ] Export options (PDF, HTML, PPTX)
- [ ] Student presentations (assignment type)

### Phase 5: Polish & Testing (Week 5-6)

**Week 5:**
- [ ] UI/UX refinements
- [ ] Mobile responsive design
- [ ] Accessibility audit
- [ ] Performance optimization

**Week 6:**
- [ ] Full E2E testing
- [ ] User acceptance testing
- [ ] Bug fixes
- [ ] Documentation
- [ ] Production deployment

---

## API SPECIFICATIONS

### 6.1 Live Classes Endpoints

#### GET `/api/classes`

**Get all classes for a user**

```typescript
interface Response {
  success: boolean;
  data: {
    upcoming: Array<{
      id: number;
      title: string;
      week_number: number;
      scheduled_at: string; // ISO date
      duration_minutes: number;
      instructor_name: string;
      status: 'scheduled' | 'active' | 'ended';
    }>;
    past: Array<{
      id: number;
      title: string;
      recorded: boolean;
      duration_minutes: number;
      attendance_count: number;
    }>;
  };
}
```

---

#### POST `/api/classes` (Instructor)

**Create a new class**

```typescript
interface Request {
  title: string;
  description: string;
  week_id: number;
  lecture_id?: number;
  scheduled_at: string; // ISO date
  duration_minutes: number;
  enable_recording: boolean;
  allow_chat: boolean;
  allow_qa: boolean;
  max_participants?: number;
}

interface Response {
  success: boolean;
  data: {
    id: number;
    jitsi_room_name: string;
    jitsi_password: string;
    join_url: string;
  };
}
```

---

#### POST `/api/classes/[id]/start` (Instructor)

**Start a class session**

```typescript
interface Response {
  success: boolean;
  data: {
    status: 'active';
    started_at: string;
    recording_enabled: boolean;
    jitsi_url: string;
  };
}
```

---

#### GET `/api/classes/[id]/join` (Student)

**Get join credentials for a class**

```typescript
interface Response {
  success: boolean;
  data: {
    jitsi_config: {
      roomName: string;
      jwt: string;
      serverUrl: string;
    };
    can_join: boolean;
    reason?: string;
  };
}
```

---

#### GET `/api/classes/[id]/recording`

**Get recording for a class**

```typescript
interface Response {
  success: boolean;
  data?: {
    id: number;
    file_url: string;
    duration_seconds: number;
    created_at: string;
    transcript?: string;
  };
  message?: string; // "Recording still processing"
}
```

---

#### GET `/api/classes/[id]/attendance`

**Get attendance report**

```typescript
interface Response {
  success: boolean;
  data: {
    class_id: number;
    attendance: Array<{
      student_id: number;
      student_name: string;
      joined_at: string;
      left_at: string;
      time_present_minutes: number;
      messages_sent: number;
      questions_asked: number;
      participation_score: number;
    }>;
    total_participants: number;
    average_engagement: number;
  };
}
```

---

### 6.2 Presentation Endpoints

#### POST `/api/presentations`

**Create a new presentation**

```typescript
interface Request {
  title: string;
  description?: string;
  assignment_id?: number;
  theme?: string;
}

interface Response {
  success: boolean;
  data: {
    id: number;
    title: string;
    edit_url: string;
    status: 'draft';
  };
}
```

---

#### GET `/api/presentations/[id]`

**Get presentation**

```typescript
interface Response {
  success: boolean;
  data: {
    id: number;
    title: string;
    description: string;
    theme: string;
    slides: Array<{
      id: number;
      slide_number: number;
      type: string;
      title: string;
      body: string;
      content_json: object;
    }>;
    created_at: string;
    updated_at: string;
  };
}
```

---

#### PUT `/api/presentations/[id]/slides/[slideNumber]`

**Update a slide**

```typescript
interface Request {
  type: string;
  title: string;
  body: string;
  speaker_notes?: string;
  content_json?: object;
}

interface Response {
  success: boolean;
  data: {
    id: number;
    updated_at: string;
  };
}
```

---

#### POST `/api/presentations/[id]/export`

**Export presentation**

```typescript
interface Request {
  format: 'pdf' | 'html' | 'pptx' | 'images';
  include_notes?: boolean;
}

interface Response {
  success: boolean;
  data: {
    download_url: string;
    file_name: string;
  };
}
```

---

#### POST `/api/presentations/[id]/present`

**Start presentation mode**

```typescript
interface Request {
  class_id?: number; // If presenting live
}

interface Response {
  success: boolean;
  data: {
    presenter_url: string; // With speaker notes
    audience_url: string;  // Without notes
    is_live: boolean;
  };
}
```

---

#### POST `/api/presentations/submissions` (Student)

**Submit presentation assignment**

```typescript
interface Request {
  assignment_id: number;
  presentation_id: number;
  submission_type: 'recorded' | 'live' | 'document';
  video_url?: string; // For recorded
  presentation_date?: string; // For live
}

interface Response {
  success: boolean;
  data: {
    submission_id: number;
    status: 'submitted';
    submitted_at: string;
  };
}
```

---

## COMPONENT SPECIFICATIONS

### 7.1 Live Classes Components

#### `<ClassScheduler />`

**Purpose:** Schedule a new class (instructor)

```typescript
interface ClassSchedulerProps {
  weeks: Week[];
  onClassCreated: (classId: number) => void;
}

// Features:
// - Date/time picker
// - Duration selector
// - Week selection
// - Title and description
// - Recording toggle
// - Chat/QA/screen share toggles
// - Submit button
```

---

#### `<LiveClassRoom />`

**Purpose:** The live class interface

```typescript
interface LiveClassRoomProps {
  classId: number;
  isInstructor: boolean;
}

// Structure:
// <div className="flex h-screen">
//   <div className="flex-1">
//     <JitsiEmbed roomName={roomName} />
//   </div>
//   <aside className="w-80 bg-gray-50 border-l flex flex-col">
//     <ChatPanel classId={classId} />
//     <QAPanel classId={classId} />
//     <ParticipantsPanel classId={classId} />
//   </aside>
// </div>
```

---

#### `<ChatPanel />`

**Purpose:** Real-time chat during class

```typescript
interface ChatPanelProps {
  classId: number;
  isInstructor?: boolean;
}

// Features:
// - Message list (scrollable)
// - Input field
// - Send button
// - Typing indicators
// - Pin/delete messages (instructor)
// - System messages (user joined, etc.)
```

---

#### `<QAPanel />`

**Purpose:** Q&A during class**

```typescript
interface QAPanelProps {
  classId: number;
  isInstructor?: boolean;
}

// Features:
// - List of questions
// - Ask question form (student)
// - Answer input (instructor)
// - Upvote system
// - Pin answered questions
// - Filter by status (unanswered/answered)
```

---

### 7.2 Presentation Components

#### `<PresentationBuilder />`

**Purpose:** Create/edit presentations

```typescript
interface PresentationBuilderProps {
  presentationId?: number;
  onSave?: (presentation: Presentation) => void;
}

// Two-column layout:
// Left: Slide thumbnails + add slide button
// Right: Slide editor
//   - Title input
//   - Content editor (type-dependent)
//   - Speaker notes
//   - Styling options
```

---

#### `<SlideEditor />`

**Purpose:** Edit individual slide

```typescript
interface SlideEditorProps {
  slide: Slide;
  onUpdate: (slide: Slide) => void;
  onChangeType: (newType: string) => void;
}

// Renders:
// 1. Type selector dropdown
// 2. Common fields (title, speaker notes)
// 3. Type-specific fields
// 4. Preview
```

---

#### `<SlideContentEditor />`

**Purpose:** Edit slide content based on type

```typescript
interface SlideContentEditorProps {
  type: 'title' | 'content' | 'code' | 'image' | 'video';
  content: any;
  onChange: (content: any) => void;
}

// Renders different UI based on type:
// - title: Text input for title + subtitle
// - content: Rich text editor
// - code: Code editor with language selector
// - image: Image upload + alt text
// - video: URL input with embed preview
```

---

#### `<PresentationViewer />`

**Purpose:** View presentation (read-only or present mode)

```typescript
interface PresentationViewerProps {
  presentation: Presentation;
  isPresentingMode?: boolean;
  onSlideChange?: (slideNumber: number) => void;
}

// Integrates Reveal.js
// Shows:
// - Current slide
// - Navigation controls
// - Speaker notes (if presenter)
// - Slide counter
// - Timer
```

---

#### `<PresentationExporter />`

**Purpose:** Export presentation in various formats

```typescript
interface PresentationExporterProps {
  presentation: Presentation;
  onExportComplete?: (url: string) => void;
}

// Features:
// - Format selector (PDF, HTML, PPTX, images)
// - Options (include notes, handout layout)
// - Export button
// - Progress indicator
// - Download link
```

---

## TESTING & DEPLOYMENT

### 8.1 Testing Strategy

#### Unit Tests

```typescript
describe('ClassScheduler', () => {
  it('renders form with all fields', () => {});
  it('validates required fields', () => {});
  it('calls onClassCreated on submit', () => {});
  it('shows loading state during submit', () => {});
});

describe('PresentationBuilder', () => {
  it('renders slide thumbnails', () => {});
  it('adds new slide on button click', () => {});
  it('deletes slide on delete button', () => {});
  it('reorders slides on drag', () => {});
  it('saves presentation on save button', () => {});
});

describe('LiveClassRoom', () => {
  it('loads Jitsi iframe', () => {});
  it('connects WebSocket for chat', () => {});
  it('displays chat messages', () => {});
  it('sends message on submit', () => {});
  it('shows Q&A panel', () => {});
});
```

---

#### E2E Tests

```typescript
describe('Live Class Workflow', () => {
  it('instructor can schedule class', () => {
    cy.visit('/classes/new');
    cy.get('input[name="title"]').type('HTML Basics');
    cy.get('input[name="date"]').type('2026-08-15');
    cy.get('button').contains('Schedule Class').click();
    cy.contains('Class scheduled successfully');
  });

  it('student can join class', () => {
    cy.visit('/classes');
    cy.contains('HTML Basics').click();
    cy.get('button').contains('Join Class').click();
    cy.get('[data-testid="jitsi-iframe"]').should('be.visible');
  });

  it('chat works during class', () => {
    // ... join class first
    cy.get('[data-testid="chat-input"]').type('Great class!');
    cy.get('button').contains('Send').click();
    cy.contains('Great class!').should('be.visible');
  });

  it('instructor can present slides', () => {
    // ... join class as instructor
    cy.get('button').contains('Show Presentation').click();
    cy.get('[data-testid="reveal-presentation"]').should('be.visible');
  });
});

describe('Presentation Workflow', () => {
  it('student can create presentation', () => {
    cy.visit('/presentations/new');
    cy.get('input[name="title"]').type('My Portfolio');
    cy.get('button').contains('Create').click();
    cy.url().should('include', '/presentations/');
  });

  it('student can edit slides', () => {
    cy.visit('/presentations/1/edit');
    cy.get('[data-testid="add-slide"]').click();
    cy.get('input[name="slide-title"]').type('Slide Title');
    cy.get('button').contains('Save').click();
    cy.contains('Slide saved');
  });

  it('student can export presentation', () => {
    cy.visit('/presentations/1');
    cy.get('button').contains('Export').click();
    cy.get('select[name="format"]').select('pdf');
    cy.get('button').contains('Export to PDF').click();
    // Verify download
  });

  it('student can present live', () => {
    cy.visit('/presentations/1');
    cy.get('button').contains('Present').click();
    cy.get('[data-testid="reveal-presenter"]').should('be.visible');
  });
});
```

---

#### Content Validation

```typescript
describe('Data Integrity', () => {
  it('all classes have valid jitsi_room_name', async () => {
    const classes = await db.query('SELECT * FROM live_classes');
    for (const cls of classes) {
      expect(cls.jitsi_room_name).toMatch(/^[a-zA-Z0-9_-]+$/);
    }
  });

  it('all presentation slides have valid types', async () => {
    const slides = await db.query('SELECT * FROM presentation_slides');
    const validTypes = ['title', 'content', 'code', 'image', 'video'];
    for (const slide of slides) {
      expect(validTypes).toContain(slide.type);
    }
  });

  it('attendance records exist for all joined students', async () => {
    const classes = await db.query('SELECT * FROM live_classes WHERE status = "ended"');
    for (const cls of classes) {
      const attendanceCount = await db.query(
        'SELECT COUNT(*) FROM class_attendance WHERE class_id = ?',
        [cls.id]
      );
      expect(attendanceCount[0].count).toBeGreaterThan(0);
    }
  });
});
```

---

### 8.2 Deployment Checklist

**Pre-Deployment:**
- [ ] All unit tests passing
- [ ] All E2E tests passing
- [ ] Jitsi configured and tested
- [ ] WebSocket connections stable
- [ ] Recording infrastructure ready
- [ ] File storage configured
- [ ] Lighthouse score > 90
- [ ] Mobile responsive verified
- [ ] Accessibility audit complete

**Deployment Steps:**
1. [ ] Run database migrations
2. [ ] Deploy to staging
3. [ ] Run full test suite on staging
4. [ ] Load test (100+ concurrent users)
5. [ ] Security audit
6. [ ] Get stakeholder sign-off
7. [ ] Deploy to production
8. [ ] Monitor error logs
9. [ ] Gather initial feedback

**Post-Deployment:**
- [ ] Monitor server resources
- [ ] Check error rates
- [ ] Track user adoption
- [ ] Gather feedback
- [ ] Plan Phase 2 improvements

---

### 8.3 Server Requirements

#### For Self-Hosted Jitsi (Production)

```
Minimum Specs:
- CPU: 4 cores
- RAM: 8 GB
- Storage: 100 GB+ (for recordings)
- Bandwidth: 10 Mbps+
- OS: Ubuntu 20.04 LTS

Docker Setup:
```bash
docker run -d \
  -p 80:80 \
  -p 443:443 \
  -e XMPP_DOMAIN=meet.example.com \
  -e JICOFO_AUTH_TYPE=internal \
  jitsi/jicofo

docker run -d \
  -p 10000:10000/udp \
  -p 4443:4443 \
  jitsi/jvb
```
```

#### For Presentations & LMS (Existing)

```
No additional resources needed:
- Use existing PostgreSQL
- Use existing Next.js server
- Use existing file storage
```

---

## COST BREAKDOWN

### Total Cost of Ownership (TCO)

```
Monthly Costs:
├─ Server Hosting: $20-100 (your choice)
├─ Database: $0 (already have)
├─ CDN/Cache: $0 (optional, not required)
├─ Email Service: $0 (can use free tier)
├─ Backup Storage: $0 (local backups)
└─ Total: $20-100/month

One-Time Costs:
├─ Development: Your time (already budgeted)
├─ Domain: $0 (already have)
├─ SSL Certificate: $0 (Let's Encrypt)
└─ Total: $0

Licensing:
├─ Jitsi Meet: FREE (AGPL 3.0)
├─ Reveal.js: FREE (MIT)
├─ Socket.io: FREE (MIT)
├─ Node.js: FREE (MIT)
├─ Next.js: FREE (MIT)
├─ PostgreSQL: FREE (PostgreSQL License)
└─ Total: $0

GRAND TOTAL: $0 (just your infrastructure costs)
```

---

## SUMMARY & NEXT STEPS

### What You're Getting

✅ **Live Classes System**
- Schedule and host live video classes
- Real-time chat and Q&A
- Attendance tracking
- Recording and playback
- Free video conferencing (Jitsi)

✅ **Presentations Module**
- Create slide decks within LMS
- Multiple slide types
- Beautiful themes
- Export options
- Live presentation mode
- Student presentations for assignments

✅ **Completely Free**
- Open-source software only
- No license costs
- No SaaS fees
- Full control and privacy

### Implementation Timeline

**Total Duration:** 6 weeks  
**Effort:** ~200-240 development hours  
**Team Size:** 1-2 developers

### Files to Present to Claude Code

```
1. This document (LIVE_CLASSES_AND_PRESENTATIONS_STRATEGY.md)
2. Use alongside LMS_ENHANCEMENT_STRATEGY.md and TECHNICAL_SPECIFICATION.md
3. Provide in this order:
   - Show requirements overview
   - Database schema to implement
   - API routes and components
   - Testing requirements
```

### Key Integration Points with Existing LMS

```
✓ Weeks - Add "Schedule Class" button
✓ Lectures - Add "Record as class" option
✓ Assignments - Add "Present assignment" type
✓ Dashboard - Show upcoming classes
✓ Leaderboard - Add engagement score from classes
✓ Attendance - Integrate class attendance
✓ Recordings - Archive in learning materials
```

---

## APPENDIX: RECOMMENDED READING

For Claude Code implementation:
1. **Jitsi Meet Documentation:** https://jitsi.github.io/handbook/
2. **Reveal.js Documentation:** https://revealjs.com/
3. **Socket.io Documentation:** https://socket.io/docs/
4. **Next.js API Routes:** https://nextjs.org/docs/api-routes/introduction

For Infrastructure:
1. **Docker Jitsi:** https://github.com/jitsi/docker-jitsi-meet
2. **MinIO Setup:** https://docs.min.io/
3. **PostgreSQL Arrays/JSONB:** https://www.postgresql.org/docs/current/datatype-json.html

---

**Document prepared for:** Claude Code / Development Team  
**Review with:** Stakeholders, IT/Ops (for server setup)  
**Total estimated effort:** 200-240 development hours  
**Cost:** $0/month (infrastructure only)  
**Last updated:** August 1, 2026
