# Reusable-engineering-operating-system-for-Claude-Code---Rules-Instructions-Workflows-
A reusable Claude Code engineering framework for building secure, scalable, production-ready software with efficient workflows, architecture standards, security practices, testing, deployment, and token optimization.

Claude Code Engineering System

A reusable engineering framework for Claude Code designed to make software development more efficient, secure, consistent, and production-ready.

This repository provides a structured set of engineering rules, workflows, architecture standards, security practices, testing strategies, deployment guidelines, and AI-agent instructions that can be reused across software projects.

The goal is simple:

Get maximum engineering output from Claude Code while minimizing unnecessary token usage, complexity, and repeated context discovery.

⸻

Why This Exists

AI coding agents can write code extremely quickly, but speed alone does not produce production-quality software.

Without a consistent engineering system, an AI agent can:

* Overengineer simple features
* Introduce unnecessary dependencies
* Rewrite working code
* Miss authorization vulnerabilities
* Ignore database security
* Duplicate existing functionality
* Waste tokens reading irrelevant files
* Repeat previously solved problems
* Make assumptions about architecture
* Produce code without sufficient testing
* Create deployment problems
* Forget important project decisions between sessions

This repository provides a reusable system for preventing those problems.

Instead of treating Claude Code as a simple code generator, this framework treats it as an AI engineering agent operating under defined software engineering standards.

⸻

Core Philosophy

The system follows this priority:

CORRECTNESS
     ↓
SECURITY
     ↓
MAINTAINABILITY
     ↓
PERFORMANCE
     ↓
COST
     ↓
SPEED

The objective is not to generate the most code.

The objective is to generate the smallest amount of correct, secure, maintainable code necessary to solve the actual problem.

⸻

Technology Ecosystem

The framework is designed around a modern web application stack.

Area	Preferred Technology
Language	TypeScript
Frontend	React / Next.js
Styling	Tailwind CSS
Backend	Next.js / Node.js
Database	Supabase PostgreSQL
Authentication	Supabase Auth
Authorization	PostgreSQL RLS + server-side authorization
Hosting	Vercel
DNS / CDN / Security	Cloudflare
Transactional Email	Resend
Payment Integration	PayHere / appropriate provider
Source Control	Git + GitHub
AI Development	Claude Code
Validation	Zod / equivalent
Testing	Unit / Integration / E2E
Documentation	Markdown + ADRs

This is a default ecosystem, not a hard requirement.

A different technology should be selected when the project requirements justify it.

⸻

What’s Included

The engineering system covers:

Architecture

* Project initialization
* Application architecture
* Frontend architecture
* Backend architecture
* Database architecture
* Multi-tenant architecture
* Architecture decision records
* Repository organization

Security

* OWASP-oriented security reviews
* Authentication
* Authorization
* Supabase Row Level Security
* IDOR prevention
* Input validation
* File upload security
* Secret management
* API security
* Webhook security
* Tenant isolation
* Security-focused code review

Database

* PostgreSQL design
* Supabase conventions
* Database constraints
* Indexing
* Query efficiency
* Migrations
* RLS policies
* Multi-tenant data isolation

Development

* TypeScript standards
* React/Next.js conventions
* API design
* Error handling
* Logging
* Git workflow
* Testing
* Performance
* Accessibility

Infrastructure

* Vercel deployment
* Cloudflare configuration
* Resend email
* Environment variables
* Production readiness
* Cost considerations
* Monitoring and observability

AI Development

* Claude Code workflow
* Context management
* Token optimization
* Repository discovery
* Task planning
* Minimal-change implementation
* AI session handoff
* Project state management

⸻

Claude Code Workflow

The core development workflow is:

┌─────────────────────┐
│      Requirement    │
└──────────┬──────────┘
           ↓
┌─────────────────────┐
│       Inspect       │
│ Relevant files only │
└──────────┬──────────┘
           ↓
