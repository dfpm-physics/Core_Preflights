# Claude Code addendum

- The canonical `SKILL.md` examples are Bash. Run them with the Bash tool, which works on
  Windows, macOS, and Linux alike — do not translate them to PowerShell unless a command
  actually fails on the host, then adapt only that command.
- Never echo the service-role key into tool output, the transcript, or a URL. Write it straight
  into the config file and read back only a masked value (first 12 chars + `…`), as the shared
  `SKILL.md` instructs.
- The project has no Node.js requirement. Use the Python standard-library connection check from
  the shared `SKILL.md`; do not introduce `node`/`npm` tooling.
- Treat the shared `SKILL.md` as authoritative. This addendum changes tools, not the setup steps
  or safety rules.
