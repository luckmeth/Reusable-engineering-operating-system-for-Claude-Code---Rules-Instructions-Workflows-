# CECC — PREMIUM PRODUCT UI/UX TRANSFORMATION PROMPT

You are now responsible for transforming the existing CECC application into a **premium, modern, highly polished developer product**.

The current application works technically, but the interface currently feels like:

* a generic admin dashboard
* a collection of static cards
* a traditional Electron application
* an internal developer tool
* visually flat
* low-information-density in the wrong places
* lacking visual feedback
* lacking motion
* lacking clear interaction hierarchy
* lacking a strong product identity

This must change.

Do NOT simply improve the existing CSS.

Do NOT add a few gradients and call it redesigned.

Do NOT preserve the current layout just because it already exists.

Perform a genuine product-level UI/UX transformation.

The result must feel like a **premium commercial developer application**, comparable in polish to modern products such as high-end code editors, observability platforms, AI developer tools, and security consoles.

CECC should feel like a product people intentionally open because it gives them useful situational awareness while Claude Code is working.

---

# 1. PRODUCT IDENTITY

CECC is:

**Claude Engineering Control Center**

It is an engineering command center surrounding AI-assisted software development.

The product is not a generic dashboard.

The core experience is:

> "See what the AI is doing, understand what changed, know what is unsafe, understand what remains, and know whether the project is actually ready."

The interface must visually communicate:

* live activity
* workflow state
* development progress
* security state
* engineering health
* detected mistakes
* agent shortcuts
* test state
* code changes
* remaining work

The product should feel:

* intelligent
* precise
* calm
* technical
* premium
* responsive
* trustworthy
* fast
* deliberate

Avoid:

* excessive neon
* childish animations
* excessive gradients
* giant empty cards
* random glowing effects
* dashboard clutter
* generic SaaS templates
* excessive rounded rectangles
* excessive text
* meaningless charts
* fake AI "magic" effects

This is an engineering product, not a gaming UI.

---

# 2. IMPORTANT: STUDY THE EXISTING APPLICATION FIRST

Before modifying anything:

1. Inspect the entire current frontend architecture.
2. Identify the framework.
3. Identify the Electron architecture.
4. Identify current routing/navigation.
5. Identify existing reusable components.
6. Identify current state management.
7. Identify event/data sources.
8. Identify which information is real and which is placeholder.
9. Identify current IPC boundaries.
10. Identify current Claude Code integration.
11. Identify existing CSS/design system.
12. Identify existing animations, if any.
13. Identify existing tests.

Then create a concise UI transformation plan.

Do not destroy working backend functionality.

Preserve existing business logic and data flows unless a UI architecture change genuinely requires changes.

---

# 3. THE APPLICATION MUST STOP LOOKING LIKE A DEFAULT ELECTRON WINDOW

The current interface visibly feels like a desktop Electron wrapper.

Fix this.

Implement a modern custom application shell.

Where technically safe and supported:

* use a frameless/custom titlebar
* create a custom draggable titlebar region
* preserve native minimize/maximize/close controls
* create CECC application controls rather than relying on browser-looking chrome
* ensure Windows usability
* preserve keyboard accessibility
* preserve window resizing
* preserve system-level safety
* do not break Electron security configuration

The titlebar should feel like part of the product.

Possible structure:

[ CECC logo ] [ Project ] [ Session status ]          [ Search ] [ Notifications ] [ Window controls ]

Do not recreate a fake OS window.

The application should feel like a purpose-built engineering product.

---

# 4. GLOBAL VISUAL LANGUAGE

Create a cohesive design system.

Use a sophisticated dark theme.

Base palette:

* near-black background
* deep graphite surfaces
* slightly lighter elevated surfaces
* subtle borders
* high-contrast primary text
* muted secondary text
* restrained Slash red accent
* success green
* warning amber
* danger red
* informational blue

Do NOT saturate the entire interface with accent colors.

Accent should communicate meaning.

Use color primarily for:

* state
* severity
* selected navigation
* important actions
* active workflow
* security findings
* live indicators

Use typography with strong hierarchy.

Suggested hierarchy:

Display
Page title
Section heading
Card/panel heading
Body
Secondary
Metadata
Technical/micro text

Use tabular numerals where useful for:

* durations
* counts
* timestamps
* tokens
* test counts
* event IDs

