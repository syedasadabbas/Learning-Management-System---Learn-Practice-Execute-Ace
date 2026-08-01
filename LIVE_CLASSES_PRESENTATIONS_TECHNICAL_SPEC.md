# Technical Specification: Live Classes & Presentations
## Detailed Implementation Guide for Claude Code

**Version:** 1.0  
**Status:** Ready for Development  
**Estimated Effort:** 200-240 hours  

---

## PART 1: DATABASE MIGRATIONS

### 1.1 Migration File Structure

```typescript
// src/db/migrations/[timestamp]_add_live_classes_and_presentations.ts

import { migrate } from 'drizzle-orm/postgres-js/migrator';

// Create new tables
export const up = async (db: any) => {
  // See LIVE_CLASSES_AND_PRESENTATIONS_STRATEGY.md for full schema
  // Create:
  // - live_classes
  // - class_attendance
  // - class_chat
  // - class_qa
  // - class_recordings
  // - presentations
  // - presentation_slides
  // - presentation_submissions
  // - presentation_feedback
};

export const down = async (db: any) => {
  // Drop tables in reverse order
};
```

### 1.2 Drizzle ORM Definitions

```typescript
// src/db/schema.live-classes.ts

import {
  pgTable,
  serial,
  integer,
  varchar,
  text,
  boolean,
  timestamp,
  decimal,
  pgEnum,
  index,
  uniqueIndex,
} from 'drizzle-orm/pg-core';
import { users, weeks, lectures } from './schema';

// Enums
export const classStatus = pgEnum('class_status', [
  'scheduled',
  'active',
  'ended',
  'cancelled',
]);

export const recordingStatus = pgEnum('recording_status', [
  'not_started',
  'recording',
  'processing',
  'available',
  'failed',
]);

export const messageType = pgEnum('message_type', [
  'text',
  'system',
  'poll',
  'announcement',
]);

// Tables
export const liveClasses = pgTable(
  'live_classes',
  {
    id: serial('id').primaryKey(),
    week_id: integer('week_id')
      .notNull()
      .references(() => weeks.id, { onDelete: 'cascade' }),
    lecture_id: integer('lecture_id').references(() => lectures.id, {
      onDelete: 'set null',
    }),
    instructor_id: integer('instructor_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    
    title: varchar('title', { length: 255 }).notNull(),
    description: text('description'),
    scheduled_at: timestamp('scheduled_at', { withTimezone: true }).notNull(),
    duration_minutes: integer('duration_minutes').notNull().default(60),
    status: classStatus('status').notNull().default('scheduled'),
    
    jitsi_room_name: varchar('jitsi_room_name', { length: 255 }),
    jitsi_password: varchar('jitsi_password', { length: 255 }),
    enable_recording: boolean('enable_recording').default(true),
    
    recording_url: varchar('recording_url', { length: 500 }),
    recording_status: recordingStatus('recording_status').default('not_started'),
    
    max_participants: integer('max_participants'),
    allow_chat: boolean('allow_chat').default(true),
    allow_qa: boolean('allow_qa').default(true),
    allow_screen_share: boolean('allow_screen_share').default(true),
    
    attendance_count: integer('attendance_count').default(0),
    engagement_score: decimal('engagement_score', { precision: 5, scale: 2 }),
    
    created_at: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    started_at: timestamp('started_at', { withTimezone: true }),
    ended_at: timestamp('ended_at', { withTimezone: true }),
    is_archived: boolean('is_archived').default(false),
  },
  (table) => ({
    weekIdx: index('idx_live_classes_week_id').on(table.week_id),
    instructorIdx: index('idx_live_classes_instructor_id').on(
      table.instructor_id
    ),
    statusIdx: index('idx_live_classes_status').on(table.status),
    scheduledIdx: index('idx_live_classes_scheduled_at').on(
      table.scheduled_at
    ),
  })
);

export const classAttendance = pgTable(
  'class_attendance',
  {
    id: serial('id').primaryKey(),
    class_id: integer('class_id')
      .notNull()
      .references(() => liveClasses.id, { onDelete: 'cascade' }),
    student_id: integer('student_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    
    joined_at: timestamp('joined_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    left_at: timestamp('left_at', { withTimezone: true }),
    time_present_minutes: integer('time_present_minutes'),
    
    messages_sent: integer('messages_sent').default(0),
    questions_asked: integer('questions_asked').default(0),
    screen_share_count: integer('screen_share_count').default(0),
    
    marked_present: boolean('marked_present').default(true),
    participation_score: integer('participation_score').default(0),
  },
  (table) => ({
    classIdx: index('idx_class_attendance_class_id').on(table.class_id),
    studentIdx: index('idx_class_attendance_student_id').on(table.student_id),
    uniqueIdx: uniqueIndex('idx_class_attendance_unique').on(
      table.class_id,
      table.student_id
    ),
  })
);

export const classChat = pgTable(
  'class_chat',
  {
    id: serial('id').primaryKey(),
    class_id: integer('class_id')
      .notNull()
      .references(() => liveClasses.id, { onDelete: 'cascade' }),
    sender_id: integer('sender_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    
    message: text('message').notNull(),
    message_type: messageType('message_type').default('text'),
    is_pinned: boolean('is_pinned').default(false),
    is_deleted: boolean('is_deleted').default(false),
    
    parent_message_id: integer('parent_message_id').references(
      () => classChat.id
    ),
    
    created_at: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    edited_at: timestamp('edited_at', { withTimezone: true }),
  },
  (table) => ({
    classIdx: index('idx_class_chat_class_id').on(table.class_id),
    senderIdx: index('idx_class_chat_sender_id').on(table.sender_id),
  })
);

export const classQA = pgTable(
  'class_qa',
  {
    id: serial('id').primaryKey(),
    class_id: integer('class_id')
      .notNull()
      .references(() => liveClasses.id, { onDelete: 'cascade' }),
    student_id: integer('student_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    instructor_id: integer('instructor_id').references(() => users.id, {
      onDelete: 'set null',
    }),
    
    question: text('question').notNull(),
    is_answered: boolean('is_answered').default(false),
    
    answer: text('answer'),
    answered_at: timestamp('answered_at', { withTimezone: true }),
    
    upvotes: integer('upvotes').default(0),
    is_pinned: boolean('is_pinned').default(false),
    
    created_at: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => ({
    classIdx: index('idx_class_qa_class_id').on(table.class_id),
    studentIdx: index('idx_class_qa_student_id').on(table.student_id),
  })
);

export const classRecordings = pgTable(
  'class_recordings',
  {
    id: serial('id').primaryKey(),
    class_id: integer('class_id')
      .notNull()
      .unique()
      .references(() => liveClasses.id),
    
    file_name: varchar('file_name', { length: 500 }),
    file_path: varchar('file_path', { length: 500 }),
    file_size_mb: integer('file_size_mb'),
    duration_seconds: integer('duration_seconds'),
    
    recording_started_at: timestamp('recording_started_at', {
      withTimezone: true,
    }),
    recording_ended_at: timestamp('recording_ended_at', { withTimezone: true }),
    transcription: text('transcription'),
    
    is_public: boolean('is_public').default(false),
    hls_url: varchar('hls_url', { length: 500 }),
    dash_url: varchar('dash_url', { length: 500 }),
    
    created_at: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    deleted_at: timestamp('deleted_at', { withTimezone: true }),
  },
  (table) => ({
    classIdx: index('idx_class_recordings_class_id').on(table.class_id),
  })
);
```

