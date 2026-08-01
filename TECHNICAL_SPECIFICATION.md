# Technical Specification for LMS Enhancement
## Database Schema, API Routes, and Component APIs

**For:** Claude Code / Development Team  
**Version:** 1.0  
**Status:** Ready for Implementation  

---

## TABLE OF CONTENTS

1. Database Schema Extensions
2. API Route Specifications
3. React Component APIs
4. Data Flow Diagrams
5. Testing Requirements
6. Performance Considerations
7. Deployment Checklist

---

## 1. DATABASE SCHEMA EXTENSIONS

### 1.1 New Tables

#### Table: `assignment_samples`

**Purpose:** Store visual samples/prototypes shown to students before assignments

```sql
CREATE TABLE assignment_samples (
  id SERIAL PRIMARY KEY,
  assignment_id INTEGER NOT NULL REFERENCES assignments(id) ON DELETE CASCADE,
  
  -- Metadata
  title VARCHAR(255) NOT NULL,           -- e.g., "Desktop View", "Mobile", "Reference"
  description TEXT,                      -- What this sample demonstrates
  sample_order INTEGER NOT NULL DEFAULT 0, -- For ordering multiple samples
  
  -- Visual Preview
  sample_output_html TEXT,               -- The rendered preview (iframe src or HTML)
  screenshot_url VARCHAR(500),           -- Static image of the sample
  
  -- Code Example(s)
  code_example JSONB,                    -- Array of code snippets
  -- Format: [
  --   {
  --     "filename": "index.html",
  --     "language": "html",
  --     "code": "<!DOCTYPE html>...",
  --     "explanation": "This file...",
  --     "highlighted_lines": [1, 3, 5]
  --   }
  -- ]
  
  -- Live Link
  live_url VARCHAR(500),                 -- URL to working example
  
  -- Features & Functionality
  features JSONB,                        -- Array of strings: ["Responsive", "Form validation"]
  
  -- Optional Video
  video_walkthrough_url VARCHAR(500),    -- YouTube embed URL or similar
  
  -- Metadata
  created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
  
  -- Indexes
  UNIQUE(assignment_id, sample_order)
);

CREATE INDEX idx_assignment_samples_assignment_id ON assignment_samples(assignment_id);
CREATE INDEX idx_assignment_samples_created_at ON assignment_samples(created_at);
```

---

#### Table: `practice_problems`

**Purpose:** Scaffolded practice exercises for each lecture

```sql
CREATE TABLE practice_problems (
  id SERIAL PRIMARY KEY,
  lecture_id INTEGER NOT NULL REFERENCES lectures(id) ON DELETE CASCADE,
  
  -- Basic Info
  title VARCHAR(255) NOT NULL,
  description TEXT,
  difficulty_level proficiency_level NOT NULL DEFAULT 'beginner',
  learning_objectives JSONB,            -- Array of strings
  -- Format: ["Understand flexbox", "Implement responsive layout"]
  
  -- Problem Statement
  problem_context TEXT NOT NULL,        -- Why this problem matters
  problem_statement TEXT NOT NULL,      -- What student needs to do
  acceptance_criteria JSONB,            -- Array of { criteria, verification }
  -- Format: [
  --   { "criteria": "Responsive on mobile", "how_to_verify": "Test at 375px width" }
  -- ]
  
  -- Code Scaffolding
  starter_code TEXT,                    -- Skeleton provided to student
  starter_language VARCHAR(32),         -- 'html', 'css', 'javascript', 'python'
  
  -- Progressive Hints
  hints JSONB NOT NULL,                 -- Array of { level, text }
  -- Format: [
  --   { "level": 1, "text": "Start by..." },
  --   { "level": 2, "text": "Then..." },
  --   { "level": 3, "text": "Finally..." }
  -- ]
  
  -- Solution & Explanation
  solution_code TEXT,                   -- Reference implementation
  solution_explanation TEXT,            -- Why this solution works
  solution_screenshot_url VARCHAR(500), -- Visual of correct output
  
  -- Testing
  test_cases JSONB,                     -- Array of { name, input, expected }
  execution_mode executionMode NOT NULL DEFAULT 'browser', -- 'browser', 'piston', 'none'
  
  -- Metadata
  problem_order INTEGER NOT NULL DEFAULT 0,
  created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
  
  UNIQUE(lecture_id, problem_order)
);

CREATE INDEX idx_practice_problems_lecture_id ON practice_problems(lecture_id);
CREATE INDEX idx_practice_problems_difficulty_level ON practice_problems(difficulty_level);
```