---

# 5. SURFACES

Stop making every section look like a card.

Use multiple surface types:

1. App background
2. Elevated panel
3. Glass/subtle overlay panel
4. Embedded tool panel
5. Timeline surface
6. Interactive row
7. Popover
8. Drawer
9. Modal
10. Command surface

Panels should have:

* subtle border
* very restrained shadow
* consistent radius
* clear hierarchy

Avoid:

"everything is a card."

A premium UI should use composition rather than endless boxes.

---

# 6. SPACING AND GRID

The existing UI contains large areas of unused space while simultaneously compressing important information.

Fix this.

Create a deliberate responsive layout system.

Desktop-first.

Suggested:

* 8px spacing system
* max content width
* consistent page gutters
* stronger horizontal composition
* dense information regions
* breathing room only where it helps comprehension

Do not unnecessarily center every element.

Use the screen width intelligently.

---

# 7. PRIMARY APPLICATION SHELL

Replace the current top-heavy navigation with a more professional structure.

Preferred structure:

LEFT SIDEBAR

* Overview
* Workflow
* Activity
* Fixes
* Security
* Tests
* Git
* Dependencies
* Sessions
* Controls
* Learning
* Claude Code

CENTER CONTENT

* current page

OPTIONAL RIGHT CONTEXT PANEL

* selected event
* security finding
* workflow details
* file changes
* activity details

The left sidebar should:

* collapse
* remember state
* support tooltips
* visually indicate the current page
* show contextual counts
* show critical issue indicators
* animate smoothly

Do NOT use excessive sidebar text.

---

# 8. GLOBAL TOP BAR

The top bar should contain useful global information.

Example:

CECC
Slash Browser
● Claude running
branch: main
2 issues
build: passing

Right side:

Search
Command palette
Notifications
Project selector
Settings
Window controls

The current project should always be visible.

The user must immediately know:

"What project am I monitoring?"

---

# 9. COMMAND PALETTE

Add a professional command palette.

Keyboard shortcut:

Ctrl/Cmd + K

It should allow:

* navigate pages
* search files
* search findings
* search sessions
* run security scan
* run tests
* start/stop monitoring
* change workflow stage
* open project
* open terminal
* inspect latest event
* filter activity
* change UI appearance/settings

The command palette should animate in/out smoothly.

It should feel premium.

---

# 10. OVERVIEW PAGE

The Overview page is the most important screen.

It must NOT be a generic set of KPI cards.

Create a true engineering command center.

Structure:

TOP:

Project identity
Current task
Claude status
Current branch
Current environment

MAIN:

LIVE WORKFLOW

DISCOVER
→ UNDERSTAND
→ INSPECT
→ PLAN
→ IMPLEMENT
→ TEST
→ SECURITY
→ REVIEW
→ READY
→ DEPLOY
→ VERIFY

The current stage should be visually active.

Completed stages should communicate completion.

Upcoming stages should remain quiet.

Blocked stages should be visually obvious.

The workflow must animate when the actual state changes.

---

# 11. LIVE ENGINEERING AREA

Below workflow, create a live command-center area.

Possible layout:

LEFT:
Live activity timeline

CENTER:
Current agent activity / operation

RIGHT:
Current engineering state

Example:

CURRENTLY WORKING

Implementing authentication middleware

Files:
auth.ts
session.ts
middleware.ts

Activity:
READ
EDIT
COMMAND
TEST

Progress:
4 / 7 acceptance checks

Then:

CURRENT RISK

No critical findings
1 warning
2 checks pending

This is much more valuable than static cards.

---

# 12. LIVE ACTIVITY SHOULD FEEL ALIVE

The activity panel must visually communicate that the system is operating.

When a real event occurs:

* new event enters with subtle slide/fade
* live indicator pulses
* timeline marker animates
* status icon changes
* relevant counters update
* workflow may transition
* affected panel can briefly highlight

Do NOT create fake activity.

Animations must be tied to real state changes.

When nothing is happening:

The UI should remain calm.

Do not continuously animate everything.

---

# 13. LIVE CLAUDE SESSION

The current Claude Code terminal-style area can remain available, but it should no longer dominate the dashboard.

Move it into:

Claude Code
or
Live Agent

screen/panel.

Redesign it visually.