┌─────────────────────┐
│   Impact Analysis   │
│ Security / DB / API │
│ Deploy / Testing    │
└──────────┬──────────┘
           ↓
┌─────────────────────┐
│        Plan         │
│ Small + targeted    │
└──────────┬──────────┘
           ↓
┌─────────────────────┐
│     Implement       │
│ Minimal change      │
└──────────┬──────────┘
           ↓
┌─────────────────────┐
│       Validate      │
│ Tests / Type / Lint │
└──────────┬──────────┘
           ↓
┌─────────────────────┐
│    Review Diff      │
│ Security / Quality  │
└──────────┬──────────┘
           ↓
┌─────────────────────┐
│ Update Project State│
└──────────┬──────────┘
           ↓
         DONE

⸻

Token Efficiency

One of the main goals of this repository is reducing unnecessary Claude Code token consumption.

Claude should not repeatedly:

* Read the entire repository
* Read large files unnecessarily
* Re-explain the architecture
* Rediscover previous decisions
* Rewrite unrelated code
* Generate speculative implementations
* Run identical commands repeatedly
* Dump huge logs into context
* Create unnecessary abstractions

Instead, Claude should use:

* Targeted file searches
* Targeted reads
* Existing documentation
* Git diffs
* Project state
* Focused tests
* Small implementation steps

The principle

Every token should have a purpose.

Before reading:

Do I need this information?

Before writing:

Does this change actually need to exist?

Before adding a dependency:

Can the existing stack solve this?

Before refactoring:

Does this reduce real complexity?

Before running a command:

What information will this provide?

Before repeating a failed attempt:

What changed since the previous attempt?

⸻

Recommended Repository Structure

A project using this system can follow:

.
├── CLAUDE.md
│
├── .claude/
│   ├── rules/
│   │   ├── 00-core.md
│   │   ├── 01-architecture.md
│   │   ├── 02-security.md
│   │   ├── 03-database.md
│   │   ├── 04-frontend.md
│   │   ├── 05-backend.md
│   │   ├── 06-testing.md
│   │   ├── 07-git.md
│   │   ├── 08-deployment.md
│   │   ├── 09-email.md
│   │   ├── 10-performance.md
│   │   └── 11-token-efficiency.md
│   │
│   └── commands/
│       ├── audit.md
│       ├── security-audit.md
│       ├── test.md
│       ├── deploy-check.md
│       └── review.md
│
├── docs/
│   ├── ARCHITECTURE.md
│   ├── DATABASE.md
│   ├── SECURITY.md
│   ├── API.md
│   ├── DEPLOYMENT.md
│   ├── DECISIONS.md
│   ├── PROJECT_STATE.md
│   └── TASKS.md
│
├── supabase/
│   ├── migrations/
│   ├── seed.sql
│   └── config.toml
│
├── tests/
├── .env.example
├── .gitignore
└── package.json

Not every project needs every file. The structure should scale with project complexity.

⸻

Project State Management

A major part of the framework is maintaining a concise project state.

Example:

Current architecture:
Next.js + Supabase + Vercel + Cloudflare + Resend
Current feature:
Subscription management
Completed:
- Authentication
- Database schema
- RLS policies
In progress:
- Payment webhook verification
Known issues:
- Email retry handling
Next:
- Integration tests

This allows a future Claude Code session to understand the current state without reconstructing the entire development history.

⸻

Security Philosophy

Security should be part of architecture rather than something added after development.

Every security-sensitive feature should consider:

* Authentication bypass
* Authorization bypass
* IDOR
* Cross-user access
* Cross-tenant access
* Input injection
* XSS
* SQL injection
* SSRF
* Path traversal
* Malicious file uploads
* Rate-limit abuse
* Credential attacks
* Secret leakage
* Forged webhooks
* Database policy bypass

The system also explicitly rejects security theater.

For example:

Using TypeScript does not make an application secure.

