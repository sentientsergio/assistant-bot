# Development Workflow Rule

This project has **dev/prod separation**. Follow this workflow for all changes.

## The Rule

**Never fix production directly.** All changes go through dev first.

## Workflow

1. **Log the issue** — Add to `workspace/ISSUES.md`
2. **Create a branch** — `git checkout -b fix/description` or `feature/description`
3. **Make changes** — Implement on the branch
4. **Build** — `npm run build` in gateway/
5. **Test on dev** — Restart dev instance (`npm run start:dev`), test with @sergios_assistant_dev_bot
6. **Commit** — With clear message
7. **Merge to main** — `git checkout main && git merge branch-name`
8. **Deploy to prod** — Restart prod instance (`npm run start:prod`)
9. **Mark resolved** — Update ISSUES.md

## Instances

| Instance | Bot | Port | Workspace | Purpose |
|----------|-----|------|-----------|---------|
| Dev | @sergios_assistant_dev_bot | 18889 | workspace-dev/ | Testing |
| Prod | @sergios_assistant_bot | 18789 | workspace/ | Live |

## Commands

```bash
# Start instances
npm run start:dev    # Claire.dev
npm run start:prod   # Claire

# Dev workspace utilities  
npm run dev:clone    # Copy prod → dev
npm run dev:wipe     # Reset dev to clean state
```

## Anti-patterns

- ❌ Editing code on main and restarting prod immediately
- ❌ "Quick fix" without testing on dev
- ❌ Skipping the branch step for "small" changes

## When to break the rule

Only with explicit user approval for genuine emergencies. Even then, prefer a fast branch→test→merge cycle over direct prod edits.