---

## PART 2: API ROUTES

### 2.1 Live Classes Routes

#### `GET /api/classes/upcoming`

```typescript
// pages/api/classes/upcoming.ts

import { requireUser } from '@/lib/guard';
import { db } from '@/db';
import { liveClasses, weeks } from '@/db/schema';
import { eq, gt, gte } from 'drizzle-orm';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const user = await requireUser();

  const upcomingClasses = await db.query.liveClasses.findMany({
    where: gte(liveClasses.scheduled_at, new Date()),
    orderBy: (classes, { asc }) => asc(classes.scheduled_at),
    limit: 10,
    with: {
      week: {
        columns: { week_number: true, title: true },
      },
      instructor: {
        columns: { name: true },
      },
    },
  });

  return res.json({
    success: true,
    data: upcomingClasses.map((cls) => ({
      id: cls.id,
      title: cls.title,
      week_number: cls.week.week_number,
      scheduled_at: cls.scheduled_at,
      duration_minutes: cls.duration_minutes,
      instructor_name: cls.instructor.name,
      status: cls.status,
    })),
  });
}
```

---

#### `POST /api/classes`

```typescript
// pages/api/classes/index.ts (POST)

import { requireUser } from '@/lib/guard';
import { db } from '@/db';
import { liveClasses } from '@/db/schema';
import { v4 as uuid } from 'uuid';

interface CreateClassRequest {
  title: string;
  description: string;
  week_id: number;
  lecture_id?: number;
  scheduled_at: string; // ISO date
  duration_minutes: number;
  enable_recording: boolean;
  allow_chat: boolean;
  allow_qa: boolean;
  allow_screen_share: boolean;
}

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  const user = await requireUser();

  // Check instructor role
  if (user.role !== 'instructor' && user.role !== 'admin') {
    return res.status(403).json({ error: 'Only instructors can create classes' });
  }

  const {
    title,
    description,
    week_id,
    lecture_id,
    scheduled_at,
    duration_minutes,
    enable_recording,
    allow_chat,
    allow_qa,
    allow_screen_share,
  } = req.body as CreateClassRequest;

  // Validate
  if (!title || !scheduled_at || !duration_minutes) {
    return res.status(400).json({ error: 'Missing required fields' });
  }

  // Generate Jitsi room name (URL-safe, unique)
  const jitsiRoomName = `${title.toLowerCase().replace(/\s+/g, '-')}-${uuid().slice(0, 8)}`;
  const jitsiPassword = uuid().slice(0, 12);

  const newClass = await db
    .insert(liveClasses)
    .values({
      week_id,
      lecture_id: lecture_id || null,
      instructor_id: user.id,
      title,
      description: description || null,
      scheduled_at: new Date(scheduled_at),
      duration_minutes,
      jitsi_room_name: jitsiRoomName,
      jitsi_password: jitsiPassword,
      enable_recording,
      allow_chat,
      allow_qa,
      allow_screen_share,
    })
    .returning();

  // TODO: Send email to students in this week
  // sendClassNotification(week_id, title, scheduled_at);

  return res.status(201).json({
    success: true,
    data: {
      id: newClass[0].id,
      jitsi_room_name: jitsiRoomName,
      jitsi_password: jitsiPassword,
      join_url: `/classes/${newClass[0].id}/join`,
    },
  });
}
```

