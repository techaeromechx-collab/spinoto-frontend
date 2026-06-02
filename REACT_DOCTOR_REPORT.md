# React Doctor Diagnostic Report — Spinoto Frontend

> Generated: 2026-05-21  
> Tool: `react-doctor v0.2.1`  
> Project: `spinoto-frontend`  
> Framework: Vite · React ^18.3.1 · JavaScript  
> Tailwind: Not found · React Compiler: Not found

---

## Summary

| Scan | Files Scanned | Total Issues | Score |
|------|--------------|-------------|-------|
| Uncommitted files only (12 files) | 12 / 12 | **671** | **72 / 100** |
| Full project (32 files)           | 28 / 32 | **1044** | **66 / 100** |

---

## Full Project Scan (28 / 32 files — Score: 66 / 100)

### ♿ Accessibility — 561 Issues

| Severity | Rule | Count | First Occurrence |
|----------|------|-------|-----------------|
| ✗ ERROR | **Reduced motion** — Project uses a motion library but has no `prefers-reduced-motion` handling (WCAG 2.3.3) | 1 | Project-wide |
| ⚠ WARNING | **Label has associated control** — `<label>` must have `htmlFor` or wrap the control | 179 | `src/pages/DepartmentsPage.jsx:36` |
| ⚠ WARNING | **Click events have key events** — Non-interactive elements with click handlers must also have `keyup`, `keydown`, or `keypress` | 121 | `src/pages/HubDashboardPage.jsx:272` |

**Fix Guidance:**
- Add `useReducedMotion()` from your animation library, or add a `@media (prefers-reduced-motion: reduce)` CSS query.
- Give each `<label>` a `htmlFor` attribute matching the control's `id`, or wrap the control inside the `<label>`.
- Add keyboard event listeners (`onKeyDown`, `onKeyUp`, or `onKeyPress`) to all clickable `<div>` / `<span>` elements — or replace them with `<button>`.

---

### 🔄 State & Effects — 132 Issues

| Severity | Rule | Count | First Occurrence |
|----------|------|-------|-----------------|
| ✗ ERROR | **Mutable in deps** — `location.*` values in `useEffect` deps can change without re-rendering | 3 | `src/pages/UsersPage.jsx:121` |
| ✗ ERROR | **Effect needs cleanup** — `setTimeout` inside `useEffect` never returns a cleanup function (memory leak) | 1 | `src/pages/LeadsPage.jsx:1636` |
| ⚠ WARNING | **Cascading set state** — 4 `setState` calls in a single `useEffect`; consider `useReducer` | 60 | `src/pages/HubDashboardPage.jsx:61` |

**Fix Guidance:**
- Read mutable values (`location.pathname`, `ref.current`) **inside** the effect body, not in the deps array. Or subscribe with `useSyncExternalStore`.
- Return a cleanup from the effect: `return () => clearTimeout(id)`.
- Replace multiple `setState` calls in one effect with `useReducer(reducer, initialState)`.

---

### ✅ Correctness — 52 Issues

| Severity | Rule | Count | First Occurrence |
|----------|------|-------|-----------------|
| ✗ ERROR | **Nested component definition** — `SortIcon` defined inside `ReportsPage` creates a new instance every render, destroying state | 1 | `src/pages/ReportsPage.jsx:161` |
| ⚠ WARNING | **Rendering hydration mismatch (time)** — `new Date()` in JSX renders differently on server vs. client | 26 | `src/pages/ReportsPage.jsx:575` |
| ⚠ WARNING | **Array index as key** — Using array index `i` as `key` causes bugs on reorder/filter | 22 | `src/auth/LoginPage.jsx:103` |
| ⚠ WARNING | **Prevent default** — `preventDefault()` on `<a>` onClick; use `<button>` or a routing component instead | 2 | `src/auth/LoginPage.jsx:115` |

