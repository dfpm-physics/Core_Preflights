# feedback-triage — Claude Code addendum

> Tool notes only. The workflow lives in `SKILL.md`.

- Unattended run: `claude -p "Follow .ai/skills/feedback-triage/SKILL.md"` from the repo root. The `/feedback-triage` slash form is not defined here (CORE.md §4 forbids a `.claude/skills/` mirror), so name the file.
- A headless run cannot approve permission prompts: launch it with the hub folder readable (`--add-dir "C:/00 -- AI Hub"`) because the launcher and secrets live there.
- Use the Bash tool (Git Bash) for the commands; write the CHANGELOG text with Edit, not a heredoc.
- Delegate a large approved item to a subagent with the full spec (files, instructions, tests); keep the `mark` calls in the main thread.

This addendum adapts tools only. Where it and `SKILL.md` or `CORE.md` disagree, they win.