---

#### Table: `interview_questions`

**Purpose:** Interview prep questions integrated into curriculum

```sql
CREATE TABLE interview_questions (
  id SERIAL PRIMARY KEY,
  lecture_id INTEGER REFERENCES lectures(id) ON DELETE CASCADE,
  week_id INTEGER REFERENCES weeks(id) ON DELETE CASCADE,
  
  -- Question Details
  title VARCHAR(255) NOT NULL,
  difficulty_level proficiency_level NOT NULL DEFAULT 'intermediate',
  category VARCHAR(50),                 -- 'Technical', 'Behavioral', 'Design'
  question_text TEXT NOT NULL,
  
  -- Context & Background
  context TEXT,                         -- Why this question matters
  
  -- Sample Answer
  sample_answer TEXT NOT NULL,
  answer_explanation TEXT,              -- Detailed breakdown
  
  -- Common Mistakes
  common_mistakes JSONB,                -- Array of { mistake, why_wrong, correction }
  -- Format: [
  --   {
  --     "mistake": "CSS Grid uses pixels only",
  --     "why_wrong": "Grid works with any unit",
  --     "correction": "Grid accepts px, %, fr, em, etc."
  --   }
  -- ]
  
  -- Follow-up Questions
  follow_up_questions JSONB,            -- Array of strings
  
  -- Visual Aids
  visual_walkthrough_html TEXT,         -- SVG or HTML diagram of answer
  code_example TEXT,                    -- If applicable
  
  -- Related Learning
  related_concepts JSONB,               -- Array of strings
  related_practice_id INTEGER REFERENCES practice_problems(id) ON DELETE SET NULL,
  
  -- Metadata
  question_order INTEGER NOT NULL DEFAULT 0,
  created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
  
  UNIQUE(lecture_id, question_order) WHERE lecture_id IS NOT NULL,
  UNIQUE(week_id, question_order) WHERE week_id IS NOT NULL
);

CREATE INDEX idx_interview_questions_lecture_id ON interview_questions(lecture_id);
CREATE INDEX idx_interview_questions_week_id ON interview_questions(week_id);
CREATE INDEX idx_interview_questions_difficulty_level ON interview_questions(difficulty_level);
```

---

#### Table: `lecture_visualizations`

**Purpose:** Store visualization data and specs for concepts

```sql
CREATE TABLE lecture_visualizations (
  id SERIAL PRIMARY KEY,
  lecture_id INTEGER NOT NULL REFERENCES lectures(id) ON DELETE CASCADE,
  topic_key VARCHAR(120),               -- Link to topic key in lectures table
  
  -- Visualization Type
  type VARCHAR(50) NOT NULL,            -- 'diagram', 'animation', 'interactive'
  title VARCHAR(255) NOT NULL,
  description TEXT,
  
  -- Visual Data
  svg_markup TEXT,                      -- For SVG diagrams
  animation_spec JSONB,                 -- Framer Motion or similar spec
  interactive_data JSONB,               -- Interactive component config
  
  -- Explanation
  explanation TEXT,
  learning_point TEXT,                  -- What concept this teaches
  
  -- Configuration
  width_px INTEGER,                     -- Suggested width
  height_px INTEGER,                    -- Suggested height
  is_interactive BOOLEAN DEFAULT FALSE,
  
  -- Metadata
  order_index INTEGER NOT NULL DEFAULT 0,
  created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
  
  UNIQUE(lecture_id, order_index)
);

CREATE INDEX idx_lecture_visualizations_lecture_id ON lecture_visualizations(lecture_id);
CREATE INDEX idx_lecture_visualizations_topic_key ON lecture_visualizations(topic_key);
```

