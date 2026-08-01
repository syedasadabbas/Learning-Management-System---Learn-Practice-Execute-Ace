# Curated topic videos — validated candidate pool

Produced by the `research-videos` agent on 2026-07-30 and **independently
re-validated by the coordinator**, because that agent died mid-run on an API
error immediately after claiming its ids were validated and before it could
write this document. A claim of validation from a process that then crashed is
not evidence, so every id below was re-checked from scratch.

## Validation, as actually performed

- **77 entries, 77 unique ids, 34 topics.**
- Every id was fetched from the **keyless oEmbed endpoint**
  (`youtube.com/oembed?url=...&format=json`). A 200 there proves two things at
  once: the video exists, and it permits embedding. A video that exists but
  forbids embedding is useless to us, so existence alone was not accepted.
- **Result: 77/77 returned 200. Zero failures.**
- The live `title` and `author_name` were compared against the values recorded
  in the JSON, to catch a real id attached to the wrong topic. 4 titles differ
  cosmetically (an emoji or a trailing `| Channel` suffix was tidied away). The
  parser ignores `title`/`channel` entirely and the harvester re-fetches both
  from oEmbed at ingest, so these do not affect what a student sees.
- No Google API key was used or needed. `FREE_STACK.md` drops the Data API.

## What is NOT verified

- **`durationSeconds` is unverified.** oEmbed does not carry duration, so the
  agent read it from the public watch page. It is cosmetic — it helps a reviewer
  judge whether a video is a 10-minute explainer or an 11-hour course — and
  nothing computes from it.
- **Pedagogical fit is a human judgement.** oEmbed proves a video is playable,
  not that it teaches the right thing at the right level. That is what the
  approval queue is for.

## Nothing here is live

These land as `candidate` rows in `topic_videos`. Only a row an **admin** has
approved is ever rendered to a student, and approval records who did it and
when. A topic with no approved video keeps the existing, deliberately honest
"video coming soon" placeholder rather than showing a guess.

## The pool

### `web-basics-first-html-document`

| # | Video id | Length | Channel | Title |
|---|---|---|---|---|
| 0 | `kUMe1FH4CHE` | 4h07m | freeCodeCamp.org | Learn HTML – Full Tutorial for Beginners |
| 1 | `UB1O30fR-EE` | 1h00m | Traversy Media | HTML Crash Course For Absolute Beginners |
| 2 | `bWPMSSsVdPk` | 12m16s | Jake Wright | Learn HTML in 12 Minutes |

### `html-semantic-structure`

| # | Video id | Length | Channel | Title |
|---|---|---|---|---|
| 0 | `YOsMJQfwqow` | 9m32s | Kevin Powell | HTML & CSS for Absolute Beginners: Semantic HTML |
| 1 | `pQN-pnXPaVg` | 2h02m | freeCodeCamp.org | HTML Full Course - Build a Website Tutorial |
| 2 | `mU6anWqZJcc` | 11h30m | freeCodeCamp.org | Learn HTML5 and CSS3 From Scratch - Full Course |

### `html-forms-tables-accessibility`

| # | Video id | Length | Channel | Title |
|---|---|---|---|---|
| 0 | `fNcJuPIZ2WE` | 24m55s | Web Dev Simplified | Learn HTML Forms In 25 Minutes |
| 1 | `e2nkq3h1P68` | 1h33m | freeCodeCamp.org | Learn Accessibility - Full a11y Tutorial |
| 2 | `20SHvU2PKsM` | 4m07s | W3C Web Accessibility Initiative (WAI) | Introduction to Web Accessibility and W3C Standards |

### `css-selectors-cascade-specificity`

| # | Video id | Length | Channel | Title |
|---|---|---|---|---|
| 0 | `ftk7nUmVOOw` | 1m55s | Kevin Powell | HTML & CSS for Absolute Beginners: Specificity + Dev tools |
| 1 | `Oh0TplG4nYw` | 11m08s | Kevin Powell | HTML & CSS for Beginners Part 16: CSS selectors and Specificity |
| 2 | `rIO5326FgPE` | 8m22s | Web Dev Simplified | Learn CSS Box Model In 8 Minutes |

### `css-flexbox-and-grid`

