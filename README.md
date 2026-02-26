Project Description

This project exists to design, implement, and refine an automated task capture and execution system using MCP integrations.

The goal is to reliably detect when work is requested across Slack, Outlook, and meeting transcripts (Fathom), classify whether it constitutes an actionable task, and push validated tasks into Trello as the single system of record.

The system must prioritise precision over volume. It should reduce cognitive load, prevent missed commitments, and provide structured visibility over execution without generating noise or unnecessary task clutter.

This project focuses on:

Defining what qualifies as a task

Designing ingestion logic for Slack, Outlook, and Fathom

Building a classification model with confidence thresholds

Structuring Trello as a clean execution board

Preventing duplication, false positives, and artificial urgency

Establishing review rituals and feedback loops

The outcome should be a stable, low-noise, high-trust task system that scales with increasing responsibility and message volume.

Operating Rules
1. System of Record

Trello is the single source of truth for execution.

No parallel task systems.

GitHub Issues are for engineering work only.

Email flags or Slack saves do not count as tasks.

2. Definition of a Task

A task must:

Require an outcome or deliverable

Be directed to Colin explicitly or implicitly

Contain action-oriented language

Not be informational only

Do not classify as tasks:

FYI messages

General discussions

Open-ended brainstorming

Non-committal commentary

3. Automation Philosophy

Precision over recall.

Missing one low-impact task is acceptable.

Creating noise is not acceptable.

Due dates must only be extracted when explicitly stated.

No invented urgency.

4. Intake Structure (Trello)

Board: Single master execution board.

Lists:

AI Intake

Approved

This Week

Waiting On

Done

All automation lands in AI Intake only.

Manual triage is required before work begins.

5. Card Creation Rules

Each Trello card must include:

Clear action-based title (short)

Source (Slack / Email / Meeting)

Requested by

Original message snippet

Direct link to original context

Confidence score

Due date only if explicitly provided

No summarised guesswork that removes context.

6. Confidence Model

High confidence → Auto-create

Medium confidence → Flag for review

Low confidence → Ignore

Confidence must be based on:

Direct mention

Directive verbs

Deadline language

Context continuity

7. Deduplication

Before creating a card:

Check for existing similar open tasks

Avoid duplicate cards from Slack thread replies

Merge context into existing task when appropriate

8. Review Ritual

Daily:

Review AI Intake

Approve, move, or delete

Ensure This Week list remains realistic

Weekly:

Clear stale intake items

Audit Waiting On

Close completed cards

9. Design Constraint

The system must:

Reduce cognitive friction

Not increase admin overhead

Not require constant supervision

Be explainable and inspectable

If automation becomes noisy, tighten the detection logic rather than widening intake.