---

### 1.2 Existing Table Modifications

#### Extend `lectures` table

```sql
ALTER TABLE lectures ADD COLUMN IF NOT EXISTS (
  -- Learning structure
  learning_objectives TEXT,              -- Markdown list of outcomes
  estimated_duration_minutes INTEGER,    -- Time to complete lecture
  difficulty_level proficiency_level DEFAULT 'beginner',
  
  -- Enhanced content
  visualizations_count INTEGER DEFAULT 0,
  practice_problems_count INTEGER DEFAULT 0,
  
  -- Metadata
  is_enhanced BOOLEAN DEFAULT FALSE      -- Flag for content quality
);
```

---

#### Extend `assignments` table

```sql
ALTER TABLE assignments ADD COLUMN IF NOT EXISTS (
  -- Sample Implementations
  samples_count INTEGER DEFAULT 0,
  
  -- Visual Requirements
  functional_requirements JSONB,        -- Array of { requirement, screenshot_url }
  acceptance_criteria_visual JSONB,     -- Detailed checklist with images
  
  -- Rubric with Examples
  rubric_with_examples JSONB,           -- Array of {
                                        --   criteria, weight, examples
                                        -- }
  
  -- Visual Guidance
  sample_screenshots JSONB,             -- Array of preview images
  
  -- Metadata
  is_enhanced BOOLEAN DEFAULT FALSE
);
```

---

#### Extend `questions` table

```sql
ALTER TABLE questions ADD COLUMN IF NOT EXISTS (
  -- Enhanced Explanation
  explanation_html TEXT,                -- Rich HTML explanation with visuals
  correct_breakdown JSONB,              -- { why_correct, visual_explanation }
  incorrect_analysis JSONB,             -- Array of { option, why_wrong, visual }
  
  -- Learning Resources
  deeper_learning_resources JSONB,      -- { concepts, video_url, practice_link }
  
  -- Metadata
  is_enhanced BOOLEAN DEFAULT FALSE
);
```

---

### 1.3 JSONB Column Formats Reference

#### `code_example` Format (assignment_samples)
```json
[
  {
    "filename": "index.html",
    "language": "html",
    "code": "<!DOCTYPE html>\n<html>...",
    "explanation": "This is the page structure. Each section has semantic meaning.",
    "highlighted_lines": [1, 3, 5],
    "line_explanations": {
      "1": "DOCTYPE declares this is HTML5",
      "3": "The html element wraps everything"
    }
  },
  {
    "filename": "style.css",
    "language": "css",
    "code": ".container { display: flex; ... }",
    "explanation": "Flexbox container for responsive layout",
    "highlighted_lines": [1]
  }
]
```

---

#### `hints` Format (practice_problems)
```json
[
  {
    "level": 1,
    "text": "Start by thinking about the HTML structure. What elements do you need?"
  },
  {
    "level": 2,
    "text": "Use flexbox with justify-content and align-items for layout"
  },
  {
    "level": 3,
    "text": "For responsive: use @media queries to change flex-direction at breakpoints"
  }
]
```

---

#### `common_mistakes` Format (interview_questions)
```json
[
  {
    "mistake": "Thinking specificity values are cumulative decimals",
    "why_wrong": "A single ID (100 points) beats 10 classes (100 points each)",
    "correction": "Specificity is calculated: IDs (100 each), Classes (10 each), Elements (1 each)"
  }
]
```

---

## 2. API ROUTE SPECIFICATIONS