It should feel like a premium integrated agent workspace rather than an embedded raw terminal.

Display:

Agent
Model
Session
Current operation
Current task
Runtime
Tool activity

Then the terminal/event stream.

Add:

* automatic scroll control
* pause
* follow live output
* search
* filter
* command grouping
* collapsible command blocks
* expandable tool events

---

# 14. "WHAT NEEDS FIXING" MUST BECOME A CORE PRODUCT FEATURE

The current implementation treats findings almost like another small card.

That is wrong.

Make this a major workflow feature.

Create a dedicated:

FIX CENTER

The purpose:

"What could prevent me from shipping this?"

Show:

CRITICAL
HIGH
MEDIUM
LOW
INFORMATIONAL

Each finding should have a strong visual hierarchy.

Example:

HIGH
Authorization check missing

src/api/projects/[id]/route.ts:42

Why this matters

The route accepts a project ID supplied by the client but does not verify ownership.

Evidence

POST request
tenant_id from client
missing server-side authorization check

Detected by

ACCESS-003

Status

OPEN

Actions:

Inspect
Show diff
Show related test
Mark resolved
Suppress with reason

This is a real product experience.

---

# 15. FINDING DETAILS DRAWER

Clicking a finding should open a premium right-side drawer.

The drawer should contain:

Title
Severity
Confidence
Status
Evidence
Affected files
Affected lines
Related events
Related tests
Related commits
Detection rule
Impact
Recommended fix
History

Do not navigate away unnecessarily.

Use animated drawers with proper focus management.

---

# 16. SECURITY CENTER

Create a powerful security-focused screen.

Sections:

Application Security
Agent Security
CECC Security

Show actual findings.

Also show:

New since last session
Resolved
Accepted risk
Suppressed
Blocked
Unverified

Security findings should be linked to:

* code
* git diff
* commands
* tests
* workflow stages

Make security feel integrated into development instead of a separate scanner bolted onto the application.

---

# 17. AGENT SHORTCUTS

Create a dedicated screen:

AGENT SHORTCUTS

Examples:

Test bypass detected
Validation bypass
Security control removed
Authorization shortcut
Unsafe shell command
Dangerous dependency operation
Test weakening
Error suppression
CECC bypass attempt

Each shortcut should explain:

WHAT HAPPENED
WHY IT MATTERS
EVIDENCE
WHAT SHOULD HAVE HAPPENED

This screen should feel like a professional security/engineering analysis interface.

---

# 18. WORKFLOW SCREEN

Create a highly visual workflow experience.

Instead of a vertical text list, create a timeline/state-machine visualization.

Example:

┌ DISCOVER ─── ✓
│
┌ UNDERSTAND ─ ✓
│
┌ INSPECT ──── ✓
│
┌ PLAN ─────── ✓
│
┌ IMPLEMENT ── ● NOW
│
┌ TEST ─────── ○
│
┌ SECURITY ─── ○
│
┌ REVIEW ───── ○
│
┌ READY ────── LOCKED

The current stage should have subtle movement.

Completed stages should have an elegant confirmation transition.

Blocked stages should communicate exactly why.

---

# 19. PROGRESS SCREEN

The Progress page should answer:

"What has actually been accomplished?"

Include:

Current task
Acceptance criteria
Completed work
Remaining work
Blocked work
Files changed
Tests added
Tests passed
Security checks
Commits
Time spent

Use progress visualization where useful.

Do not use circular percentage meters everywhere.

---

# 20. HISTORY / SESSION REPLAY

Build a polished session history interface.

Each session:

Project
Branch
Start
Duration
Changes
Tests
Findings
Outcome

Clicking one opens a session replay.

Show:

Task started
Files inspected
Changes
Commands
Failures
Fixes
Tests
Security analysis
Commit
Final state

The timeline should feel like a recorded engineering session.

---

# 21. LEARNING PAGE

CECC should learn from repeated development patterns.

Show:

Frequent agent shortcuts
Repeated failures
Recurring security issues
Recurring files
Common test failures
Repeated inefficient operations
Frequent workflow bottlenecks

Do not label something a "learning" unless supported by historical data.

---

# 22. CONTROLS / POLICY CENTER

Make controls a first-class screen.

Categories:

Agent permissions
Security rules
Protected files
Workflow gates
Enforcement modes
Scanner settings
Privacy
Cloud sync
Retention
Notifications

