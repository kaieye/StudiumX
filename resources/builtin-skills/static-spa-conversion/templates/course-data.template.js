// course-data.template.js
//
// Empty starter for window.COURSE — fill every TODO marker with real values.
//
// Schema authority:  ../../_shared/domain-primitives.md
// Reference impl:    d:/GitHub/ai-workshop/course-data.js (full populated example)
//
// Rules of thumb:
//   - Every Day key (day1, day2, ...) MUST match meta.days[].id
//   - Every unit.id is unique within its day, never renamed once published
//   - Every task.id is a localStorage key — never rename, never reuse
//   - Every unit MUST have illustrations[] with 1–3 entries (Stage 5 Coverage Floor)
//   - Quiz items are append-only — renumbering forces 5+ hardcoded string updates

window.COURSE = {

  // ============================================================
  // meta — course-wide metadata
  // ============================================================
  meta: {
    title:      'TODO: Course title',
    subtitle:   'TODO: Optional subtitle',
    program:    'TODO: Sponsoring program (or empty string)',
    organizer:  'TODO: Organizer name',
    dates:      'TODO: Human-readable date list, e.g. "5/13, 5/20, 5/27, 6/3 (every Wed 09:00–16:30)"',
    location:   'TODO: Venue + room',
    mapUrl:     'TODO: Google Maps URL or empty string',
    format:     'TODO: e.g. "in-person + online" or "hybrid 30h (4h self-study)"',
    instructor: 'TODO: Instructor name',
    completion: [
      'TODO: Attendance ≥ 80%',
      'TODO: Pre-test + post-test completed'
    ],
    objectives: [
      'TODO: Use action verbs — "Use AI to ...", "Build ...", "Evaluate ..."',
      'TODO: 3–5 outcomes total',
    ],
    days: [
      // id MUST match window.COURSE[id] keys below
      { id: 'day1', n: 1, date: 'TODO M/D', title: 'TODO Day 1 theme', hours: 6 },
      { id: 'day2', n: 2, date: 'TODO M/D', title: 'TODO Day 2 theme', hours: 6 },
      // add more days as needed
    ]
  },

  // ============================================================
  // sharedCase — recurring fictional context (optional)
  // ============================================================
  // Set to null if course has no shared scenario; then add an explicit
  // note to course-package/overview.md: '本課無共用案例，每單元獨立舉例'
  sharedCase: {
    intro: 'TODO: 1-paragraph summary of the persistent scenario across all days.',
    brands: [
      {
        id: 'A',
        name: 'TODO: Brand A name',
        type: 'TODO: industry / category',
        rows: [
          ['業態 / Industry',   'TODO'],
          ['地點 / Location',   'TODO'],
          ['員工 / Headcount',  'TODO'],
          ['主要客群 / Target', 'TODO'],
          ['行政痛點 / Pain points', 'TODO']
        ]
      }
      // add Brand B if the course teaches comparison across two contexts
    ],
    roles: [
      // [name, brand, role, description]
      ['TODO: 角色名', 'TODO: 品牌', 'TODO: 職位', 'TODO: 在課程中扮演什麼']
    ],
    variables: [
      // [token, brandA_value, brandB_value]
      ['{店名}', 'TODO', 'TODO']
    ],
    deliverables: [
      // [day_label, output_description]
      ['Day 1', 'TODO: e.g. 個人提示詞庫']
    ]
  },

  // ============================================================
  // day1 — first teaching day
  // ============================================================
  day1: {
    id: 'day1',
    title: 'TODO: Day 1 — theme',
    date: 'TODO: M/D',
    hours: '6 hours',
    learningGoal: 'TODO: One-paragraph day-level outcome.',
    schedule: [
      // [time_range, segment_title, focus]
      ['09:00 ~ 10:00', 'TODO: Opening',         'TODO: Course intro + icebreaker'],
      ['10:00 ~ 12:00', 'TODO: Unit 1',          'TODO: Topic'],
      ['12:00 ~ 13:00', 'Lunch',                  '(self-arranged)'],
      ['13:00 ~ 15:30', 'TODO: Unit 2',          'TODO: Topic'],
      ['15:30 ~ 16:30', 'TODO: Unit 3',          'TODO: Topic']
    ],
    units: [
      {
        id: 'u1',                                 // unique within day; never rename
        title: 'TODO: Unit 1 — title',
        time: '10:00 ~ 12:00',
        goals: [
          'TODO: Action-verb outcome 1',
          'TODO: Action-verb outcome 2',
          'TODO: 3–6 goals total'
        ],
        concepts: [
          {
            heading: 'TODO: Concept heading (plain text, no markdown)',
            body:    'TODO: Narrative paragraph supporting **bold** and [link](url).',
            illustration: 'day1-u1-concept-a',     // optional: PNG-first, SVG fallback
            list: [
              // [key, value] pairs (definition-style)
              ['TODO key', 'TODO value']
            ],
            // OR table for matrix comparisons
            table: {
              head: ['TODO col 1', 'TODO col 2', 'TODO col 3'],
              rows: [
                ['TODO', 'TODO', 'TODO']
              ]
            },
            note: 'TODO: Optional callout / footnote'
          }
        ],
        prompts: [
          {
            id: 'd1-p1',                          // d{N}-p{M} format
            title: 'TODO: Prompt title',
            note:  'TODO: Optional one-line context',
            text: `TODO: Full RTFC prompt text.
角色 (Role): ...
任務 (Task): ...
格式 (Format): ...
限制 (Constraint): ...`
          }
        ],
        tasks: [
          // id is a localStorage key — never rename, never reuse
          { id: 'd1-u1-t1', label: 'TODO: First task description' },
          { id: 'd1-u1-t2', label: 'TODO: Second task' }
        ],
        materials: [
          // type: 'PDF 文件' | 'TEXT' | 'CSV' | 'YAML' | 'MD' | '音檔'
          { id: 'd1-m1', name: 'TODO: Material display name', type: 'TEXT', desc: 'TODO: One-line context' }
        ],
        illustrations: [
          // 1–3 entries — Stage 5 Coverage Floor
          { name: 'day1-u1-hero',    kind: 'hero',    alt: 'TODO: alt text', spec: 'TODO: hero scene description (AI-gen)' },
          { name: 'day1-u1-flow',    kind: 'diagram', alt: 'TODO: alt text', spec: 'TODO: process diagram (hand-drawn SVG)' }
          // OR explicit waiver: { kind: 'waived', reason: 'TODO: why no image needed' }
        ],
        faq: [
          // optional: [question, answer] pairs
          ['TODO: 學員常問的問題', 'TODO: 解答要點']
        ]
      }
      // add more units as the day's schedule requires
    ]
  },

  // ============================================================
  // day2, day3, ... — same shape as day1
  // ============================================================
  // day2: { id: 'day2', ... },

  // ============================================================
  // materials — cross-day material index
  // ============================================================
  // Aggregates ALL unit.materials[] across days for the "下載檔案總覽" section.
  // Same Material schema; same id namespace (d{N}-m{M}); MUST appear in
  // getMaterialUrl() router in index.html (3-place sync rule).
  materials: [
    { id: 'd1-m1', name: 'TODO: Material display name', type: 'TEXT', desc: 'TODO: One-line context' }
  ],

  // ============================================================
  // quiz — optional end-of-course assessment
  // ============================================================
  // Append-only — deleting items forces 5+ hardcoded string updates.
  // Renderer maps q{N} → source day via qIndexToDay() in index.html.
  quiz: [
    {
      id: 'q1',
      type: 'single',
      q: 'TODO: Question 1?',
      options: [
        'TODO: Option 0 (wrong)',
        'TODO: Option 1 (correct)',
        'TODO: Option 2 (wrong)'
      ],
      answer: 1                                   // 0-indexed correct option
    }
    // add more quiz items as needed
  ]
};