### 2.1 Assignment Sample Endpoints

#### GET `/api/assignments/[assignmentId]/samples`

**Purpose:** Fetch all samples for an assignment

**Parameters:**
```typescript
interface Request {
  params: {
    assignmentId: string; // Integer ID
  };
}
```

**Response:**
```typescript
interface AssignmentSamplesResponse {
  success: boolean;
  data: {
    id: number;
    assignment_id: number;
    title: string;
    description: string;
    sample_output_html: string;
    screenshot_url: string;
    code_example: Array<{
      filename: string;
      language: string;
      code: string;
      explanation: string;
      highlighted_lines: number[];
    }>;
    live_url: string;
    features: string[];
    video_walkthrough_url?: string;
  }[];
  error?: string;
}
```

**Status Codes:**
- `200` - Success
- `401` - Unauthorized
- `404` - Assignment not found
- `500` - Server error

**Notes:**
- No authentication required (students can view)
- Order by `sample_order` ASC
- Include all code snippets and explanations
- Validate URLs before returning

---

#### POST `/api/assignments/[assignmentId]/samples`

**Purpose:** Create a new sample (instructor/admin only)

**Authorization:** `instructor` or `admin` role

**Request Body:**
```typescript
interface CreateSampleRequest {
  title: string;
  description: string;
  sample_output_html: string;
  screenshot_url: string;
  code_example: Array<{
    filename: string;
    language: string;
    code: string;
    explanation: string;
    highlighted_lines: number[];
  }>;
  live_url: string;
  features: string[];
  video_walkthrough_url?: string;
  sample_order: number;
}
```

**Response:**
```typescript
interface CreateSampleResponse {
  success: boolean;
  data: {
    id: number;
    // ... full sample data
  };
  error?: string;
}
```

**Validation:**
- `title` required, max 255 chars
- `description` required, max 1000 chars
- `live_url` must be valid URL (start with http)
- `code_example` array not empty
- `sample_order` unique per assignment

---

#### PUT `/api/assignments/[assignmentId]/samples/[sampleId]`

**Purpose:** Update existing sample

**Authorization:** Creator or `admin`

**Request Body:** Same as POST  
**Response:** Updated sample object  
**Status Codes:** 200, 401, 403, 404, 422

---

#### DELETE `/api/assignments/[assignmentId]/samples/[sampleId]`

**Purpose:** Delete a sample

**Authorization:** Creator or `admin`

**Response:**
```typescript
{
  success: boolean;
  message: string;
}
```

---

### 2.2 Practice Problem Endpoints

#### GET `/api/lectures/[lectureId]/practice-problems`

**Purpose:** Fetch all practice problems for a lecture

**Query Parameters:**
```typescript
interface QueryParams {
  difficulty?: 'beginner' | 'intermediate' | 'advanced';
  limit?: number;
  offset?: number;
}
```

**Response:**
```typescript
interface PracticeProblemsResponse {
  success: boolean;
  data: {
    id: number;
    lecture_id: number;
    title: string;
    description: string;
    difficulty_level: string;
    learning_objectives: string[];
    problem_context: string;
    problem_statement: string;
    hints: Array<{
      level: 1 | 2 | 3;
      text: string;
    }>;
    starter_code: string;
    starter_language: string;
    // Don't include full solution in list view
    solution_available: boolean;
    test_cases_count: number;
  }[];
  total: number;
  error?: string;
}
```

---

#### GET `/api/practice-problems/[problemId]`

**Purpose:** Fetch single problem with full details (including solution)

**Authorization:** Authenticated users only

**Response:**
```typescript
interface PracticeProblemDetailResponse {
  success: boolean;
  data: {
    id: number;
    // ... all fields including:
    solution_code: string;
    solution_explanation: string;
    solution_screenshot_url: string;
    test_cases: Array<{
      name: string;
      input: string;
      expected: string;
    }>;
  };
  error?: string;
}
```