For each rule:

Name
Description
Mode
Scope
Last triggered
Trigger count

Modes:

Observe
Warn
Block

Use clear explanations.

---

# 23. CLAUDE CODE PAGE

Create a dedicated Claude Code page.

Display:

Installed version
Integration state
Hook state
Connected sessions
Supported events
Permissions
Agent status
Recent tool activity

Add integration health:

CONNECTED
PARTIAL
NOT CONNECTED
ERROR

Do not invent capabilities.

Display what CECC actually detects.

---

# 24. MICROINTERACTIONS

Introduce carefully designed microinteractions.

Examples:

Button hover
Button press
Sidebar selection
Panel expansion
Drawer opening
Modal opening
Tabs
Tooltips
Copy action
Finding resolution
Workflow transition
Status change
Toast notifications
Search results
Command palette
Filter changes
Live event arrival

Animations should be:

fast
smooth
subtle
purposeful

Preferred timing:

100ms–150ms:
microinteraction

180ms–250ms:
panel/button transitions

250ms–400ms:
larger layout transitions

Avoid sluggish 600ms+ interface transitions except for deliberate visual sequences.

---

# 25. ANIMATION SYSTEM

Use a proper animation system.

Prefer:

Motion / Framer Motion

or the project's existing equivalent.

Create shared motion primitives.

Examples:

FadeIn
SlideIn
ScaleIn
Stagger
Presence
LayoutTransition
Pulse
StatusTransition

Do not individually invent animation timing in every component.

Centralize motion tokens.

Support:

prefers-reduced-motion

When reduced motion is enabled:

* remove large movement
* preserve state changes
* maintain usability

---

# 26. WORKFLOW ANIMATION

The workflow must have the strongest animation.

When transitioning:

IMPLEMENT
→ TEST

show:

current node transitions
connection activates
status updates
related checks appear

When blocked:

TEST
→ BLOCKED

animate the state change subtly.

When a security finding arrives:

SECURITY REVIEW
→ WARNING

the workflow should visibly respond.

This makes the application feel intelligent because the visuals reflect real events.

---

# 27. REAL-TIME STATE

Do not create fake animations.

Everything should react to actual application state.

Examples:

Claude starts:
status changes to active

Claude stops:
status becomes idle

Test starts:
test state changes to running

Test fails:
warning/error state appears

Security scan starts:
security state becomes analyzing

Finding detected:
finding appears

Finding resolved:
finding transitions to resolved

Git changes:
changed file count updates

Workflow changes:
workflow animation occurs

This application should feel alive because the underlying system is alive.

---

# 28. LOADING STATES

Build high-quality loading states.

Never show empty black boxes.

Use:

* skeletons
* progress indicators
* contextual loading labels

Example:

Analyzing changed files…

instead of:

Loading...

Make loading states informative.

---

# 29. EMPTY STATES

Empty states must be useful.

Bad:

"No data"

Better:

"No security findings detected in the observed changes."

Secondary:

"CECC has not found a matching rule. This does not prove the project is secure."

Include contextual actions:

Run scan
Open security rules
Inspect recent changes

---

# 30. SCROLLBARS

Redesign all scrollbars.

The current default-looking scrollbar contributes heavily to the "Electron" feeling.

Implement premium custom scrollbars.

Requirements:

* thin
* subtle
* low visual noise
* smooth hover state
* appropriate dark-mode contrast
* consistent across panels
* not gigantic
* hidden when unnecessary where appropriate

Use:

scrollbar-width
::-webkit-scrollbar
::-webkit-scrollbar-thumb
::-webkit-scrollbar-track

where applicable.

Do not make scrollbars bright white.

Do not make scrollbars visually dominant.

---

# 31. TABLES

Avoid generic HTML tables.

Create premium data-table patterns.

Use:

* sticky headers
* compact rows
* row hover state
* clear severity indicators
* inline actions
* sort controls
* filtering
* pagination/virtualization where required

Clicking a row should reveal more detail.

---

# 32. TYPOGRAPHY

Use a professional UI font.

Prefer an existing system with strong rendering rather than adding unnecessary font dependencies.

Technical data can use a monospace font where useful.

Examples:

commands
file paths
rule IDs
event IDs
hashes
code fragments
timestamps when appropriate