| # | Video id | Length | Channel | Title |
|---|---|---|---|---|
| 0 | `JJSoEo8JSnc` | 19m59s | Traversy Media | Flexbox CSS In 20 Minutes |
| 1 | `9zBsdzdE4sM` | 18m34s | Web Dev Simplified | Learn CSS Grid in 20 Minutes |
| 2 | `jV8B24rSN5o` | 27m54s | Traversy Media | CSS Grid Layout Crash Course |

### `css-mobile-first-responsive`

| # | Video id | Length | Channel | Title |
|---|---|---|---|---|
| 0 | `srvUrASNj0s` | 4h11m | freeCodeCamp.org | Introduction To Responsive Web Design - HTML & CSS Tutorial |
| 1 | `fx2YMLPNBA8` | 45m14s | Kevin Geary | PB101: L11 - Responsive Development With Breakpoints & Media Queries (+ CSS Cascade & Specificity) |

### `js-values-types-functions`

| # | Video id | Length | Channel | Title |
|---|---|---|---|---|
| 0 | `PkZNo7MFNFg` | 3h26m | freeCodeCamp.org | Learn JavaScript - Full Course for Beginners |
| 1 | `W6NZfCO5SIk` | 48m17s | Programming with Mosh | JavaScript Course for Beginners – Your First Step to Web Development |
| 2 | `hdI2bqOjy3c` | 1h40m | Traversy Media | JavaScript Crash Course For Beginners |

### `js-arrays-objects-dom`

| # | Video id | Length | Channel | Title |
|---|---|---|---|---|
| 0 | `y17RuWkWdn8` | 18m37s | Web Dev Simplified | Learn DOM Manipulation In 18 Minutes |
| 1 | `5fb2aPlgoys` | 2h41m | freeCodeCamp.org | JavaScript DOM Manipulation – Full Course for Beginners |
| 2 | `0ik6X4DJKCc` | 39m01s | Traversy Media | JavaScript DOM Crash Course - Part 1 |

### `js-events-and-async`

| # | Video id | Length | Channel | Title |
|---|---|---|---|---|
| 0 | `XF1_MlZ5l6M` | 18m03s | Web Dev Simplified | Learn JavaScript Event Listeners In 18 Minutes |
| 1 | `PoRJizFvM7s` | 24m30s | Traversy Media | Async JS Crash Course - Callbacks, Promises, Async Await |
| 2 | `V_Kr9OSfDeU` | 7m31s | Web Dev Simplified | JavaScript Async Await |

### `git-fundamentals`

| # | Video id | Length | Channel | Title |
|---|---|---|---|---|
| 0 | `RGOj5yH7evk` | 1h08m | freeCodeCamp.org | Git and GitHub for Beginners - Crash Course |
| 1 | `8JJ101D3knE` | 1h09m | Programming with Mosh | Git Tutorial for Beginners: Learn Git in 1 Hour |
| 2 | `USjZcfj8yxE` | 15m58s | Colt Steele | Learn Git In 15 Minutes |

### `git-branching-pull-requests`

| # | Video id | Length | Channel | Title |
|---|---|---|---|---|
| 0 | `e2IbNHi4uCI` | 33m19s | freeCodeCamp.org | Git Branches Tutorial |
| 1 | `8lGpZkjnkt4` | 1m52s | Fireship | GitHub Pull Request in 100 Seconds - Git a FREE sticker |
| 2 | `SWYqp7iY_Tc` | 32m42s | Traversy Media | Git & GitHub Crash Course For Beginners |

### `deployment-going-live`

| # | Video id | Length | Channel | Title |
|---|---|---|---|---|
| 0 | `oIsf9zE-TRI` | 7m33s | Vercel | Deploying a simple website to Vercel (HTML, CSS, JavaScript) |
| 1 | `VwJ1PTLTxoY` | 25m10s | Click Aur Fix | How to Deploy Your Website for Free on GitHub Pages, Vercel, and Netlify \| Quick & Easy Guide |
| 2 | `Z1A_myx3zuE` | 7m02s | Ali Solanki | How to Host a Website on Github Pages & Vercel? (FREE) |

### `oop-fundamentals`

| # | Video id | Length | Channel | Title |
|---|---|---|---|---|
| 0 | `wN0x9eZLix4` | 1h30m | freeCodeCamp.org | Object Oriented Programming (OOP) in C++ Course |
| 1 | `EazrhHMySQw` | 2h49m | CodeBeauty | C# OOP Full Course: Master Object-Oriented Programming (OOP) with Practical Examples |
| 2 | `m1fJjNLzRag` | 3h22m | Codaming - Simplified Learning | Object Oriented Programming OOP in C++ \| C++ Tutorial Beginners |