---

#### POST `/api/practice-problems/[problemId]/attempt`

**Purpose:** Submit solution attempt and get feedback

**Authorization:** Authenticated students

**Request Body:**
```typescript
interface AttemptRequest {
  code: string;
  language: string;
}
```

**Response:**
```typescript
interface AttemptResponse {
  success: boolean;
  data: {
    passed_tests: number;
    total_tests: number;
    tests: Array<{
      name: string;
      passed: boolean;
      expected: string;
      actual: string;
      explanation?: string;
    }>;
    feedback: string;
    hint_level_available?: number; // Next hint level
  };
  error?: string;
}
```

---

### 2.3 Interview Question Endpoints

#### GET `/api/interview-questions`

**Purpose:** Fetch interview questions

**Query Parameters:**
```typescript
interface QueryParams {
  week_id?: number;
  lecture_id?: number;
  difficulty?: string;
  category?: string;
  limit?: number;
  offset?: number;
}
```

**Response:**
```typescript
interface InterviewQuestionsResponse {
  success: boolean;
  data: {
    id: number;
    title: string;
    difficulty_level: string;
    category: string;
    question_text: string;
    // Don't include answer in list
    has_sample_answer: boolean;
    related_lecture?: {
      id: number;
      title: string;
    };
  }[];
  total: number;
}
```

---

#### GET `/api/interview-questions/[questionId]`

**Purpose:** Fetch full question with answer

**Authorization:** Authenticated only

**Response:**
```typescript
interface InterviewQuestionDetailResponse {
  success: boolean;
  data: {
    id: number;
    title: string;
    question_text: string;
    difficulty_level: string;
    category: string;
    context: string;
    sample_answer: string;
    answer_explanation: string;
    common_mistakes: Array<{
      mistake: string;
      why_wrong: string;
      correction: string;
    }>;
    follow_up_questions: string[];
    visual_walkthrough_html: string;
    related_concepts: string[];
  };
}
```

---

### 2.4 Lecture Visualization Endpoints

#### GET `/api/lectures/[lectureId]/visualizations`

**Purpose:** Fetch all visualizations for a lecture

**Response:**
```typescript
interface VisualizationsResponse {
  success: boolean;
  data: {
    id: number;
    type: 'diagram' | 'animation' | 'interactive';
    title: string;
    description: string;
    svg_markup?: string;
    animation_spec?: object;
    interactive_data?: object;
    explanation: string;
    learning_point: string;
    is_interactive: boolean;
  }[];
}
```

---

## 3. REACT COMPONENT APIs

### 3.1 Sample Implementation Components

#### `<AssignmentSampleShowcase />`

**Purpose:** Display multiple samples for an assignment

```typescript
interface AssignmentSampleShowcaseProps {
  assignmentId: number;
  isReadOnly?: boolean;
  onSampleCreated?: (sample: AssignmentSample) => void;
  maxWidth?: string;
}

// Usage:
<AssignmentSampleShowcase 
  assignmentId={1} 
  maxWidth="800px"
/>

// Features:
// - Carousel/tabs for multiple samples
// - Live preview in iframe
// - Code snippets with syntax highlighting
// - Feature list with checkmarks
// - Links to live implementations
// - Optional video walkthrough
// - Mobile responsive
```

---

#### `<SampleCard />`

**Purpose:** Single sample display component

```typescript
interface SampleCardProps {
  sample: AssignmentSample;
  showCode?: boolean;
  showVideo?: boolean;
  expandable?: boolean;
  onCopyCode?: (filename: string) => void;
}

// Features:
// - Screenshot preview
// - Code viewers for multiple files
// - Feature list
// - Live link button
// - Video embed (optional)
// - Collapsible sections
```

---

#### `<CodeSnippetViewer />`

**Purpose:** Display code with syntax highlighting and explanations

