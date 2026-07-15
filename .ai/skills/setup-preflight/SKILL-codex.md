# Codex addendum

- On Windows, use PowerShell-native checks and file operations rather than Bash-only examples.
- Never echo or expose the service-role key in tool output. Use a protected local write mechanism
  and verify only masked values.
- The project has no Node.js requirement. Use Python standard-library checks from the shared skill.