### `oop-python`

| # | Video id | Length | Channel | Title |
|---|---|---|---|---|
| 0 | `Ej_02ICOIgs` | 2h12m | freeCodeCamp.org | Object Oriented Programming with Python - Full Course for Beginners |
| 1 | `iLRZi0Gu8Go` | 2h36m | freeCodeCamp.org | Python Object Oriented Programming (OOP) - Full Course for Beginners |
| 2 | `xEZkR9BFXOI` | 5h03m | Alpha Brains Courses | Python Object Oriented Programming - Full Course For Beginners |

### `oop-javascript`

| # | Video id | Length | Channel | Title |
|---|---|---|---|---|
| 0 | `PFmuCDHHpwk` | 1h02m | Programming with Mosh | Object-oriented Programming in JavaScript: Made Super Simple \| Mosh |

### `dbms-sql-basics`

| # | Video id | Length | Channel | Title |
|---|---|---|---|---|
| 0 | `HXV3zeQKqGY` | 4h20m | freeCodeCamp.org | SQL Tutorial - Full Database Course for Beginners |
| 1 | `7S_tz1z_5bA` | 3h10m | Programming with Mosh | SQL Course for Beginners [Full Course] |

### `dbms-database-design`

| # | Video id | Length | Channel | Title |
|---|---|---|---|---|
| 0 | `ztHopE5Wnpc` | 8h07m | freeCodeCamp.org | Database Design Course - Learn how to design and plan a database for beginners |

### `dbms-normalization`

| # | Video id | Length | Channel | Title |
|---|---|---|---|---|
| 0 | `GFQaEYEc8_8` | 28m34s | Decomplexify | Learn Database Normalization - 1NF, 2NF, 3NF, 4NF, 5NF |
| 1 | `Ds7PGmtX7Ww` | 1h54m | Mona Nasery | Database Normalization Explained: 1NF, 2NF, 3NF with Real Examples \| Full Lecture – York University |
| 2 | `FzVCGou8SMA` | 3m33s | DbSchema Database Designer | Learn Database Normalization Fast \| 1NF, 2NF, 3NF Explained Simply (2025) |

### `dsa-fundamentals`

| # | Video id | Length | Channel | Title |
|---|---|---|---|---|
| 0 | `8hly31xKli0` | 5h22m | freeCodeCamp.org | Algorithms and Data Structures Tutorial - Full Course for Beginners |
| 1 | `pkYVOmU3MgA` | 12h30m | freeCodeCamp.org | Data Structures and Algorithms in Python - Full Course for Beginners |

### `dsa-data-structures`

| # | Video id | Length | Channel | Title |
|---|---|---|---|---|
| 0 | `RBSGKlAvoiM` | 8h03m | freeCodeCamp.org | Data Structures Easy to Advanced Course - Full Tutorial from a Google Engineer |
| 1 | `zg9ih6SVACc` | 2h59m | freeCodeCamp.org | Data Structures - Computer Science Course for Beginners |

### `dsa-big-o-complexity`