```typescript
interface CodeSnippetViewerProps {
  filename: string;
  language: 'html' | 'css' | 'javascript' | 'python';
  code: string;
  explanation?: string;
  highlightedLines?: number[];
  lineExplanations?: Record<number, string>;
  copyable?: boolean;
  lineNumbers?: boolean;
}

// Features:
// - Syntax highlighting
// - Line numbers
// - Copy button
// - Highlighted lines
// - Line-by-line explanations (tooltip)
// - Responsive
```

---

### 3.2 Practice Problem Components

#### `<PracticeProblemCard />`

**Purpose:** Display a practice problem

```typescript
interface PracticeProblemCardProps {
  problem: PracticeProblem;
  showSolution?: boolean;
  onAttemptSubmit?: (code: string, language: string) => void;
  showHints?: boolean;
}

// Features:
// - Problem statement
// - Learning objectives
// - Starter code
// - Interactive editor
// - Hint system (progressive reveal)
// - Test results display
// - Solution reveal
```

---

#### `<ProgressiveHintRevealer />`

**Purpose:** Progressive hint display system

```typescript
interface ProgressiveHintRevealerProps {
  hints: Array<{
    level: 1 | 2 | 3;
    text: string;
  }>;
  maxLevel?: number;
  onHintRevealed?: (level: number) => void;
}

// Features:
// - One hint at a time
// - Next button to reveal
// - Visual indication of level
// - Can't go back to previous hints
// - Analytics tracking
```

---

#### `<TestResultsBreakdown />`

**Purpose:** Display test results after code submission

```typescript
interface TestResultsBreakdownProps {
  results: Array<{
    name: string;
    passed: boolean;
    expected: string;
    actual: string;
    explanation?: string;
  }>;
  totalTests: number;
  passedTests: number;
}

// Features:
// - Pass/fail indicator for each test
// - Expected vs actual display
// - Explanation for failures
// - Progress bar
// - Encouragement messages
```

---

### 3.3 Quiz Enhancement Components

#### `<QuestionExplanationViewer />`

**Purpose:** Display enhanced quiz question explanation

```typescript
interface QuestionExplanationViewerProps {
  questionId: number;
  explanation: {
    correctAnswer: {
      text: string;
      whyCorrect: string;
      visualBreakdown?: string;
    };
    incorrectOptions: Array<{
      optionText: string;
      whyWrong: string;
      commonMistake?: string;
    }>;
    deeperLearning?: {
      concepts: string[];
      videoUrl?: string;
    };
  };
  selectedAnswer: string;
}

// Features:
// - Correct answer explanation
// - Why wrong answers are wrong
// - Visual diagrams/explanations
// - Related concepts
// - Video links
// - Code examples if applicable
```

---

#### `<CommonMistakesDisplay />`

**Purpose:** Show common mistakes and corrections

```typescript
interface CommonMistakesDisplayProps {
  mistakes: Array<{
    mistake: string;
    why_wrong: string;
    correction: string;
    visual_refutation?: string;
  }>;
}

// Features:
// - Card layout for each mistake
// - Color coding (wrong vs right)
// - Visual corrections
// - Icons/indicators
```

---

### 3.4 Visualization Components

#### `<BoxModelVisualizer />`

**Purpose:** Interactive box model demonstration

```typescript
interface BoxModelVisualizerProps {
  element: {
    width?: number;
    height?: number;
    padding?: number | [number, number, number, number];
    border?: number;
    margin?: number | [number, number, number, number];
  };
  interactive?: boolean;
  labels?: boolean;
  onDimensionsChange?: (dims: any) => void;
}

// Features:
// - Visual box model
// - Hover shows each layer
// - Interactive sliders
// - Dimension labels
// - Responsive
```

---

#### `<FlexboxPlayground />`

**Purpose:** Interactive flexbox demo