**Fix Guidance:**
- Move `SortIcon` to module scope (above `ReportsPage`) or to its own file.
- Wrap `new Date()` reads in `useEffect` + `useState` (client-only rendering), or add `suppressHydrationWarning` to the parent.
- Replace `key={i}` with `key={item.id}` or another stable unique identifier.
- Replace `<a onClick={e => e.preventDefault()}>` with `<button>` or use `<Link>` from your router.

---

### 🏗️ Architecture — 206 Issues

| Severity | Rule | Count | First Occurrence |
|----------|------|-------|-----------------|
| ⚠ WARNING | **Inline exhaustive style** — 8+ inline style properties; extract to CSS class / CSS module / styled component | 95 | `src/pages/HubDashboardPage.jsx:40` |
| ⚠ WARNING | **Design: no em dash in JSX text** — Em dash (—) in JSX text reads like model output; replace with comma, colon, semicolon, or parentheses | 63 | `src/pages/ReportsPage.jsx:682` |
| ⚠ WARNING | **Giant component** — `ReportsPage` is 892 lines; break into smaller focused components | 29 | `src/pages/ReportsPage.jsx:72` |

**Fix Guidance:**
- Move large inline `style={{}}` objects to CSS classes, CSS Modules, or a styled component.
- Replace em dashes (—) in JSX prose with commas, colons, semicolons, or parentheses.
- Extract logical sections of large components into focused sub-components (`<ReportsHeader />`, `<ReportsTable />`, etc.).

---

### ⚡ Performance — 88 Issues

| Severity | Rule | Count | First Occurrence |
|----------|------|-------|-----------------|
| ⚠ WARNING | **JS combine iterations** — `.filter().map()` iterates the array twice; combine into one `.reduce()` or `for...of` | 24 | `src/pages/ServicesPage.jsx:1377` |
| ⚠ WARNING | **Rerender: state only in handlers** — `useState("dateRange")` is never read in render; use `useRef` | 17 | `src/pages/ReportsPage.jsx:75` |
| ⚠ WARNING | **Rerender: functional setState** — `setForm({ ...form, ... })` risks stale closures; use `setForm(prev => ({ ...prev, ... }))` | 12 | `src/components/NewLeadModal.jsx:506` |

**Fix Guidance:**
- Combine `.filter().map()` chains into a single `for...of` loop or `.reduce()`.
- Replace `useState` with `useRef` when the value is only mutated and never read in the render output.
- Always use the functional updater form: `setState(prev => ...)` to avoid stale closure bugs.

---

## Uncommitted Files Scan (12 / 12 files — Score: 72 / 100)

> Scan limited to the 30 uncommitted changed files at time of run.

### ♿ Accessibility — 389 Issues

| Severity | Rule | Count | First Occurrence |
|----------|------|-------|-----------------|
| ⚠ WARNING | **Label has associated control** | 116 | `src/pages/ProfilePage.jsx:682` |
| ⚠ WARNING | **Static element interactions** — Static HTML with event handlers require a `role` attribute | 94 | `src/pages/ProfilePage.jsx:749` |
| ⚠ WARNING | **Click events have key events** | 92 | `src/pages/ProfilePage.jsx:749` |

---

### 🔄 State & Effects — 93 Issues

| Severity | Rule | Count | First Occurrence |
|----------|------|-------|-----------------|
| ✗ ERROR | **Mutable in deps** | 2 | `src/components/AppShell.jsx:335` |
| ✗ ERROR | **Effect needs cleanup** | 1 | `src/pages/LeadsPage.jsx:1636` |
| ⚠ WARNING | **Cascading set state** | 47 | `src/pages/ProfilePage.jsx:134` |

---

### 🏗️ Architecture — 106 Issues

| Severity | Rule | Count | First Occurrence |
|----------|------|-------|-----------------|
| ⚠ WARNING | **Inline exhaustive style** | 46 | `src/components/AppShell.jsx:475` |
| ⚠ WARNING | **Design: no em dash in JSX text** | 36 | `src/pages/AppointmentsPage.jsx:876` |
| ⚠ WARNING | **Giant component** — `ProfilePage` is 733 lines | 18 | `src/pages/ProfilePage.jsx:272` |