| # | Video id | Length | Channel | Title |
|---|---|---|---|---|
| 0 | `BgLTDT03QtU` | 20m37s | NeetCode | Big-O Notation - For Coding Interviews |
| 1 | `D6xkbGLQesk` | 36m22s | CS Dojo | Introduction to Big O Notation and Time Complexity (Data Structures & Algorithms #7) |

### `prompt-engineering-basics`

| # | Video id | Length | Channel | Title |
|---|---|---|---|---|
| 0 | `_ZvnD73m40o` | 41m36s | freeCodeCamp.org | Prompt Engineering Tutorial – Master ChatGPT and LLM Responses |
| 1 | `2BpCk4d2Cc0` | 37m44s | Tech With Tim | Prompt Engineering Full Course |
| 2 | `YhRfgYH_AoU` | 59m16s | The iScale | Prompt Engineering Full Course \| From Beginner to Pro |

### `prompt-engineering-for-developers`

| # | Video id | Length | Channel | Title |
|---|---|---|---|---|
| 0 | `ScKCy2udln8` | 3h13m | freeCodeCamp.org | Prompt Engineering for Web Devs - ChatGPT and Bard Tutorial |

### `claude-usage-basics`

| # | Video id | Length | Channel | Title |
|---|---|---|---|---|
| 0 | `H6LchswC74Y` | 3h22m | Kilo Loco | Claude AI 101: The Complete Beginner's Guide (Full Course Walkthrough) |
| 1 | `kyB68hS-vco` | 14m09s | Learn With Shopify | The Complete Claude Anthropic Tutorial |

### `claude-code-workflow`

| # | Video id | Length | Channel | Title |
|---|---|---|---|---|
| 0 | `gh2_PhgZGsM` | 4h27m | freeCodeCamp.org | Claude Code for Beginners Tutorial [Full Course] |
| 1 | `LIEuGD0pJ18` | 11m03s | Jack Roberts | Full Claude Code Tutorial: Beginner to Advanced in 11 Minutes |

### `llm-apps-rag-basics`

| # | Video id | Length | Channel | Title |
|---|---|---|---|---|
| 0 | `sVcwVQRHIc8` | 2h33m | freeCodeCamp.org | Learn RAG From Scratch – Python AI Tutorial from a LangChain Engineer |
| 1 | `o126p1QN_RI` | 2h08m | Krish Naik | Complete RAG Crash Course With Langchain In 2 Hours |

### `llm-apps-production-rag`

| # | Video id | Length | Channel | Title |
|---|---|---|---|---|
| 0 | `mHxLXzYjQRE` | 7h38m | freeCodeCamp.org | Production RAG with LangChain & Vector Databases – Full Course |

### `cryptography-public-key`

| # | Video id | Length | Channel | Title |
|---|---|---|---|---|
| 0 | `GSIDS_lvRv4` | 6m20s | Computerphile | Public Key Cryptography - Computerphile |
| 1 | `4zahvcJ9glg` | 8m40s | Eddie Woo | The RSA Encryption Algorithm (1 of 2: Computing an Example) |

### `cryptography-symmetric-aes`

| # | Video id | Length | Channel | Title |
|---|---|---|---|---|
| 0 | `O4xNJsjtN6E` | 14m14s | Computerphile | AES Explained (Advanced Encryption Standard) - Computerphile |
| 1 | `VYech-c5Dic` | 9m10s | Computerphile | One Encryption Standard to Rule Them All! - Computerphile |

### `cryptography-hashing`

| # | Video id | Length | Channel | Title |
|---|---|---|---|---|
| 0 | `b4b8ktEV4Bg` | 8m12s | Computerphile | Hashing Algorithms and Security - Computerphile |

### `cryptography-key-exchange`

| # | Video id | Length | Channel | Title |
|---|---|---|---|---|
| 0 | `NmM9HA2MQGI` | 8m40s | Computerphile | Secret Key Exchange (Diffie-Hellman) - Computerphile |
| 1 | `jkV1KEJGKRA` | 8m12s | Computerphile | End to End Encryption (E2EE) - Computerphile |

### `cybersecurity-fundamentals`

| # | Video id | Length | Channel | Title |
|---|---|---|---|---|
| 0 | `inWWhr5tnEA` | 7m07s | Simplilearn | What Is Cyber Security \| How It Works? \| Cyber Security In 7 Minutes |
| 1 | `7rG9tWvPG2E` | 6h59m | Simplilearn | Cyber Security Course 2026 [FREE] \| Cyber Security Full Course For Beginners 2026 |
| 2 | `z2hVCeiwvGk` | 9h27m | Intellipaat | Cyber Security Full Course 2026 (Free) \| Cyber Security Course for Beginners |

### `cybersecurity-tls-https`

| # | Video id | Length | Channel | Title |
|---|---|---|---|---|
| 0 | `0TLDTodL7Lc` | 15m33s | Computerphile | Transport Layer Security (TLS) - Computerphile |

### `cybersecurity-web-vulnerabilities`

| # | Video id | Length | Channel | Title |
|---|---|---|---|---|
| 0 | `rWHvp7rUka8` | 8m22s | F5 DevCentral Community | 2017 OWASP Top 10: Injection Attacks |

## Coverage gaps

Only topics with at least one validated candidate appear above. Any lecture or
module whose `topicKey` is absent has no video and will render the placeholder.
Cross-check this list against `lectures.topic_key` and the module ladders in
`docs/research/CURRICULUM_PLAN.md` before assuming a track is covered.