---

#### `GET /api/classes/[id]/join`

```typescript
// pages/api/classes/[id]/join.ts

import { requireUser } from '@/lib/guard';
import { db } from '@/db';
import { liveClasses, classAttendance } from '@/db/schema';
import { eq, and } from 'drizzle-orm';
import jwt from 'jsonwebtoken';

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  const user = await requireUser();
  const { id } = req.query;

  const cls = await db.query.liveClasses.findFirst({
    where: eq(liveClasses.id, parseInt(id as string)),
  });

  if (!cls) {
    return res.status(404).json({ error: 'Class not found' });
  }

  // Check if class is active
  if (cls.status !== 'active' && cls.status !== 'scheduled') {
    return res.status(400).json({ error: 'Class is not available' });
  }

  // Check if student can join (enrolled in week)
  // TODO: Verify enrollment

  // Mark attendance (or update if already joined)
  const existingAttendance = await db.query.classAttendance.findFirst({
    where: and(
      eq(classAttendance.class_id, cls.id),
      eq(classAttendance.student_id, user.id)
    ),
  });

  if (!existingAttendance) {
    await db.insert(classAttendance).values({
      class_id: cls.id,
      student_id: user.id,
      joined_at: new Date(),
    });
  }

  // Generate Jitsi JWT token (optional, for better security)
  const token = jwt.sign(
    {
      room: cls.jitsi_room_name,
      sub: `${user.id}-${user.email}`,
      name: user.name,
      email: user.email,
      aud: 'jitsi',
    },
    process.env.JITSI_SECRET || 'secret',
    { expiresIn: '1h' }
  );

  return res.json({
    success: true,
    data: {
      jitsi_config: {
        roomName: cls.jitsi_room_name,
        password: cls.jitsi_password,
        jwt: token,
        serverUrl: process.env.JITSI_URL || 'https://meet.jitsi.org',
      },
      can_join: true,
    },
  });
}
```

---

#### `POST /api/classes/[id]/start` (Instructor)