Do not make the entire application monospace.

That would make it feel like a terminal rather than a premium product.

---

# 33. ICONOGRAPHY

Use one coherent icon system.

Prefer Lucide or the existing project icon library.

Never mix random icon styles.

Icons should communicate:

Security
Workflow
Git
Tests
Terminal
Files
Agent
Settings
Warning
Success
Info

Do not use icons as decoration everywhere.

---

# 34. REDUCE VISUAL NOISE

The current application has too many "small boxes."

Reduce card count.

Group related information.

Use hierarchy:

Primary
Secondary
Contextual

not:

Everything equally important

The user must know what deserves attention in less than 2 seconds.

---

# 35. INFORMATION DENSITY

CECC is a professional developer tool.

It should be information-dense without being cramped.

Prefer:

dense rows
interactive details
drawers
tooltips
progressive disclosure

over:

huge cards with tiny amounts of information.

---

# 36. DASHBOARD RESPONSIVENESS

Although this is a desktop application, handle different window sizes properly.

Support:

1280px
1440px
1600px
1920px
ultrawide

At smaller widths:

* collapse secondary panels
* preserve primary workflow
* allow drawers
* avoid horizontal overflow

Do not simply shrink everything.

---

# 37. KEYBOARD UX

Add serious keyboard support.

Examples:

Ctrl/Cmd + K
Search

Ctrl/Cmd + 1
Overview

Ctrl/Cmd + 2
Workflow

Ctrl/Cmd + 3
Activity

Esc
Close drawer/modal

/
Focus search

Space
Pause live stream where appropriate

Arrow keys
Navigate lists

Enter
Open selected item

Do not hijack common operating-system/browser shortcuts unnecessarily.

---

# 38. TOOLTIPS

Use tooltips for:

* unfamiliar icons
* status indicators
* technical values
* shortened labels

Do not use tooltips for essential information that should be visible.

---

# 39. TOAST SYSTEM

Build a polished notification system.

Examples:

Security scan completed
3 findings detected

Tests completed
128 passed / 2 failed

Finding resolved

Workflow blocked

Claude session started

Do not spam notifications for every low-value event.

---

# 40. CONTEXTUAL RIGHT PANEL

Create a universal right-side detail drawer system.

The same system should work for:

* events
* findings
* tests
* files
* commits
* workflow stages
* tasks

Click an item.

Open contextual details without abandoning the current page.

This is important for developer productivity.

---

# 41. CODE / DIFF VIEW

Create a premium embedded diff viewer.

Features:

* syntax highlighting
* line numbers
* additions/deletions
* file navigation
* collapsible hunks
* search
* related findings
* related tests

When a security finding references a line:

clicking the finding should jump directly to the relevant code.

This is a major usability feature.

---

# 42. SECURITY + DIFF CORRELATION

Create the experience:

Finding
↓
Affected file
↓
Affected line
↓
Git change
↓
Agent event
↓
Test result
↓
Recommended fix

This should be visually connected.

Do not force the developer to manually cross-reference five different screens.

---

# 43. VISUAL STATUS LANGUAGE

Create a unified status system.

Examples:

ACTIVE
RUNNING
ANALYZING
WAITING
PASSED
WARNING
FAILED
BLOCKED
RESOLVED
VERIFIED
UNKNOWN

Each state must have:

* icon
* label
* visual treatment
* optional animation

Use consistent state semantics throughout the application.

---

# 44. DO NOT CREATE FAKE AI UI

Absolutely avoid things such as:

"AI is thinking..."

"Magic happening..."

fake neural-network animations

fake token counters

fake streaming

fake agent actions

fake security scores

If CECC did not observe it, do not visualize it as fact.

Visual polish must never compromise trust.

---

# 45. SECURITY INFORMATION MUST REMAIN HONEST

Examples:

GOOD:

"No matching security rule fired."

NOT:

"Project secure."

GOOD:

"Tests passed: 128"

NOT:

"Fully tested."

GOOD:

"CECC observed 42 events."

NOT:

"AI activity fully monitored."

Always represent limitations accurately.

---

# 46. PERFORMANCE

The UI must remain smooth during high activity.

Potentially hundreds or thousands of events may arrive.

Implement:

* event virtualization
* memoization where justified
* incremental rendering
* debounced searches
* efficient state updates
* batched event updates
* throttled visual updates
* lazy-loaded heavy screens