```typescript
interface FlexboxPlaygroundProps {
  initialConfig?: {
    flexDirection?: 'row' | 'column';
    justifyContent?: string;
    alignItems?: string;
    gap?: number;
  };
  interactive?: boolean;
  showCode?: boolean;
  numItems?: number;
}

// Features:
// - Visual flex container
// - Adjustable properties
// - Code preview
// - Multiple items
// - Responsive
```

---

## 4. DATA FLOW DIAGRAMS

### 4.1 Assignment Sample Display Flow

```
Student views assignment
    ↓
GET /api/assignments/[id]/samples
    ↓
Load & render AssignmentSampleShowcase
    ├─ SampleCard (Desktop view)
    ├─ SampleCard (Mobile view)
    ├─ SampleCard (Code example)
    └─ SampleCard (Reference implementation)
    ↓
Student clicks on code snippet
    ↓
CodeSnippetViewer displays with highlighting
    ↓
Student can view live implementation
    ↓
Student starts own implementation
```

---

### 4.2 Practice Problem Attempt Flow

```
Student views practice problem
    ↓
GET /api/lectures/[id]/practice-problems
    ↓
Render PracticeProblemCard
    ├─ Problem statement
    ├─ Starter code
    ├─ Interactive editor
    └─ Hint button
    ↓
Student writes code
    ↓
Student clicks "Run Tests"
    ↓
POST /api/practice-problems/[id]/attempt
    ├─ Submit code
    └─ Execute tests
    ↓
Render TestResultsBreakdown
    ├─ Passed tests (green)
    ├─ Failed tests (red)
    └─ Explanations
    ↓
If all pass: Show "Well done!" + Solution reveal
If not: Show "Want a hint?" button
    ↓
Student clicks hint (optional)
    ↓
ProgressiveHintRevealer shows next level
```

---

## 5. TESTING REQUIREMENTS

### 5.1 Unit Tests

**Each component needs:**

```typescript
describe('AssignmentSampleShowcase', () => {
  it('renders multiple samples', () => {});
  it('displays code snippets with syntax highlighting', () => {});
  it('opens live link in new tab', () => {});
  it('shows video embed when available', () => {});
  it('handles empty samples gracefully', () => {});
  it('responsive on mobile', () => {});
});

describe('PracticeProblemCard', () => {
  it('displays problem statement', () => {});
  it('shows starter code in editor', () => {});
  it('submits code on button click', () => {});
  it('displays test results', () => {});
  it('reveals next hint on button click', () => {});
  it('shows solution when requested', () => {});
});

describe('QuestionExplanationViewer', () => {
  it('shows why correct answer is correct', () => {});
  it('explains why wrong answers are wrong', () => {});
  it('displays visual diagrams', () => {});
  it('shows related concepts', () => {});
});
```

---

### 5.2 E2E Tests

```typescript
describe('Enhanced Assignment Workflow', () => {
  it('student sees multiple sample implementations', () => {
    cy.visit('/assignments/1');
    cy.get('[data-testid="sample-showcase"]').should('exist');
    cy.contains('Reference Implementation').should('be.visible');
  });

  it('student can view code examples', () => {
    cy.get('[data-testid="code-snippet"]').first().click();
    cy.get('[data-testid="code-viewer"]').should('be.visible');
  });

  it('student can interact with live preview', () => {
    cy.get('[data-testid="live-preview-link"]').click();
    // Verify new tab opened with working example
  });
});

describe('Practice Problem Workflow', () => {
  it('student can attempt practice problem', () => {
    cy.visit('/lectures/1/practice');
    cy.get('[data-testid="code-editor"]').type('const x = 5;');
    cy.get('[data-testid="submit-button"]').click();
    cy.get('[data-testid="test-results"]').should('be.visible');
  });

  it('student can reveal hints progressively', () => {
    cy.get('[data-testid="hint-button"]').click();
    cy.contains('Level 1 hint').should('be.visible');
    cy.get('[data-testid="next-hint-button"]').click();
    cy.contains('Level 2 hint').should('be.visible');
  });

  it('student can view solution', () => {
    cy.get('[data-testid="solution-button"]').click();
    cy.get('[data-testid="solution-code"]').should('be.visible');
  });
});
```