```typescript
// pages/api/classes/[id]/start.ts

import { requireUser } from '@/lib/guard';
import { db } from '@/db';
import { liveClasses, classStatus } from '@/db/schema';
import { eq } from 'drizzle-orm';

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  const user = await requireUser();
  const { id } = req.query;

  const cls = await db.query.liveClasses.findFirst({
    where: eq(liveClasses.id, parseInt(id as string)),
  });

  if (!cls) {
    return res.status(404).json({ error: 'Class not found' });
  }

  // Verify instructor
  if (cls.instructor_id !== user.id && user.role !== 'admin') {
    return res.status(403).json({ error: 'Not authorized' });
  }

  // Update class status
  const updated = await db
    .update(liveClasses)
    .set({
      status: 'active' as any,
      started_at: new Date(),
      recording_status: cls.enable_recording ? ('recording' as any) : undefined,
    })
    .where(eq(liveClasses.id, cls.id))
    .returning();

  // TODO: Notify students that class has started
  // TODO: Start Jitsi recording (if enabled)

  return res.json({
    success: true,
    data: {
      status: 'active',
      started_at: updated[0].started_at,
      recording_enabled: cls.enable_recording,
      jitsi_url: `${process.env.JITSI_URL}/${cls.jitsi_room_name}`,
    },
  });
}
```

---

### 2.2 Presentation Routes

#### `POST /api/presentations`

```typescript
// pages/api/presentations/index.ts

import { requireUser } from '@/lib/guard';
import { db } from '@/db';
import { presentations } from '@/db/schema';

interface CreatePresentationRequest {
  title: string;
  description?: string;
  assignment_id?: number;
  theme?: string;
}

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  const user = await requireUser();
  const { title, description, assignment_id, theme } = req.body as CreatePresentationRequest;

  if (!title) {
    return res.status(400).json({ error: 'Title is required' });
  }

  const newPresentation = await db
    .insert(presentations)
    .values({
      creator_id: user.id,
      title,
      description: description || null,
      assignment_id: assignment_id || null,
      theme: theme || 'default',
      slides_json: { slides: [], metadata: { theme } },
      is_published: false,
    })
    .returning();

  return res.status(201).json({
    success: true,
    data: {
      id: newPresentation[0].id,
      title: newPresentation[0].title,
      edit_url: `/presentations/${newPresentation[0].id}/edit`,
      status: 'draft',
    },
  });
}
```

---

#### `PUT /api/presentations/[id]/slides/[slideNumber]`

```typescript
// pages/api/presentations/[id]/slides/[slideNumber].ts

import { requireUser } from '@/lib/guard';
import { db } from '@/db';
import { presentation Slides } from '@/db/schema';
import { eq, and } from 'drizzle-orm';

interface UpdateSlideRequest {
  type: string;
  title: string;
  body: string;
  speaker_notes?: string;
  content_json?: object;
  layout?: string;
  background_color?: string;
}

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  const user = await requireUser();
  const { id, slideNumber } = req.query;
  const presentationId = parseInt(id as string);
  const slideNum = parseInt(slideNumber as string);

  // Verify ownership
  const presentation = await db.query.presentations.findFirst({
    where: eq(presentations.id, presentationId),
  });

  if (!presentation || presentation.creator_id !== user.id) {
    return res.status(403).json({ error: 'Not authorized' });
  }

  const {
    type,
    title,
    body,
    speaker_notes,
    content_json,
    layout,
    background_color,
  } = req.body as UpdateSlideRequest;

  const existingSlide = await db.query.presentationSlides.findFirst({
    where: and(
      eq(presentationSlides.presentation_id, presentationId),
      eq(presentationSlides.slide_number, slideNum)
    ),
  });

  let updatedSlide;

  if (existingSlide) {
    updatedSlide = await db
      .update(presentationSlides)
      .set({
        type,
        title,
        body,
        speaker_notes: speaker_notes || null,
        content_json: content_json || null,
        layout: layout || null,
        background_color: background_color || null,
        updated_at: new Date(),
      })
      .where(eq(presentationSlides.id, existingSlide.id))
      .returning();
  } else {
    updatedSlide = await db
      .insert(presentationSlides)
      .values({
        presentation_id: presentationId,
        slide_number: slideNum,
        type,
        title,
        body,
        speaker_notes: speaker_notes || null,
        content_json: content_json || null,
        layout: layout || null,
        background_color: background_color || null,
      })
      .returning();
  }

  return res.json({
    success: true,
    data: {
      id: updatedSlide[0].id,
      updated_at: updatedSlide[0].updated_at,
    },
  });
}
```

