# Work Sessions Log

This folder records what was done in each Claude Code session so context transfers seamlessly between computers (work and home).

**How it works**: At the end of each session, Claude writes a dated log file summarizing everything that happened — what was built, what's in progress, what's next, and any important context the next session needs.

**For Claude**: When starting a new session, read the most recent log file in this folder FIRST to understand where we left off. The user works on two computers and Claude's memory doesn't sync between them.

## Session Log Format

Each file is named `YYYY-MM-DD-{n}.md` (n for multiple sessions per day). Contains:
- **Computer**: Which machine (work/home)
- **Branch**: Current git branch
- **What was done**: Summary of work completed
- **What's in progress**: Unfinished work
- **What's next**: Planned next steps
- **Key decisions**: Any architectural or design decisions made
- **Uncommitted changes**: Files modified but not committed
- **Resume instructions**: Exact prompt to give Claude to continue
