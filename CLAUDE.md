# SiteCall — Working Agreement

This file governs all code work on SiteCall. Read it at the start of every session and follow it.

## Rule 0 — Root cause, never band-aid
Fix the actual cause of a problem, not the symptom. Never patch over something you don't understand. Don't edit code whose full effect you can't see — investigate first.

## Design before building
For anything non-trivial, state the plan and get it approved before writing code. Prefer the smallest change that solves the problem. Never break working code to add a feature.

## One source of truth
Don't create parallel systems for data that already has a home. Extend what exists rather than duplicating it.

## Version the database with migrations
Every schema or function change is a numbered SQL migration file. Never edit the DB in a way that can't be reproduced from the repo.

## Wrap external services in a service layer
All Supabase/API calls go through a `*Service.js` module, never called raw from a component.

## Observability from day one
Lifecycle actions and error paths log through the existing error service, with context.

## Store UTC, convert on display
All timestamps stored in UTC; only formatted to local time when shown.

## Validate server-side
Never trust the client for anything money- or safety-critical. Gates live in server RPCs, enforced with row locks where races are possible.

## Test the unhappy paths
No signal, denied permission, app killed mid-action, double-tap — handle these, don't assume the happy path.

## Match existing patterns and design tokens
Match existing patterns and design tokens (`theme.js`: C/S/R/T etc.). The founder is non-technical — explain changes in plain language and show diffs before committing.