---

#### `POST /api/presentations/[id]/export`

```typescript
// pages/api/presentations/[id]/export.ts

import { requireUser } from '@/lib/guard';
import { db } from '@/db';
import { presentations } from '@/db/schema';
import { eq } from 'drizzle-orm';
import pdfKit from 'pdfkit';
import { promisify } from 'util';

interface ExportRequest {
  format: 'pdf' | 'html' | 'pptx' | 'images';
  include_notes?: boolean;
}

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  const user = await requireUser();
  const { id } = req.query;
  const { format, include_notes } = req.body as ExportRequest;

  const presentation = await db.query.presentations.findFirst({
    where: eq(presentations.id, parseInt(id as string)),
    with: { slides: { orderBy: (slides) => slides.slide_number } },
  });

  if (!presentation) {
    return res.status(404).json({ error: 'Presentation not found' });
  }

  if (presentation.creator_id !== user.id) {
    return res.status(403).json({ error: 'Not authorized' });
  }

  let buffer: Buffer;
  let contentType: string;
  let filename: string;

  switch (format) {
    case 'pdf':
      // Use PDF generation library
      // Example: puppeteer to render Reveal.js as PDF
      contentType = 'application/pdf';
      filename = `${presentation.title}.pdf`;
      // TODO: Generate PDF
      break;

    case 'html':
      // Export as self-contained HTML
      contentType = 'text/html';
      filename = `${presentation.title}.html`;
      // TODO: Generate HTML with embedded assets
      break;

    case 'images':
      // Export slides as images
      contentType = 'application/zip';
      filename = `${presentation.title}-images.zip`;
      // TODO: Generate ZIP of slide images
      break;

    default:
      return res.status(400).json({ error: 'Invalid format' });
  }

  res.setHeader('Content-Type', contentType);
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  res.send(buffer);
}
```

---

## PART 3: REACT COMPONENTS

### 3.1 Live Classes Components

#### `ClassScheduler.tsx`