---

### 5.3 Content Validation

```typescript
// Verify all samples have required fields
describe('Assignment Samples Data Integrity', () => {
  it('all samples have working live URLs', async () => {
    const samples = await db.query('SELECT * FROM assignment_samples');
    for (const sample of samples) {
      const response = await fetch(sample.live_url, { method: 'HEAD' });
      expect(response.status).toBeLessThan(400);
    }
  });

  it('all code snippets are syntactically valid', async () => {
    const samples = await db.query('SELECT * FROM assignment_samples');
    for (const sample of samples) {
      for (const snippet of sample.code_example) {
        expect(isValidSyntax(snippet.code, snippet.language)).toBe(true);
      }
    }
  });

  it('all screenshots URLs are accessible', async () => {
    const samples = await db.query('SELECT * FROM assignment_samples');
    for (const sample of samples) {
      const response = await fetch(sample.screenshot_url, { method: 'HEAD' });
      expect(response.status).toBeLessThan(400);
    }
  });
});
```

---

## 6. PERFORMANCE CONSIDERATIONS

### 6.1 Page Load Optimization

**Targets:**
- Initial page load: < 3 seconds
- Sample showcase: < 500ms
- Code snippet render: < 100ms
- Lighthouse score: > 90

**Optimization Strategies:**

```typescript
// Lazy load code snippets
<Suspense fallback={<CodeSkeleton />}>
  <CodeSnippetViewer code={sample.code} />
</Suspense>

// Virtual scrolling for long hint lists
<VirtualList
  items={hints}
  renderItem={(hint) => <HintCard hint={hint} />}
  height={600}
  itemSize={80}
/>

// Image optimization
<Image
  src={screenshot_url}
  alt="Sample screenshot"
  width={800}
  height={600}
  quality={80}
/>
```

---

### 6.2 Database Query Optimization

```sql
-- Index for fast lookups
CREATE INDEX idx_assignment_samples_assignment_id 
  ON assignment_samples(assignment_id, sample_order);

-- Denormalize count fields
CREATE INDEX idx_assignments_samples_count 
  ON assignments(samples_count);

-- Cache frequently accessed visualizations
CREATE INDEX idx_lecture_visualizations_lecture_id 
  ON lecture_visualizations(lecture_id, order_index);
```

---

## 7. DEPLOYMENT CHECKLIST

### Pre-Deployment
- [ ] All unit tests passing
- [ ] All E2E tests passing
- [ ] Lighthouse score > 90
- [ ] No console errors/warnings
- [ ] Mobile responsive verified
- [ ] Accessibility audit complete
- [ ] Performance metrics acceptable

### Deployment Steps
1. [ ] Create database migration
2. [ ] Run migration on staging
3. [ ] Test data integrity
4. [ ] Deploy code to staging
5. [ ] Run full E2E test suite
6. [ ] Get sign-off from stakeholders
7. [ ] Deploy to production
8. [ ] Monitor error logs
9. [ ] Gather user feedback

### Post-Deployment
- [ ] Monitor error rates
- [ ] Check performance metrics
- [ ] Gather student feedback
- [ ] Document learnings
- [ ] Plan next improvements

---

## APPENDIX: Environment Variables

```bash
# .env
DATABASE_URL=postgresql://...
NEXTAUTH_SECRET=...
NEXTAUTH_URL=http://localhost:3000

# Optional: For content preview services
SCREENSHOT_API_KEY=...  # If using external screenshot service
VIDEO_EMBED_API_KEY=... # If using video service
```

---

**Document prepared for:** Implementation Team  
**Review with:** Backend, Frontend, QA, Product  
**Last updated:** August 1, 2026