Do not rerender the entire dashboard for every event.

The live activity interface must remain responsive while Claude is actively working.

---

# 47. DESIGN THE APPLICATION AROUND REAL USE CASES

Test the UX around these scenarios:

SCENARIO 1
Claude is implementing a feature.

The developer opens CECC.

Can they understand what Claude is doing immediately?

SCENARIO 2
Claude introduces a security issue.

Can the developer see:

what changed
why it matters
where it happened
how it was detected
what should be fixed

within seconds?

SCENARIO 3
Claude completes the task but tests are failing.

Does CECC clearly communicate:

NOT READY

and why?

SCENARIO 4
Claude bypasses a Git hook.

Does CECC show the exact event and consequence?

SCENARIO 5
The project is idle.

Does CECC feel calm rather than artificially animated?

SCENARIO 6
The developer wants to inspect yesterday's session.

Can they do it quickly?

SCENARIO 7
The developer clicks a finding.

Can they move from:

finding
→ code
→ diff
→ test
→ agent action

without losing context?

---

# 48. INTERACTION QUALITY

Every interactive element must have:

* hover
* focus
* active
* disabled
* loading
* error state where applicable

Do not create dead-looking controls.

Buttons must feel clickable.

Tabs must visually communicate selection.

Navigation must feel immediate.

---

# 49. PAGE TRANSITIONS

Add polished page transitions.

Do not use dramatic animations.

Use:

fade
subtle slide
shared layout transition

Keep the interface feeling immediate.

Avoid making the user wait for animation.

---

# 50. RESPONSIVE DRAWERS AND MODALS

Drawers:

* slide from edge
* background dimming
* proper focus trap
* Esc closes
* clicking backdrop closes where safe

Modals:

* subtle scale/fade
* focus management
* accessible labels

No abrupt browser-default dialogs.

---

# 51. PREMIUM DETAILS

Add subtle details that make the application feel finished:

* animated live-dot
* activity counters that smoothly transition
* subtle panel separators
* hover lighting
* contextual highlight
* command badges
* keyboard shortcut hints
* smart truncation
* timestamps
* relative time display
* copy buttons
* status icons
* sticky contextual controls
* intelligently collapsing panels

These must remain restrained.

---

# 52. NO GENERIC DASHBOARD TEMPLATE

Do not use the common:

Card
Card
Card
Card

layout.

CECC is not:

Stripe dashboard
Admin panel
CRM
Analytics dashboard

It is an:

ENGINEERING CONTROL CENTER

---

# 53. VISUAL COMPOSITION

The Overview page should visually feel closer to:

an observability control room

combined with:

an AI coding workspace

combined with:

a security console

combined with:

a developer productivity tool

rather than a business dashboard.

---

# 54. UI ARCHITECTURE

Create reusable components such as:

AppShell
CustomTitleBar
Sidebar
TopBar
CommandPalette
StatusPill
LiveIndicator
WorkflowRail
WorkflowNode
ActivityTimeline
ActivityRow
FindingCard
FindingDrawer
SecuritySummary
TestStatus
GitStatus
ProjectStatus
TaskProgress
SessionReplay
DiffViewer
RightContextPanel
Toast
Tooltip
EmptyState
Skeleton
Modal
Tabs
DataTable

Do not duplicate UI patterns across pages.

---

# 55. DESIGN TOKENS

Create centralized design tokens for:

colors
spacing
radii
shadows
borders
typography
motion
z-index
breakpoints

Do not scatter magic numbers throughout the application.

Make the design system easy to evolve.

---

# 56. ANIMATION TOKENS

Create shared motion values.

Example:

fast
150ms

normal
220ms

slow
350ms

spring
for panels/layout

pulse
for active live indicators

Do not animate every property.

Prefer:

opacity
transform
layout

over expensive effects.

---

# 57. ACCESSIBILITY

Premium UI also means accessible UI.

Implement:

* keyboard navigation
* focus states
* ARIA labels
* accessible dialogs
* accessible drawers
* contrast
* reduced motion
* screen-reader-friendly status updates where appropriate

Do not sacrifice accessibility for visuals.

---

# 58. ELECTRON SECURITY

While redesigning the shell, do NOT weaken Electron security.

Preserve or improve:

contextIsolation
sandboxing where appropriate
preload isolation
IPC validation
command validation
navigation restrictions
external URL handling
CSP
secure storage

Do not expose Node APIs directly to renderer code.

Do not solve UI problems by disabling Electron security features.

---

# 59. DO NOT BREAK THE CORE APPLICATION

Before each significant change:

inspect dependencies
inspect state
inspect IPC
inspect data flow

Do not rewrite backend functionality just to make a frontend animation work.

Separate:

UI state

from:

engineering state

The visual system must consume real application state.

---

# 60. REAL DATA ONLY

The redesign must use existing real CECC data.

Do NOT add:

hardcoded fake events
random numbers
fake progress
fake token counts
fake Claude activity
fake findings

For empty environments, implement beautiful empty states.

Do not disguise missing data as activity.

---

# 61. MIGRATION STRATEGY

Do not attempt to rewrite all pages in one giant uncontrolled change.

Use this sequence:

PHASE 1
Design system

PHASE 2
App shell / Electron shell

PHASE 3
Navigation / sidebar / top bar

PHASE 4
Overview / Control Center

PHASE 5
Live activity

PHASE 6
Workflow visualization

PHASE 7
Findings / Security

PHASE 8
Session replay

PHASE 9
Controls / settings

PHASE 10
microinteractions / performance / accessibility

PHASE 11
final visual polish

After every major phase:

* run the application
* inspect screenshots
* test interactions
* inspect console
* run tests
* fix regressions

---

# 62. VISUAL QA LOOP

This is REQUIRED.

Do not assume the implementation looks good just because code compiles.

After each major UI phase:

1. run the application
2. take screenshots
3. inspect the screenshots
4. compare against the target design principles
5. identify:

   * spacing problems
   * alignment problems
   * empty areas
   * inconsistent typography
   * weak hierarchy
   * awkward animations
   * excessive borders
   * excessive cards
   * inconsistent colors
   * poor scrollbars
   * Electron-looking elements
6. fix them
7. repeat

Do not stop after the first implementation.

Perform multiple visual refinement passes.

---

# 63. VISUAL ACCEPTANCE CRITERIA

The redesign is NOT complete until all of the following are true:

[ ] Application no longer visually feels like a default Electron application

[ ] Custom shell/titlebar feels integrated

[ ] Navigation feels premium

[ ] Overview immediately communicates project state

[ ] Workflow visually communicates current progress

[ ] Live activity feels genuinely live

[ ] Security findings are actionable

[ ] Finding → code → diff → event relationship is easy to understand

[ ] Agent shortcuts are visible and useful

[ ] Session history is useful

[ ] Controls are understandable

[ ] Empty states are informative

[ ] Loading states are polished

[ ] Scrollbars are redesigned

[ ] Hover states exist

[ ] Focus states exist

[ ] Buttons have interaction feedback

[ ] Drawers animate smoothly

[ ] Modals animate smoothly

[ ] Page transitions feel natural

[ ] Workflow transitions animate when real state changes

[ ] Live events animate when received

[ ] No fake data is used

[ ] No excessive animation exists

[ ] Reduced-motion mode works

[ ] Accessibility is acceptable

[ ] UI remains responsive during high event volume

[ ] No major console errors

[ ] No broken IPC

[ ] No Electron security regression

[ ] Core CECC functionality remains intact

---

# 64. VERY IMPORTANT DESIGN RULE

Do NOT confuse:

"more visual effects"

with:

"better UI"

Premium UI comes from:

hierarchy
composition
interaction
feedback
motion
typography
consistency
information architecture
performance

not from:

glows
gradients
particles
random animations

---

# 65. FINAL VISUAL TARGET

When the developer opens CECC, the immediate feeling should be:

"This is a serious professional developer product."

Not:

"This is an Electron dashboard."

The first screen should answer these questions visually within seconds:

WHAT PROJECT AM I WATCHING?

WHAT IS CLAUDE DOING?

WHAT IS THE CURRENT TASK?

WHAT STAGE ARE WE IN?

WHAT CHANGED?

DID ANYTHING BREAK?

IS THERE A SECURITY PROBLEM?

WHAT IS BLOCKING ME?

WHAT REMAINS?

IS THE PROJECT READY?

---

# 66. FINAL IMPLEMENTATION DIRECTIVE