```typescript
// components/classes/ClassScheduler.tsx

import React, { useState } from 'react';
import { useRouter } from 'next/router';
import { Week } from '@/db/schema';

interface ClassSchedulerProps {
  weeks: Week[];
  onClassCreated?: (classId: number) => void;
}

export const ClassScheduler: React.FC<ClassSchedulerProps> = ({
  weeks,
  onClassCreated,
}) => {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [formData, setFormData] = useState({
    title: '',
    description: '',
    week_id: weeks[0]?.id || 0,
    scheduled_at: '',
    duration_minutes: 60,
    enable_recording: true,
    allow_chat: true,
    allow_qa: true,
    allow_screen_share: true,
  });

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);

    try {
      const response = await fetch('/api/classes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(formData),
      });

      if (!response.ok) throw new Error('Failed to create class');

      const data = await response.json();
      onClassCreated?.(data.data.id);
      router.push(`/classes/${data.data.id}`);
    } catch (error) {
      alert('Error creating class: ' + error.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="max-w-2xl mx-auto p-6 bg-white rounded-lg shadow">
      <h1 className="text-2xl font-bold mb-6">Schedule a Live Class</h1>

      <form onSubmit={handleSubmit} className="space-y-4">
        <div>
          <label className="block text-sm font-medium">Title *</label>
          <input
            type="text"
            required
            value={formData.title}
            onChange={(e) => setFormData({ ...formData, title: e.target.value })}
            className="w-full px-3 py-2 border rounded-lg"
            placeholder="e.g., HTML Foundations Review"
          />
        </div>

        <div>
          <label className="block text-sm font-medium">Description</label>
          <textarea
            value={formData.description}
            onChange={(e) =>
              setFormData({ ...formData, description: e.target.value })
            }
            className="w-full px-3 py-2 border rounded-lg"
            placeholder="What will you cover in this class?"
          />
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium">Week *</label>
            <select
              value={formData.week_id}
              onChange={(e) =>
                setFormData({
                  ...formData,
                  week_id: parseInt(e.target.value),
                })
              }
              className="w-full px-3 py-2 border rounded-lg"
            >
              {weeks.map((week) => (
                <option key={week.id} value={week.id}>
                  Week {week.week_number}: {week.title}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-sm font-medium">Date & Time *</label>
            <input
              type="datetime-local"
              required
              value={formData.scheduled_at}
              onChange={(e) =>
                setFormData({ ...formData, scheduled_at: e.target.value })
              }
              className="w-full px-3 py-2 border rounded-lg"
            />
          </div>
        </div>

        <div>
          <label className="block text-sm font-medium">Duration (minutes)</label>
          <select
            value={formData.duration_minutes}
            onChange={(e) =>
              setFormData({
                ...formData,
                duration_minutes: parseInt(e.target.value),
              })
            }
            className="w-full px-3 py-2 border rounded-lg"
          >
            <option value={30}>30 minutes</option>
            <option value={45}>45 minutes</option>
            <option value={60}>60 minutes</option>
            <option value={90}>90 minutes</option>
            <option value={120}>120 minutes</option>
          </select>
        </div>

        <div className="space-y-2 border-t pt-4">
          <h3 className="font-medium">Features</h3>

          <label className="flex items-center">
            <input
              type="checkbox"
              checked={formData.enable_recording}
              onChange={(e) =>
                setFormData({
                  ...formData,
                  enable_recording: e.target.checked,
                })
              }
              className="mr-2"
            />
            Record this class for students
          </label>

          <label className="flex items-center">
            <input
              type="checkbox"
              checked={formData.allow_chat}
              onChange={(e) =>
                setFormData({ ...formData, allow_chat: e.target.checked })
              }
              className="mr-2"
            />
            Allow student chat
          </label>

          <label className="flex items-center">
            <input
              type="checkbox"
              checked={formData.allow_qa}
              onChange={(e) =>
                setFormData({ ...formData, allow_qa: e.target.checked })
              }
              className="mr-2"
            />
            Allow Q&A
          </label>

          <label className="flex items-center">
            <input
              type="checkbox"
              checked={formData.allow_screen_share}
              onChange={(e) =>
                setFormData({
                  ...formData,
                  allow_screen_share: e.target.checked,
                })
              }
              className="mr-2"
            />
            Allow screen sharing
          </label>
        </div>

        <button
          type="submit"
          disabled={loading}
          className="w-full bg-blue-600 text-white py-2 rounded-lg hover:bg-blue-700 disabled:opacity-50"
        >
          {loading ? 'Scheduling...' : 'Schedule Class'}
        </button>
      </form>
    </div>
  );
};
```

---

#### `LiveClassRoom.tsx`

```typescript
// components/classes/LiveClassRoom.tsx

import React, { useEffect, useRef, useState } from 'react';
import { JitsiMeetExternalAPI } from 'jitsi-meet-external-api';
import { ChatPanel } from './ChatPanel';
import { QAPanel } from './QAPanel';
import { ParticipantsPanel } from './ParticipantsPanel';

interface LiveClassRoomProps {
  classId: number;
  isInstructor: boolean;
}

export const LiveClassRoom: React.FC<LiveClassRoomProps> = ({
  classId,
  isInstructor,
}) => {
  const jitsiContainerRef = useRef<HTMLDivElement>(null);
  const jitsiApi = useRef<JitsiMeetExternalAPI>();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const initJitsi = async () => {
      try {
        // Get join config from API
        const response = await fetch(`/api/classes/${classId}/join`);
        const { data } = await response.json();

        if (!jitsiContainerRef.current) return;

        // Initialize Jitsi
        const api = new JitsiMeetExternalAPI(
          data.jitsi_config.serverUrl,
          {
            roomName: data.jitsi_config.roomName,
            parentNode: jitsiContainerRef.current,
            userInfo: {
              displayName: 'You', // TODO: Get from user session
            },
            configOverwrite: {
              disableAudioLevels: false,
              enableWelcomePage: false,
            },
            interfaceConfigOverwrite: {
              DISPLAY_WELCOME_BANNER: false,
              TOOLBAR_BUTTONS: [
                'microphone',
                'camera',
                'desktop',
                'fullscreen',
                'fodeviceselection',
                'hangup',
                'chat',
                'settings',
                'raisehand',
                'videoquality',
                'filmstrip',
                'invite',
                'feedback',
                'stats',
                'shortcuts',
                'tileview',
                'download-logs',
                'help',
                'mute-everyone',
              ],
            },
          }
        );

        jitsiApi.current = api;

        // Handle events
        api.addEventListener('videoConferenceJoined', () => {
          console.log('Joined conference');
          // TODO: Mark as present in DB
        });

        api.addEventListener('videoConferenceLeft', () => {
          console.log('Left conference');
          // TODO: Update end time in DB
        });

        setLoading(false);
      } catch (err) {
        setError(err.message);
        setLoading(false);
      }
    };

    initJitsi();

    return () => {
      if (jitsiApi.current) {
        jitsiApi.current.dispose();
      }
    };
  }, [classId]);

  if (loading) return <div className="flex items-center justify-center h-screen">Loading...</div>;
  if (error) return <div className="text-red-600">Error: {error}</div>;

  return (
    <div className="flex h-screen bg-gray-900">
      {/* Jitsi Container */}
      <div className="flex-1" ref={jitsiContainerRef} style={{ height: '100%' }} />

      {/* Sidebar */}
      <aside className="w-80 bg-gray-800 border-l border-gray-700 flex flex-col">
        <div className="border-b border-gray-700">
          <h2 className="p-4 text-white font-semibold">Class Details</h2>
        </div>

        {/* Tabs */}
        <div className="flex border-b border-gray-700">
          <button className="flex-1 px-4 py-2 text-sm text-white bg-gray-700">
            Chat
          </button>
          <button className="flex-1 px-4 py-2 text-sm text-gray-400">
            Q&A
          </button>
          <button className="flex-1 px-4 py-2 text-sm text-gray-400">
            Participants
          </button>
        </div>

        {/* Chat Panel */}
        <div className="flex-1 overflow-hidden">
          <ChatPanel classId={classId} />
        </div>
      </aside>
    </div>
  );
};
```