---

### ⚡ Performance — 49 Issues

| Severity | Rule | Count | First Occurrence |
|----------|------|-------|-----------------|
| ⚠ WARNING | **JS combine iterations** | 16 | `src/pages/AppointmentsPage.jsx:762` |
| ⚠ WARNING | **Rerender: state only in handlers** — `useState("models")` | 9 | `src/pages/AppointmentsPage.jsx:545` |
| ⚠ WARNING | **Rerender: memo with default value** — Default prop `[]` creates a new array reference every render; extract to module-level constant | 6 | `src/pages/ServicesPage.jsx:1034` |

---

### ✅ Correctness — 32 Issues

| Severity | Rule | Count | First Occurrence |
|----------|------|-------|-----------------|
| ⚠ WARNING | **Rendering hydration mismatch (time)** | 16 | `src/pages/AppointmentsPage.jsx:385` |
| ⚠ WARNING | **Array index as key** | 13 | `src/auth/LoginPage.jsx:103` |
| ⚠ WARNING | **Prevent default** | 2 | `src/auth/LoginPage.jsx:115` |

---

## Critical Errors (Must Fix)

| # | Error | File | Line |
|---|-------|------|------|
| 1 | Reduced motion — no `prefers-reduced-motion` handling (WCAG 2.3.3) | Project-wide | — |
| 2 | Mutable `location.*` in deps | `src/pages/UsersPage.jsx` | 121 |
| 3 | Mutable `location.*` in deps | `src/components/AppShell.jsx` | 335 |
| 4 | Effect needs cleanup (setTimeout leak) | `src/pages/LeadsPage.jsx` | 1636 |
| 5 | Nested component definition (`SortIcon` inside `ReportsPage`) | `src/pages/ReportsPage.jsx` | 161 |

---

## Affected Files

| File | Issues |
|------|--------|
| `src/pages/HubDashboardPage.jsx` | State cascade, Inline styles, Click key events |
| `src/pages/ReportsPage.jsx` | Nested component, Hydration mismatch, Giant component, Em dashes, useState as ref |
| `src/pages/ProfilePage.jsx` | Label control, Static interactions, Click key events, State cascade, Giant component |
| `src/pages/AppointmentsPage.jsx` | Hydration mismatch, Combine iterations, Em dashes, useState as ref |
| `src/pages/DepartmentsPage.jsx` | Label has associated control |
| `src/pages/UsersPage.jsx` | Mutable in deps |
| `src/pages/LeadsPage.jsx` | Effect needs cleanup |
| `src/pages/ServicesPage.jsx` | Combine iterations, Memo with default value |
| `src/components/AppShell.jsx` | Mutable in deps, Inline styles |
| `src/components/NewLeadModal.jsx` | Functional setState |
| `src/auth/LoginPage.jsx` | Array index as key, Prevent default |

---

## Priority Fix Order

1. **🔴 Critical (Errors):** Fix all 6 critical errors first — mutable deps, effect cleanup, nested component definition, and reduced motion.
2. **🟠 High (Correctness):** Replace array index keys, fix `new Date()` hydration issues, replace `<a onClick>` with `<button>`.
3. **🟡 Medium (State):** Refactor cascading setState to `useReducer`, use functional setState form.
4. **🟢 Low (Architecture / Performance):** Extract giant components, move inline styles to CSS, combine array iterations.

---

## Resources

- React Doctor: https://www.react.doctor
- Full verbose diagnostics (temp file): `/var/folders/_w/455ftgk17_dd0m84jrprwx3c0000gn/T/react-doctor-44b6e249-3e1f-4ed3-9af9-b503e8316f65`
- Share results: https://www.react.doctor/share?p=spinoto-frontend&s=66&e=6&w=1038&f=28
- React Review (CI integration): https://react.review