Start by inspecting the current project.

Then:

1. Establish the design system.
2. Redesign the application shell.
3. Redesign navigation.
4. Redesign the Overview/Control Panel into a genuine command center.
5. Introduce real motion and state-based animation.
6. Redesign Live Activity.
7. Redesign Workflow.
8. Redesign Findings/Security.
9. Redesign session replay.
10. Redesign controls/settings.
11. Add the premium interaction layer.
12. Perform repeated visual QA.
13. Fix every obvious rough edge.
14. Run the complete test suite.
15. Run security checks.
16. Inspect the final Git diff.
17. Update documentation.

Do not stop when the application merely "looks nicer."

Continue until the entire product has a coherent visual language and the UX feels intentionally designed.

The goal is:

NOT
"make the existing UI prettier"

The goal is:

"transform CECC into a premium engineering product."

# 67. IMPORTANT: SHOW REAL VALUE

During the redesign, do not merely surface data differently.

Improve the user's ability to understand and act.

Every major screen should answer:

"What should I know?"

"What needs my attention?"

"What can I do about it?"

Example:

Instead of:

Security
3

Show:

SECURITY ATTENTION

2 high-risk issues require review

[Review issues]

Instead of:

Tests
128

Show:

VALIDATION

128 passed
2 failed

[View failures]

Instead of:

Workflow
IMPLEMENT

Show:

CURRENT STAGE
IMPLEMENT

4 of 7 acceptance checks complete

NEXT
TEST

Instead of:

Activity
42 events

Show:

LIVE DEVELOPMENT

Claude currently editing:
auth/middleware.ts

Last action:
npm test

Result:
2 failures

The application should continuously convert raw engineering telemetry into useful understanding.

# 68. PRODUCT FEEL

Think like the product designer of a high-end developer platform.

Do not ask:

"How do I fit this information into a card?"

Ask:

"What is the clearest interaction for this information?"

Use:

timelines
drawers
split views
context panels
inline actions
visual state transitions
progressive disclosure
contextual navigation

instead of turning every concept into another card.

# 69. QUALITY BAR

Before declaring the redesign finished, inspect the UI as a critical product designer.

Look for:

"Would I be proud to show this to a professional developer?"

"Does this feel like a product someone would pay for?"

"Can I understand the state of the development process instantly?"

"Does motion communicate state or merely decorate?"

"Can I find a problem quickly?"

"Can I understand why CECC found it?"

"Can I move from finding to code to evidence without losing context?"

"Does the interface remain calm when nothing is happening?"

"Does it become visibly active when real work occurs?"

"Does every major interaction feel finished?"

Keep refining until the answer to those questions is yes.

Do not settle for the first visually acceptable version.



One thing I would specifically tell Claude Code after it starts

Don't let it interpret this as “make everything flashy.” The screenshots show that your bigger problem is product hierarchy, not lack of gradients.

The target interaction should feel more like:

             CECC
     ┌───────────────────────┐
     │ ● CLAUDE ACTIVE       │
     │ Slash Browser         │
     │ main                  │
     └───────────────────────┘

       CURRENT TASK
  Implement authentication

 DISCOVER ✓ → INSPECT ✓ → PLAN ✓
                    ↓
              IMPLEMENT ●
                    ↓
              TEST ○
                    ↓
           SECURITY REVIEW ○

 ┌───────────────────┬────────────────────┐
 │ LIVE ACTIVITY     │ CURRENT STATE      │
 │                   │                    │
 │ EDIT auth.ts      │ 4/7 checks         │
 │ RUN npm test      │ 0 critical         │
 │ TEST 2 failed     │ 1 warning          │
 │ EDIT test         │ 2 tests failing    │
 │ RUN npm test      │ NOT READY          │
 └───────────────────┴────────────────────┘

             ↓
       WHAT NEEDS ATTENTION

  HIGH  Authorization check missing
        auth/api/projects.ts:42

        [Inspect] [View Diff] [View Test]

That is the direction I'd push it toward.

And there's one very important product distinction I'd preserve from your original idea: CECC should not just tell the user “here are vulnerabilities.” It should be able to show the chain:

Claude action → code change → engineering shortcut → detected consequence → security finding → test evidence → workflow impact.

That is what can make this feel like a genuinely new product instead of another static AI dashboard.