---

### 3.2 Presentation Components

#### `PresentationBuilder.tsx`

```typescript
// components/presentations/PresentationBuilder.tsx

import React, { useState, useEffect } from 'react';
import { Presentation } from '@/db/schema';
import { SlideEditor } from './SlideEditor';
import { SlideThumbnails } from './SlideThumbnails';

interface PresentationBuilderProps {
  presentationId?: number;
  onSave?: (presentation: Presentation) => void;
}

export const PresentationBuilder: React.FC<PresentationBuilderProps> = ({
  presentationId,
  onSave,
}) => {
  const [presentation, setPresentation] = useState<Presentation | null>(null);
  const [currentSlide, setCurrentSlide] = useState(0);
  const [loading, setLoading] = useState(!!presentationId);

  useEffect(() => {
    if (presentationId) {
      fetch(`/api/presentations/${presentationId}`)
        .then((res) => res.json())
        .then((data) => {
          setPresentation(data.data);
          setLoading(false);
        });
    }
  }, [presentationId]);

  const addSlide = () => {
    if (!presentation) return;

    const newSlide = {
      id: Math.max(...presentation.slides.map((s) => s.id), 0) + 1,
      presentation_id: presentation.id,
      slide_number: presentation.slides.length + 1,
      type: 'content',
      title: '',
      body: '',
      speaker_notes: null,
      content_json: null,
      layout: 'default',
    };

    setPresentation({
      ...presentation,
      slides: [...presentation.slides, newSlide],
    });

    setCurrentSlide(presentation.slides.length);
  };

  const deleteSlide = (index: number) => {
    if (!presentation) return;

    const updated = presentation.slides.filter((_, i) => i !== index);
    setPresentation({
      ...presentation,
      slides: updated,
    });

    if (currentSlide >= updated.length) {
      setCurrentSlide(Math.max(0, updated.length - 1));
    }
  };

  const updateSlide = (index: number, updated: any) => {
    if (!presentation) return;

    const newSlides = [...presentation.slides];
    newSlides[index] = updated;

    setPresentation({
      ...presentation,
      slides: newSlides,
    });
  };

  const handleSave = async () => {
    if (!presentation) return;

    // TODO: Save to API
    onSave?.(presentation);
  };

  if (loading) return <div>Loading...</div>;
  if (!presentation) return <div>No presentation found</div>;

  const currentSlideData = presentation.slides[currentSlide];

  return (
    <div className="flex h-screen bg-gray-50">
      {/* Sidebar - Slide Thumbnails */}
      <div className="w-64 bg-white border-r p-4 overflow-y-auto">
        <h2 className="font-bold mb-4">Slides</h2>
        <SlideThumbnails
          slides={presentation.slides}
          currentIndex={currentSlide}
          onSelect={setCurrentSlide}
          onDelete={deleteSlide}
        />
        <button
          onClick={addSlide}
          className="w-full mt-4 px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700"
        >
          + Add Slide
        </button>
      </div>

      {/* Main Editor */}
      <div className="flex-1 flex flex-col">
        <div className="flex-1 p-8 overflow-y-auto">
          {currentSlideData && (
            <SlideEditor
              slide={currentSlideData}
              onUpdate={(updated) => updateSlide(currentSlide, updated)}
            />
          )}
        </div>

        {/* Footer */}
        <div className="bg-white border-t p-4 flex gap-4">
          <button
            onClick={handleSave}
            className="px-6 py-2 bg-green-600 text-white rounded hover:bg-green-700"
          >
            Save
          </button>
          <button className="px-6 py-2 bg-gray-300 text-gray-900 rounded hover:bg-gray-400">
            Preview
          </button>
          <button className="px-6 py-2 bg-blue-600 text-white rounded hover:bg-blue-700">
            Present
          </button>
        </div>
      </div>
    </div>
  );
};
```