Using Supabase Auth does not automatically implement authorization.

Using Cloudflare does not automatically secure an application.

Frontend validation is not a security boundary.

Security must be implemented through actual controls and verified through testing and review.

⸻

Production Readiness

Before a feature is considered complete, the system checks:

Functionality

* Requirements implemented
* Edge cases handled
* Error states handled

Security

* Authentication checked
* Authorization checked
* Input validated
* Secrets protected
* RLS reviewed
* Sensitive data protected

Database

* Schema reviewed
* Constraints reviewed
* Indexes reviewed
* Queries reviewed
* Migration reviewed

Testing

* Unit tests where required
* Integration tests where required
* E2E tests where required
* Security tests where appropriate

Deployment

* Environment variables configured
* Build succeeds
* Vercel configuration reviewed
* Cloudflare configuration reviewed
* Production behavior verified

⸻

Git Philosophy

Git is part of the engineering workflow.

Prefer:

main
├── feature/*
├── fix/*
├── security/*
└── refactor/*

Keep changes focused.

Use small logical commits.

Never casually:

* Reset user changes
* Force push
* Delete branches
* Destroy migrations
* Discard unrelated work

Before significant changes:

git status
git diff

Understand the current repository state before modifying it.

⸻

Documentation Philosophy

Documentation exists to reduce future engineering and AI context costs.

Good documentation explains:

* Why the architecture exists
* Important constraints
* Security assumptions
* External services
* Deployment requirements
* Database relationships
* Important decisions
* Known limitations

Bad documentation simply repeats the code.

The objective is:

Documentation
      ↓
Less Rediscovery
      ↓
Less Context
      ↓
Fewer Tokens
      ↓
Faster Development

⸻

When Claude Should Ask

Claude should ask the developer when:

* Requirements conflict
* Destructive changes are required
* Data migration could cause loss
* Architecture must fundamentally change
* Production secrets are required
* Business rules are ambiguous
* Multiple materially different architectures are possible

Claude should not ask unnecessary questions about low-risk implementation details.

When a safe engineering decision can be made, make it and continue.

⸻

When Claude Should NOT Pretend

Claude must never claim:

* Tests passed when they were not run
* Deployment succeeded when it was not verified
* Security is complete when it was not reviewed
* A migration succeeded when it was not confirmed
* An API works when it was not tested
* An external service is configured when it was not verified

Use explicit states:

VERIFIED
ASSUMED
NOT TESTED
BLOCKED

⸻

Intended Use

This repository can be used as:

* A template for new projects
* A Claude Code instruction system
* A software engineering standards repository
* A security baseline
* A team development guideline
* An AI-agent workflow
* A project bootstrap framework
* A reusable architecture reference

⸻

Recommended Usage

For a new project:

1. Copy the core Claude Code rules.
2. Create the .claude/ structure.
3. Create the docs/ structure.
4. Customize the technology stack.
5. Define project architecture.
6. Define database structure.
7. Define authentication and authorization.
8. Define deployment configuration.
9. Start development using the task execution workflow.
10. Keep PROJECT_STATE.md and TASKS.md updated.

⸻

Design Principle

The central idea behind this system is:

AI should not replace engineering discipline. It should amplify it.

Claude Code can dramatically increase development speed, but only when the repository provides clear boundaries, architecture, security requirements, testing expectations, and project context.

This framework is designed to provide those boundaries while keeping the AI development workflow efficient.

⸻

License

Add the license appropriate for your intended use.

For example:

* MIT for a permissive open-source framework
* Apache-2.0 for a permissive license with additional protections
* Private/proprietary if this is intended for internal use only

⸻

Status

This is an evolving engineering framework.

Rules should be updated when:

* Better engineering practices are identified
* Security requirements change
* Technology choices change
* Claude Code capabilities change
* Production experience reveals weaknesses

The framework should evolve based on real engineering results rather than becoming a static collection of rules.