---

## PART 4: IMPLEMENTATION CHECKLIST

### Phase 1: Foundation (Weeks 1-2)

**Database & Schema:**
- [ ] Create migration file
- [ ] Define all Drizzle ORM schemas
- [ ] Create indexes
- [ ] Run migration on dev database
- [ ] Seed test data

**API Routes (Live Classes):**
- [ ] `GET /api/classes` - List classes
- [ ] `GET /api/classes/[id]` - Get single class
- [ ] `POST /api/classes` - Create class (instructor)
- [ ] `PUT /api/classes/[id]` - Update class
- [ ] `GET /api/classes/[id]/join` - Get join credentials
- [ ] `POST /api/classes/[id]/start` - Start class (instructor)
- [ ] `POST /api/classes/[id]/end` - End class (instructor)
- [ ] Error handling and validation
- [ ] Write tests

**API Routes (Presentations):**
- [ ] `POST /api/presentations` - Create
- [ ] `GET /api/presentations/[id]` - Get
- [ ] `PUT /api/presentations/[id]` - Update
- [ ] `DELETE /api/presentations/[id]` - Delete
- [ ] Error handling and validation

**Components:**
- [ ] `ClassScheduler` component
- [ ] `LiveClassRoom` wrapper
- [ ] Jitsi integration
- [ ] Basic styling

**Testing:**
- [ ] Unit tests for API routes
- [ ] Database schema tests
- [ ] Jitsi integration test

### Phase 2: Features (Weeks 2-3)

**Chat System:**
- [ ] WebSocket setup
- [ ] `ClassChat` component
- [ ] Real-time message sync
- [ ] Message persistence
- [ ] E2E tests

**Q&A System:**
- [ ] `QAPanel` component
- [ ] Question storage
- [ ] Answer functionality
- [ ] Upvote system
- [ ] E2E tests

**Presentations:**
- [ ] `PresentationBuilder` component
- [ ] `SlideEditor` component
- [ ] Slide CRUD operations
- [ ] Reveal.js integration
- [ ] Basic styling

### Phase 3: Advanced (Weeks 3-4)

**Attendance Tracking:**
- [ ] Auto-mark on join
- [ ] Time calculations
- [ ] Report generation
- [ ] Export functionality

**Recordings:**
- [ ] Jitsi recording setup
- [ ] Storage configuration
- [ ] Playback interface
- [ ] Transcript handling

**Presentation Features:**
- [ ] Multiple slide types
- [ ] Themes
- [ ] Speaker notes
- [ ] Export options
- [ ] Presentation mode

### Phase 4: Polish & Testing (Weeks 4-6)

- [ ] Full E2E test suite
- [ ] Performance optimization
- [ ] Mobile responsive
- [ ] Accessibility audit
- [ ] UI/UX refinement
- [ ] Documentation
- [ ] Deployment

---

**Ready for Claude Code Implementation**

Use this specification alongside the strategic document to guide development. All APIs, components, and database schemas are specified and ready to build.

Total estimated effort: 200-240 development hours
