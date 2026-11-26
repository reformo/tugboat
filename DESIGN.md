---
name: "Tugboat"
description: "Conventional macOS utility for Codex and Claude Code in Brig environments."
colors:
  background: "#f1f1f1"
  focus-on-dark: "#a8c7ff"
  control-background: "#ffffff"
  settings-group: "#ffffff"
  settings-divider: "#f9f9f9"
  field-border: "#b8b8b8"
  surface: "#f1f1f1"
  sidebar: "#1e1e1e"
  sidebar-line: "#333333"
  sidebar-text: "#eeeeee"
  sidebar-hover: "#202020"
  sidebar-row-hover: "#2b2b2b"
  sidebar-muted: "#a6a6a6"
  sidebar-current: "#2c3f62"
  sidebar-selection: "#4d8dff"
  sidebar-selected-text: "#f1f1f1"
  line: "#dedede"
  text: "#121212"
  secondary: "#626262"
  selection: "#dce8ff"
  accent: "#4d8dff"
  accent-hover: "#4483ef"
  on-accent: "#f1f1f1"
  focus: "#4d8dff"
  error: "#a52b22"
  contrast-line: "#777777"
  terminal-foreground: "#ffe735"
  terminal-background: "#121212"
  terminal-cursor: "#aeb9c4"
  terminal-selection-background: "#aeb9c4"
  terminal-selection-foreground: "#000000"
  terminal-divider: "#333333"
  terminal-ansi-0: "#1d2021"
  terminal-ansi-1: "#d4380d"
  terminal-ansi-2: "#52c41a"
  terminal-ansi-3: "#ffc069"
  terminal-ansi-4: "#4f86cd"
  terminal-ansi-5: "#d3adf7"
  terminal-ansi-6: "#597ef7"
  terminal-ansi-7: "#bfcad5"
  terminal-ansi-8: "#7c6f64"
  terminal-ansi-9: "#ff9c6e"
  terminal-ansi-10: "#b8bb26"
  terminal-ansi-11: "#ffe735"
  terminal-ansi-12: "#83a598"
  terminal-ansi-13: "#d3869b"
  terminal-ansi-14: "#8ec07c"
  terminal-ansi-15: "#ffffff"
  settings-dialog-background: "#262626"
  settings-dialog-navigation: "#1f1f1f"
  settings-dialog-field: "#1c1c1c"
  settings-dialog-surface: "#383838"
  settings-dialog-line: "#3e3e3e"
  settings-dialog-field-border: "#5c5c5c"
  settings-dialog-text: "#ececec"
  settings-dialog-secondary: "#a6a6a6"
  settings-dialog-selection: "#34476b"
  settings-dialog-accent: "#346bd0"
  settings-dialog-accent-hover: "#2d60be"
  settings-dialog-on-accent: "#ffffff"
  settings-dialog-focus: "#6ea2ff"
  settings-dialog-error: "#ff7b70"
  settings-dialog-switch-track: "#6e6e6e"
  settings-dialog-switch-knob: "#ffffff"
typography:
  body:
    fontFamily: "Inter, -apple-system, BlinkMacSystemFont, sans-serif"
    fontSize: "13px"
  title:
    fontSize: "24px"
    fontWeight: 650
    lineHeight: "30px"
    letterSpacing: "-.025em"
  project-title:
    fontSize: "22px"
    fontWeight: 650
    lineHeight: "30px"
    letterSpacing: "-.025em"
  project-row-name:
    fontSize: "14px"
    fontWeight: 600
    lineHeight: "20px"
  project-meta:
    fontSize: "12px"
    lineHeight: 1.5
  project-monogram:
    fontSize: "12px"
    fontWeight: 600
  table:
    fontSize: "12px"
  table-heading:
    fontSize: "12px"
    fontWeight: 500
  session-title:
    fontSize: "13px"
    fontWeight: 550
  session-date:
    fontSize: "11px"
  session-tab:
    fontSize: "12px"
    fontWeight: 550
  usage-value:
    fontSize: "16px"
    fontWeight: 550
    lineHeight: "24px"
  usage-percentage:
    fontSize: "12px"
    fontWeight: 400
  usage-session-title:
    fontSize: "20px"
    fontWeight: 650
    lineHeight: 1.35
  request-usage:
    fontSize: "12px"
    lineHeight: 1.5
  description:
    fontSize: "14px"
    lineHeight: 1.5
  section-label:
    fontSize: "16px"
    fontWeight: 650
    lineHeight: "20px"
  field:
    fontFamily: "Inter, -apple-system, BlinkMacSystemFont, sans-serif"
    fontSize: "14px"
    lineHeight: "20px"
  field-hint:
    fontSize: "12px"
    fontWeight: 400
    lineHeight: 1.5
  settings-term:
    fontSize: "13px"
    fontWeight: 500
    lineHeight: 1.5
  label:
    fontSize: "13px"
    fontWeight: 600
  hint:
    fontSize: "12px"
  document:
    fontFamily: "Inter, -apple-system, BlinkMacSystemFont, sans-serif"
    fontSize: "12px"
    lineHeight: 1.5
  dialog-title:
    fontSize: "20px"
  terminal:
    fontFamily: "Consolas, JetBrains Mono"
    fontSize: "14pt"
rounded:
  navigation: "6px"
  button: "7px"
  group: "9px"
  field: "5px"
  dialog: "12px"
spacing:
  x4: "4px"
  x6: "6px"
  x8: "8px"
  x10: "10px"
  x12: "12px"
  x14: "14px"
  x16: "16px"
  x20: "20px"
  x22: "22px"
  x24: "24px"
  x28: "28px"
  x32: "32px"
  x36: "36px"
  x40: "40px"
  terminal-inset: "10pt"
components:
  button-primary:
    backgroundColor: "{colors.accent}"
    textColor: "{colors.on-accent}"
    typography: "{typography.label}"
    rounded: "{rounded.button}"
    padding: "9px 16px"
    height: "36px"
  button-primary-hover:
    backgroundColor: "{colors.accent-hover}"
  button-secondary:
    backgroundColor: "{colors.control-background}"
    textColor: "{colors.text}"
    typography: "{typography.body}"
    rounded: "{rounded.navigation}"
    padding: "7px 13px"
    height: "32px"
  button-secondary-hover:
    backgroundColor: "{colors.selection}"
  button-destructive:
    backgroundColor: "{colors.error}"
    textColor: "{colors.control-background}"
    typography: "{typography.label}"
    rounded: "{rounded.button}"
    padding: "9px 16px"
    height: "36px"
  icon-button:
    backgroundColor: "transparent"
    textColor: "{colors.secondary}"
    rounded: "{rounded.navigation}"
    padding: "8px"
    size: "36px"
  icon-button-hover:
    backgroundColor: "{colors.selection}"
    textColor: "{colors.text}"
  session-action:
    backgroundColor: "transparent"
    textColor: "{colors.secondary}"
    rounded: "{rounded.navigation}"
    padding: "6px"
    size: "28px"
  sidebar:
    backgroundColor: "{colors.sidebar}"
    textColor: "{colors.sidebar-text}"
    typography: "{typography.body}"
    padding: "16px 12px 10px"
    width: "280px"
  sidebar-resizer:
    width: "8px"
  navigation-item:
    backgroundColor: "transparent"
    textColor: "{colors.sidebar-text}"
    typography: "{typography.body}"
    rounded: "{rounded.navigation}"
    padding: "7px 10px"
    width: "100%"
  navigation-item-current:
    backgroundColor: "{colors.sidebar-current}"
    textColor: "{colors.sidebar-selected-text}"
    typography: "{typography.label}"
  sidebar-project:
    backgroundColor: "transparent"
    textColor: "{colors.sidebar-text}"
    typography: "{typography.body}"
    rounded: "{rounded.navigation}"
    padding: "7px 10px"
    width: "100%"
  sidebar-project-current:
    backgroundColor: "{colors.sidebar-current}"
    textColor: "{colors.sidebar-selected-text}"
  sidebar-session:
    backgroundColor: "transparent"
    textColor: "{colors.sidebar-text}"
    typography: "{typography.body}"
    rounded: "{rounded.navigation}"
    padding: "7px 10px"
    width: "100%"
  sidebar-session-current:
    backgroundColor: "{colors.sidebar-current}"
    textColor: "{colors.sidebar-selected-text}"
  sidebar-refresh:
    backgroundColor: "transparent"
    textColor: "{colors.sidebar-muted}"
    rounded: "{rounded.navigation}"
    size: "28px"
  project-monogram:
    backgroundColor: "{colors.sidebar-hover}"
    textColor: "{colors.sidebar-text}"
    typography: "{typography.project-monogram}"
    rounded: "{rounded.navigation}"
    size: "32px"
  project-monogram-library:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.text}"
    size: "32px"
  project-library:
    textColor: "{colors.text}"
    padding: "0"
    width: "100%"
  workspace-header:
    backgroundColor: "{colors.background}"
    textColor: "{colors.text}"
    typography: "{typography.project-title}"
    padding: "14px 32px"
    height: "80px"
    width: "100%"
  table-surface:
    backgroundColor: "{colors.control-background}"
    textColor: "{colors.text}"
    typography: "{typography.table}"
    rounded: "{rounded.group}"
    padding: "0"
    width: "100%"
  table-heading:
    backgroundColor: "{colors.settings-divider}"
    textColor: "{colors.secondary}"
    typography: "{typography.table-heading}"
    padding: "13px 16px"
  session-tab:
    backgroundColor: "transparent"
    textColor: "{colors.secondary}"
    typography: "{typography.session-tab}"
    rounded: "{rounded.field}"
    padding: "6px 9px"
  session-tab-current:
    backgroundColor: "{colors.control-background}"
    textColor: "{colors.text}"
  usage-summary:
    textColor: "{colors.text}"
    typography: "{typography.usage-value}"
    width: "100%"
  project-notice:
    backgroundColor: "transparent"
    textColor: "{colors.secondary}"
    typography: "{typography.body}"
    rounded: "{rounded.group}"
    padding: "8px 12px"
  project-settings-dialog:
    backgroundColor: "{colors.settings-dialog-background}"
    textColor: "{colors.settings-dialog-text}"
    rounded: "{rounded.dialog}"
    padding: "0"
    width: "min(760px, calc(100vw - 40px))"
  session-usage-dialog:
    backgroundColor: "{colors.control-background}"
    textColor: "{colors.text}"
    rounded: "{rounded.dialog}"
    padding: "0"
    width: "min(820px, calc(100vw - 48px))"
  settings-group:
    backgroundColor: "{colors.settings-group}"
    textColor: "{colors.text}"
    typography: "{typography.body}"
    rounded: "{rounded.group}"
    padding: "0 14px"
  text-field:
    backgroundColor: "{colors.control-background}"
    textColor: "{colors.text}"
    typography: "{typography.field}"
    rounded: "{rounded.field}"
    padding: "7px 10px"
    width: "100%"
  select-field:
    backgroundColor: "{colors.control-background}"
    textColor: "{colors.text}"
    typography: "{typography.field}"
    rounded: "{rounded.field}"
    padding: "7px 38px 7px 10px"
    width: "100%"
  disclosure-group:
    textColor: "{colors.text}"
    typography: "{typography.label}"
  recent-project:
    backgroundColor: "transparent"
    textColor: "{colors.text}"
    typography: "{typography.body}"
    padding: "10px 0"
    width: "100%"
  project-row-name:
    typography: "{typography.project-row-name}"
  project-branch:
    textColor: "{colors.secondary}"
    typography: "{typography.project-meta}"
  terminal-project-header:
    backgroundColor: "{colors.background}"
    textColor: "{colors.text}"
    typography: "{typography.project-title}"
    padding: "16px 24px"
    height: "86px"
    width: "100%"
  terminal-toolbar:
    backgroundColor: "{colors.terminal-background}"
    textColor: "{colors.sidebar-text}"
    typography: "{typography.body}"
    padding: "8px 16px"
  terminal-surface:
    backgroundColor: "{colors.terminal-background}"
    textColor: "{colors.terminal-foreground}"
    typography: "{typography.terminal}"
    padding: "{spacing.terminal-inset}"
  removal-dialog:
    backgroundColor: "{colors.control-background}"
    textColor: "{colors.text}"
    rounded: "{rounded.dialog}"
    padding: "{spacing.x24}"
    width: "min(560px, calc(100vw - 48px))"
---

# Design System: Tugboat

## Overview

**Creative North Star: "Conventional macOS"**

Tugboat is a compact utility for Apple silicon Macs with macOS 15 or later. Its subtitle is “Agent Sandbox”. Preserve the visible dark native titlebar, window buttons, application menus, and folder panel. English labels and locally bundled Inter support direct project work. Native macOS shell affordances retain system typography.

The system covers the implemented project library, project dashboard, settings, policy, boundary-check, session-management, usage, and terminal surfaces. The application uses a dark native window header, a solid dark sidebar, and a plain pale workspace with white controls, independent of operating-system appearance. The terminal has a separate, fixed dark theme and a native AppKit renderer. Density serves the current task: project and session tables, a fixed project identity, wide scoped settings, and maximum terminal space.

**Key Characteristics:**
- Real macOS shell affordances and keyboard commands.
- Inter UI type, a dark native window header, a solid dark sidebar, pale project canvases, dark Settings and Project settings dialogs, white controls, and blue actions with light text.
- Plain pale Projects and selected-project canvases with rounded white information groups.
- A sidebar that starts with Projects, uses Lucide navigation icons, and places Help, Settings, and the application version on one footer row.
- A project table in last-opened order, path tooltips, and a selected-project sidebar with active sessions.
- A fixed project name above the folder path and branch, with the Brig reference below the settings action on the right.
- Saved project data remains visible during background environment checks. Unresolved configuration shows an inline notice with an Open project settings action.
- Editable settings, prompt-level usage, a bottom status bar, an API-equivalent pricing note, and explicit archive, Trash, restore, and removal controls.
- A native terminal with preferred Consolas, bundled JetBrains Mono fallback, and a separate dark toolbar.

**The Native Shell Rule.** Keep the native titlebar, window buttons, application menus, folder panel, and parented lifecycle dialogs. Do not simulate them in the WebView.

The owning sources are `index.html`, `src/style.css`, `src/main.ts`, `src/settings/settings.ts`, `src/projects/projects.ts`, `src/dashboard/dashboard.ts`, `src/sidebar/sidebar.ts`, `src/providers/agent-logo.ts`, `src/usage/usage-details.ts`, `src/app/workspace-status.ts`, `src/projects/project-policy.ts`, `src/projects/boundaries.ts`, and `src/projects/operations.ts`. Display state comes from `src/app/app-data.ts`, `src/dashboard/dashboard-state.ts`, `src/ui/form-state.ts`, and `src/usage/usage-details-state.ts`. Native rules come from `src-tauri/tauri.conf.json`, `src-tauri/src/main.rs`, `src-tauri/build.rs`, `src-tauri/native/WindowAppearance.h`, `src-tauri/native/WindowAppearance.m`, `src-tauri/src/desktop/menu.rs`, `src-tauri/src/desktop/lifecycle/mod.rs`, and the terminal files under `src-tauri/native/`. `PRODUCT.md` owns product truth. The Turkish `reports/imp-plan.html` report has independent styling and is outside this application design system.

The classic native header implementation uses public AppKit APIs through a C bridge after the native window is built and before `frontend_ready` shows it. It removes `NSWindowStyleMaskFullSizeContentView`, assigns `NSAppearanceNameDarkAqua` to that window, and sets `titlebarAppearsTransparent` to `NO`. This keeps WebView content below the native titlebar. The opaque window background is #121212. Tauri retains its Dark window theme, visible titlebar, and native window buttons. The document root and color-scheme meta value are light; the body inherits that scheme and uses Pale Workspace with white controls. The sidebar retains its dark color scheme. Native controls and typography remain owned by macOS.

Earlier config-only and AppKit attempts still appeared light in the user's running app. The later transparent-titlebar attempt with a dark document root/meta failed, and the user reported that the bar was gone. Final captures after an authorized restart confirm the classic native titlebar is dark, visible, and above content at window widths of (1020px) and (1512px) in system Dark. The evidence is `artifacts/form-controls/project-standard.png`, `artifacts/form-controls/settings-final.png`, and the associated acceptance and finish-review records. Native verification at the (760px) minimum and a fresh capture of this titlebar in system Light are outside this pass's captured scope.

## Colors

The fixed composition pairs a dark native window header and solid dark sidebar with a pale workspace and white controls. Blue identifies primary actions, sidebar selection, focused field borders, and checkbox accents. Button keyboard focus uses text underlines or pale surfaces. Frontmatter is normative. Shell color names map to CSS custom properties in `src/style.css`.

The user-confirmed palette comes from the ChatGPT conversation “Renk paleti oluşturma” (`6af337ab-0d84-83ed-a038-1e86c441b113`). It establishes the yellow, dark, and blue values represented by `terminal-foreground`, `sidebar`, and `accent`. The current interface uses a pale neutral workspace, blue workspace buttons, and light text on blue fills. Yellow remains in the application icon and the pinned terminal theme. Other neutrals, hover colors, borders, and text-selection tints are retained or derived support colors from the implementation. Their exact values are not attributed to that conversation.

### Primary

- **Action Blue** (`accent`) identifies the current primary workspace action. `accent-hover` provides the implemented hover state.
- **Interaction Blue** (`sidebar-selection`, `focus`) provides the blue for the sidebar selection tint, focused field borders, and native checkbox accents. Sidebar keyboard focus underlines text in its inherited color.

### Neutral

- **Pale Workspace** (`background`) defines the main canvas and compact project header.
- **Focus on Dark** (`focus-on-dark`) marks keyboard focus in the app update dialog.
- **White Control Surface** (`control-background`) defines fields, secondary buttons, the removal dialog, and destructive-button text.
- **Settings Information Surface** (`settings-group`) fills rounded host-tool information groups.
- **Settings Section Divider** (`settings-divider`) separates General information, Records folder, and Brig settings within the General tab.
- **Field Border** (`field-border`) defines the resting border of editable text, number, select, and multiline fields.
- **Support Surface** and **Workspace Divider** (`surface`, `line`) define project monograms, secondary controls inside dialogs, removal-preview backgrounds, table edges, and divided rows.
- **Dark Sidebar**, **Sidebar Divider**, and **Sidebar Text** define the navigation region. Use `sidebar-row-hover` for hovered rows and `sidebar-muted` for group headings and status. The current row mixes (30%) Interaction Blue with Dark Sidebar. The terminal toolbar retains `sidebar-hover` for hover.
- **Primary Text** and **Secondary Text** (`text`, `secondary`) distinguish labels from paths, explanations, values, and status text. Icon actions become Primary Text on hover, press, and keyboard focus.
- **Workspace Text Selection** (`selection`) uses the implemented pale blue tint for text selection and secondary or icon button feedback. Sidebar text selection uses Interaction Blue with `sidebar-selected-text`.
- **On Accent** and **Selected Sidebar Text** (`on-accent`, `sidebar-selected-text`) use the user's explicit light text choice on blue primary buttons, their hover state, current navigation, and sidebar text selection.
- **Error Text** (`error`) marks errors and destructive actions. A destructive primary button uses the error color as its fill with White Control Surface text.
- **Higher Contrast Divider** (`contrast-line`) replaces workspace dividers, sidebar dividers, and resting field borders when the system requests more contrast.
- **Terminal Canvas**, **Terminal Text**, **Terminal Cursor**, and **Terminal Selection** use the pinned `terminal-` tokens. Selection has its own foreground and background.
- **Terminal Divider** (`terminal-divider`) records the normal dark toolbar bottom line, which uses the sidebar divider role. The application has no terminal split.
- The sixteen indexed `terminal-ansi-0` through `terminal-ansi-15` colors retain the exact order from `TerminalTheme.h`. They are terminal protocol colors, not additional application action accents.

**The Fixed Composition Rule.** Keep the native window header and sidebar dark, the workspace pale, and controls white, independent of operating-system appearance. The Project settings and application Settings dialogs are the exceptions: they always use the dark `settings-dialog-` palette. Keep the terminal view and its separate toolbar dark. Tauri's Dark theme and the explicit per-window AppKit Dark Aqua appearance own classic native chrome, with WebView content below the titlebar. Keep the document root/meta and body color scheme light for the pale workspace and white controls.

**The Accent Text Rule.** Use On Accent light text on blue primary buttons in normal and hover states. Use Selected Sidebar Text on the navigation tint and on sidebar text selection.

**The Terminal Palette Rule.** Preserve the pinned foreground, background, cursor, selection colors, and all sixteen ANSI entries. Do not derive them from shell colors.

## Iconography

**The Icon Stroke Rule.** All Lucide icons use `stroke-width="1.5"` in the `0 0 24 24` SVG viewBox. Apply this value to navigation icons, action icons, branch marks, activity indicators, close controls, and form chevrons. Keep `currentColor`, rounded caps, and rounded joins. New Lucide icons follow the same rule at every displayed size.

## Typography

The WebView UI uses the Inter stack in `typography.body`, including controls, labels, status text, policy documents, and removal previews. Inter is the locally bundled Google Fonts variable asset at `src/assets/fonts/Inter-Variable.ttf`. Its normal style supports weights (100–900), uses `font-display: swap`, and is preloaded by `index.html`. Root rendering uses `font-synthesis: none` and `text-rendering: optimizeLegibility`.

Native macOS titlebars, menus, folder panels, and lifecycle dialogs retain system typography. The WebView removal dialog uses Inter. Terminal glyphs use the separate native font preference below.

- **Title** serves Projects and Settings. **Project Title** serves the selected project, including its compact terminal header. Both use the established heading line height.
- **Body** serves navigation, button text, values, and ordinary status text. **Description** serves the Projects library explanation.
- **Section Label** separates Settings sections below its unchanged Title heading. **Label** serves action labels, field labels, and disclosure summaries.
- **Field** serves text and number inputs, native selects, and multiline entry. **Field Hint** gives field-label explanations and network help a consistent readable rhythm. **Settings Term** gives information-row labels a medium weight below section headings.
- **Hint** serves supporting details and the compact terminal header path. Supporting paragraphs use a line height of (1.5).
- **Project Row Name** serves the library name column. **Project Meta** serves Git branches, the fixed folder path and right-aligned Brig reference, and sidebar feedback. **Project Monogram** serves initials in the library. Sidebar rows use body size. The fixed project name uses Section Label.
- **Table** and **Table Heading** serve project and session data, with tabular numbers. **Session Title** and **Session Date** distinguish each session name from its timestamp. **Session Tab** serves the Active, Archived, and Trash controls.
- **Usage Value** serves project totals. **Usage Percentage** keeps the cached-input percentage smaller and lighter than the project count. **Usage Session Title** carries the full conversation title inside the usage dialog. **Request Usage** serves exact per-request counts, model, rates, and missing-data notes.
- **Document** serves policy JSON and removal previews in Inter at the frontmatter size. Preserve whitespace wrapping and allow long content to break.
- **Terminal** prefers installed Consolas at the pinned point size. When Consolas is unavailable, use the bundled Google Fonts JetBrains Mono asset at `resources/fonts/JetBrainsMono-Variable.ttf`. Both paths use (14pt). CoreText registers the bundled fallback for this process only; it does not install the font for the user. Consolas itself is not bundled. Terminal creation fails if neither font can load.

Inter and JetBrains Mono use the bundled OFL notices. Lucide icon licenses, font notices, immutable source references, and asset hashes are recorded in `resources/license-supplements/ui-components.json`.

Terminal cell height is based on font metrics, not CSS line height: `ceil((ascender - descender + leading) × 1.5)`. This adds the pinned (50%) height. CoreText renders terminal glyphs and applies terminal bold and italic styles.

**The Readable Identity Rule.** Keep the project heading, small branch label, selectable path, and right-aligned Brig reference compact. Truncate overflow without increasing header height; preserve full project names, paths, branches, and Brig references in tooltips.

**The Full Session Title Rule.** Keep saved session titles on one line with an ellipsis. Preserve the complete title in the native tooltip and accessible name.

## Layout

The full-height shell uses `components.sidebar` and a flexible workspace with a zero minimum track width. The workspace has a scrolling main pane above an automatic-height status-bar row. Its content minimum height is (400px). The native window has an initial size of (1020 × 700px), opens maximized, and has a minimum of (760 × 500px).

The Projects library uses the same plain Pale Workspace canvas as the selected-project dashboard.

The sidebar starts with Projects and has no application icon, wordmark, or subtitle row. Each navigation destination pairs a Lucide icon (16 × 16px) with its label and an (8px) gap. The right-edge resize target is (8px) wide and uses the `col-resize` cursor. The sidebar has a minimum width of (280px), and resizing retains at least (480px) for the workspace.

On launch, the main window maximizes to the screen's usable area, including its native titlebar. Menu bar and Dock space follow macOS screen settings.

The project and activity lists fill the remaining space and scroll vertically. The Projects control and selected project name stay above the scroll area. The footer places Help, Settings, and the version on one row below a divider.

The Projects header stays at the top of the scrolling workspace. Its right-aligned Add new project button has a leading plus icon. The table and its footnotes sit in a full-width content region capped at (1300px), with `24px 32px 40px` padding. The columns are Project, Last opened, and Total cost. The first-run panel uses a folder icon, a short explanation, and a single folder action.

The selected-project header stays at the top with an (80px) minimum height and a bottom divider. The project name uses the full first line of the identity area. The folder path and Git branch share the second line and retain their tooltips. The settings icon stays on the right, above the Brig session reference. First-chat setup has a bordered white panel for agent selection, host and account status, and the action that opens the first chat. Setup notices stay above the dashboard with their reason and recovery actions. Background plan checks retain the dashboard and saved sessions.

The project dashboard has two bordered white sections. Project usage shows total tokens, input, cached input, output, and estimated API equivalent. Total tokens and estimated cost use (20px) type. View usage breakdown appears in the section header. Sessions groups the status filters in the toolbar beside the account status, agent selector, and New Chat. Primary actions in project details use the settings blue with white text. The account disclosure opens below the toolbar and contains the full provider message and the settings action when needed. Existing chats and terminal outputs also open from the sidebar.

Project settings and application Settings use a fixed header and navigation with a single scrolling content pane. Their controller confines focus and makes the background inert. Project settings is bounded to `min(760px, calc(100vw - 40px))` wide and `min(580px, calc(100vh - 40px))` high. Show the selected project name below the title. Use the dark settings palette, blue primary actions, flat option rows, and native selects. The pane uses (24px) vertical and (28px) horizontal padding. Session usage uses a native HTML dialog with width `min(820px, calc(100vw - 48px))` and a maximum height of `calc(100vh - 48px)`.

Showing the terminal keeps the project identity and settings icon, then places the independent dark toolbar and native terminal below it. The header has a minimum height of (86px) with `16px 24px` padding. The ordinary project content is hidden except for errors. The terminal panel fills remaining height with a minimum of (160px); its surface has a minimum of (100px). Toolbar actions wrap separately from terminal text. AppKit sizing subtracts the pinned inset on every side before deriving grid dimensions. Resize the real terminal and pseudo-terminal together.

Application Settings is centered and bounded to `min(720px, calc(100vw - 40px))` wide and `min(520px, calc(100vh - 40px))` high. Its header and footer use the dark navigation surface. Only the content pane scrolls. Give the pane (24px) vertical and (28px) horizontal padding. Keep the close action and navigation visible. Use blue #346BD0 for primary actions and #2D60BE on hover.

At the compact desktop breakpoint (900px and below), the resizable sidebar retains its (280px) minimum. Project content and the header use (24px) horizontal padding. When the dashboard has (680px) or less, total tokens and estimated cost move to the first row of the usage grid. Input, cached input, and output share the second row. The session toolbar wraps, and the table keeps the session, total, estimated cost, and row actions in view. The session usage dialog provides the remaining measurements. Main content and sidebar lists scroll independently.

**The Project Scope Rule.** Keep project setup, policy, diagnostics, and environment controls in the scoped settings dialog. Keep account controls under Accounts in application Settings. Keep Add new project in the Projects library header.

## Elevation & Depth

Tonal surfaces and one-pixel dividers provide normal hierarchy. Buttons have no shadow. Modal dialogs use the `dialog-modal` shadow and a dim backdrop; exact values live in the sidecar. Tables, settings groups, and ordinary project content remain flat. Native titlebars, folder panels, and close or quit dialogs retain system rendering.

Session filters transition fill and text color over (120ms). Reduced motion shows these states immediately. The native cursor follows terminal focus and cursor style; its blink is suppressed when the system requests reduced motion.

**The Quiet Depth Rule.** Use shadow only for the implemented modal dialogs. Keep controls, tables, settings groups, and disclosures flat.

## Shapes

Use the frontmatter radii for navigation, icon and secondary buttons, primary buttons, tables, settings groups, project notices, fields, and dialogs. Inputs and removal-preview backgrounds share the field radius. One-pixel borders define fields, table edges, settings groups, project notices, removal-dialog edges, and toolbar separation. Wide settings and usage dialogs have no edge border. Buttons have no resting, focus, or pressed border. Native window geometry remains owned by macOS.

## Components

### Buttons

Primary workspace actions use Interaction Blue, On Accent light text, label weight, and the established padding. Their minimum height is (36px). Hover and press change the fill. Disabled buttons use opacity (.65). Secondary buttons use White Control Surface, no border, the navigation radius, and a minimum height of (32px). Hover and keyboard focus use Workspace Text Selection. Inside dialog bodies, secondary controls rest on Support Surface. Destructive secondary actions use error text; removal confirmation uses an error fill and white text.

Buttons have no focus outline, box shadow, or pressed border. Keyboard focus underlines text with an offset of (3px). Icon buttons also use the pale selected surface and Primary Text on hover, press, and keyboard focus. Standard icon controls are (36 × 36px), with (8px) padding; session actions are (28 × 28px), with (6px) padding. Their icons keep full action names in tooltips and accessible labels.

Add new project uses a leading plus and opens the native folder picker. It appears only at the right of the Projects header. Its tooltip includes ⌘O. The native command is available in the library context. Selected projects expose a settings icon instead. New Chat uses a primary button with a leading compose icon in the ready-project session toolbar. No demo-creation action is implemented.

### Sidebar and native menus

Projects shows a folder icon in the library and a back arrow while a project is open. The navigation icons use `currentColor`, a (1.5px) stroke, rounded caps and joins, `aria-hidden="true"`, and `focusable="false"`. Project, chat, and terminal rows share a (32px) minimum height. Use the blue tint on the current view and Selected Sidebar Text for its label. Opening Settings moves focus to its heading. Returning to a visible terminal restores native first-responder focus.

Projects opens the library and lists registered projects in the scrollable sidebar. Selecting a project hides the other sidebar projects. Select Projects to return to the library. Select the fixed project name to return to its dashboard. Sidebar project rows show the name on one line. The tooltips include the full name, path, and branch when available. Chats lists active chats. The Terminals section opens retained operation outputs. Initial placeholders, empty states, and failure feedback stay inside the relevant list; loading messages use the bottom status bar.

Saved session rows use `components.sidebar-session`. Their one-line title has an ellipsis, a full `title` tooltip, and the complete `aria-label`. Codex and Claude Code chats appear together. Each title begins with its agent's (16 × 16px) filled brand mark instead of a visible agent name. Both marks use `currentColor`, including the selected row, with `aria-hidden="true"` and `focusable="false"`. Accessible names include the agent name. These user-requested brand marks are an exception to the Lucide (1.5px) stroke rule. The working indicator sits at the trailing edge of a chat row. Use the blue tint on the selected row while its terminal is visible. Refresh chats uses the (28px) icon control beside Chats. Give it a visible hover and keyboard focus surface.

Keep native menu commands for Add new project (⌘O), Settings (⌘,), Return to project (⌘1), Return to terminal (⌘2), and Quit (⌘Q). Add new project belongs to the library context; the folder picker uses the same label. Return to terminal is enabled when a project terminal exists. Folder selection, project navigation, and session selection are disabled while the relevant setup action is busy. The real Edit and Window menus retain their platform actions.

### Settings groups and fields

Settings has four sections across the top. General shows the records folder and application version with their actions. Accounts shows ChatGPT and Claude Code. New projects opens Resources and offers Network and Agents. System opens Checks and offers Brig. Use a blue underline for the current main section and a neutral filled button for the current subsection. Mark each with `aria-current`. Brig, Resources, Network, and Agents share one form. Show Save settings and its result in a fixed footer on those panels. Checks contains Check this Mac, cancellation, host-tool information, and Brig doctor results.

Show both shared accounts in Accounts before any project exists. Put the account name and status above the action row. Use one divider between the accounts. Both agents provide browser sign-in, sign-out, and Cancel sign-in while authorization is pending. ChatGPT also offers saved project sign-ins and Retry connection when needed. Claude Code offers Check connection. Show the readonly ChatGPT device code only while the browser is waiting. Claude returns through the native callback. Both sections remain available when another agent is selected or an environment is stopped. Show preparation, browser waiting, verification, saving, failure, and account states with text. Background updates retain navigation and focus. Late results must match the current provider attempt or account generation. Project account errors open Settings and focus the corresponding account heading. Access tokens and refresh tokens never enter the interface.


Use one divider between Records folder and Tugboat in General. Align each action with its label and value. Allow paths, account names, and status text to wrap. Use divided definition lists for host-tool information.

Brig settings use editable, labeled text, number, select, checkbox, and multiline fields. Shared fields use White Control Surface, Field typography, their frontmatter padding, full width, a zero minimum width, a minimum height of (36px), and a (1px) Field Border. Enabled, unfocused hover mixes Field Border with (20%) Secondary Text in sRGB. On focus, the existing border becomes Interaction Blue and the outer outline is removed without a size change. Placeholders use Secondary Text at full opacity. Disabled fields use Secondary Text, Support Surface, and the divider border. User-invalid fields use Error Text for their border when unfocused. Increased contrast uses Higher Contrast Divider for the resting field border.

Native HTML selects retain native popup menus and keyboard behavior. Only the closed field removes platform appearance. Its right padding reserves room for the official Lucide Chevron Down from (1.72.0), displayed at (16 × 16px) and positioned (10px) from the right, vertically centered. The source asset is `src/assets/icons/chevron-down.svg`. Do not replace the native select with a custom popup. Checkboxes use Interaction Blue as their accent. Multiline fields resize vertically and have a minimum height of (90px).

Keep the implemented validation and hints: profile length, CPU and memory limits, image verification, network preference, one allowed host per line, and telemetry status. Fields remain disabled if settings cannot load. Saving disables the save action, shows progress in the bottom status bar, and reports the final result beside the form. External settings changes update untouched fields while preserving unsaved edits. Host checks and doctor details are in System → Checks.

### Project library and identity

Library rows live in a semantic table with scoped column headings. Each name button uses `components.recent-project`, a flat monogram, a one-line name, and a (12px) gap. The Git branch appears below the name when available. Branch labels use a (14 × 14px) icon, a (6px) gap, one-line truncation, and a full tooltip. Row and name-button tooltips show the project path. Dates and costs align right. An unavailable date shows an em dash. An asterisk beside a cost points to the footnote about missing requests or prices. Table rows use divider lines and a pale hover fill.

Order every registered project by dedicated `lastOpenedAt`, independent of setup's `updatedAt`. Legacy records use `updatedAt × 1000` until the last-opened value is available. Do not reorder the library for setup changes alone. Use a native agent select in first-chat setup and beside New Chat in a ready project's ordinary dashboard. Selecting a project opens its dashboard and shows the project identity and settings action in the header. The project name, path, branch, and Brig reference retain exact tooltips.

### Scoped project settings

The header settings icon and Open project settings open the same dialog. Normal project opening displays saved data immediately, then checks the execution plan and starts the selected environment in the background. A new or changed plan shows progress in the bottom status bar. A previously used plan can also show its startup progress card. A chat requested during startup opens after verification. Running verified environments and starts already in progress are reused. The dialog has four main sections. Overview shows project access. Configuration opens General and offers Agents. Connections opens Network and offers GitHub and Web preview. Environment opens Operations and offers Guest image. The GitHub and Web preview guides are collapsed below their controls. Its Project access section names the agent, shared folder, Brig reference, guest destinations, and signature requirement. Put Prepare environment before the full plan and advanced controls. The resource disclosure includes project name, CPU, memory, image verification, and network. Saved preferences override app defaults for the selected environment. Stop that environment before changing resource options. Saving reports its result inside the dialog. External preference changes preserve unsaved fields and update untouched fields.

Preparation, guest terminal, sharing plan, network policy, boundaries, diagnostics, tests, stop, and Brig-session removal stay inside this scope. These actions target the selected environment. First-chat setup and application Settings share one sign-in controller per provider. Hide the Codex sandbox option for Claude, which uses the Brig boundary and manual permission requests. Sharing plans use compact divided definition rows. Advanced tools use native disclosure summaries with label weight and divided sections. Status text stays near its action. Policy JSON uses Document type. Externally managed policy content stays read-only when editing is disabled. Boundary results name the outcome and show target, expected behavior, and observed behavior; color alone does not carry the outcome.

### Session table and usage

The semantic session table has Session, Input, Cached input, Output, Total, Est. cost, and Actions columns at full width. The accessible name for Est. cost is Estimated API equivalent. The session filters are Active, Archived, and Trash. These buttons use `aria-pressed` in a named group. A native agent select appears beside New Chat. The action uses a (16px) Lucide Square Pen icon with `currentColor` and a (1.5) stroke. The table retains both agents' saved sessions. Session titles stay on one line with full tooltips and accessible names. The agent name appears in a neutral pill before the timestamp. Row action accessible names include the agent. Numeric columns align right and use tabular figures.

Usage appears first as project totals, then per session, then per recorded request in the usage dialog. The project summary always includes archived and deleted history. Cache reads are a subset of input. Display cached input as `count (cached / input percentage)` in all three places; use at most one decimal place and (0%) for zero input. At project totals, the parenthesized percentage uses the smaller, lighter Usage Percentage role. Standard-width wrapping of the count and percentage is accepted. Rows abbreviate counts of (10,000) or more with compact notation. Exact input, cached count and percentage, output, total, and API equivalent remain in numeric-cell tooltips.

Usage, Archive, Delete, and Restore are compact icon actions with explicit tooltips and accessible names. Active rows offer Usage, Archive, and Delete. Archived rows offer Usage, Restore, and Delete. Trash offers Usage and Restore. Both agents offer Usage details for saved records. Archive hides a chat from active views. Delete moves it to Trash. Restore returns it to the active view. These actions target one environment's chat and preserve source rollout files, Claude transcripts, and historical totals. Unavailable session files retain recorded usage and a visible status; their resume action stays disabled. End that chat's relevant terminal processes before archiving or deleting.

Session usage has a fixed header and a scrolling body. The full session title wraps above a flat row with total tokens on the left and estimated API equivalent on the right. Token breakdown starts open and shows input, cached input, cache writes, and output. Usage by agent expands to compare the selected agent, its descendants, and their combined usage. Prompt and agent turn rows show status, the number of measured requests, and the estimated API equivalent for those requests. Expand a row for the request table, including the model, exact counts, saved rates and corrections, and source links when available. Subagent rows expand to show their own turns. Recording and billing notes explain coverage and billing. The native terminal hides while the dialog is open and becomes visible again when the dialog closes.

Show Subscription billing is separate below the usage grid. A (14px) Lucide Info icon sits in a (16 × 16px) native `details` summary beside Estimated API equivalent. The summary opens a bordered popover below the estimate. Outside clicks and Escape close it. Escape restores focus to the summary. Usage updates preserve the open popover.

The pricing note identifies USD amounts as token API equivalents and states that subscription charges are separate. The OpenAI catalogue was checked on (2026-11-10); Anthropic was checked on (2026-11-13). Each request retains its dated tariff. Keep assumed tiers, missing cache information, and unpriced requests explicit. Unknown cached counts show Unknown or a known subtotal plus unknown; do not calculate a percentage from incomplete coverage. Fully unpriced sessions show Unavailable; partial totals show an asterisk (`*`) marker after the amount. The marker tooltip and screen-reader text give the number of excluded unpriced requests, and the note repeats it as the legend. Do not treat missing data as zero or update stored request prices when the catalogue changes.

Claude token cells show recorded main-session and linked subagent usage. Root rows include linked descendants, and details expose each agent’s own usage. Input adds ordinary input, cache reads, and cache creation; cached input remains a subset of that total. Claude details label responses as agent turns and keep user prompt count unknown. Mixed-project totals include recorded usage from both agents. Claude coverage remains partial because missing transcripts, unverified relationships, and unrecorded work limit coverage; show this limit in the API-equivalent note and usage details. Supported Anthropic token API equivalents show saved dates and a pricing source. Request notes expose speed, geography, separate 5-minute/1-hour writes, and assumptions. Missing metadata produces a labelled estimate; malformed or unsupported metadata remains unpriced. Subscription charges, account discounts, server-tool charges, and taxes are separate. Missing or invalid counts show Unknown or a known subtotal plus unknown, without an exact cache percentage. Saved usage and tariffs remain visible when a transcript is unavailable.

Saved Codex sessions come from each environment's guest index and rollout metadata. Claude sessions come from its persistent guest transcripts. Include guest working directories inside the project and its subdirectories. Reading history does not start a virtual machine. Each chat retains its project, environment, and native session identity. Equal native IDs in different environments remain separate. Show sessions by most recently updated first, including while automatic environment startup is in progress. Disabled, unverified session names in the table and sidebar use the existing 1.6-second opacity pulse while plan, setup, or session checks run. Stop the pulse when checks finish or fail; reduced motion uses static dimmed text. Initial placeholders, empty states, and failures remain in the relevant list. Loading messages use the bottom status bar. Retry environment restarts a failed background check; an explicitly stopped environment offers Start environment. New Chat and resume wait for verified readiness and the relevant account. Launch-time environment, account, and policy checks remain required after background plan validation. Each project can run multiple chats across its environments. Selecting an open chat restores its own terminal and scrollback. New Chat starts another process. Claude resume uses the saved native UUID without creating a fork. Close terminal affects the selected terminal. End that session's terminal before archiving or deleting it.

Retain loaded records in Zustand memory and render from that state when a project or settings view reopens. File and database changes refresh the relevant state and visible view. Preserve saved rows during background checks, and use placeholders only when data has not loaded. Settings refreshes preserve unsaved fields, focus, and selection while updating untouched fields. Reject late results for a different project or request. Open usage details preserve their disclosure state, focus, and scroll position through updates.

The sidebar's right-edge divider resizes it from a 280px minimum and keeps at least 480px for the workspace. Arrow keys adjust the focused divider in 16px steps. Home restores the minimum and End uses the maximum. Preserve the preferred width across launches and clamp it when the window narrows. The one-pixel divider changes to Accent on hover, keyboard focus, and drag. Live terminal bounds follow the resized workspace. A 14px rotating Lucide loader precedes a Codex title when its terminal reports working or thinking. Claude does not use the Codex activity parser. Idle and ended sessions have no loader. Reduced motion uses the same static icon.

The following review records are historical evidence for their captured versions. They do not verify later interface changes.

The shipped dashboard review accepted native captures at (1020px) and (1512px) logical widths at Retina (2×). Its evidence is in `artifacts/project-dashboard/acceptance.json`; the design detector reported no findings. The wide settings capture is from the first pass with unchanged modal layout. Archive and Trash captures from that pass establish behavior before percentages were added. The minimum (760px) layout and long-list scrolling were assessed in source only. Quit-warning text was observed through native accessibility; its blank image was discarded, and cancellation preservation was not independently established in this pass. Earlier genuine-session resume evidence belongs to the separate project-navigation review.

Claude integration browser captures in `.impeccable/review/claude-integration/` inspect project and Provider layouts at (1280px) and (760px). They use synthetic data and establish layout only. Separate native evidence records all 46 acceptance checks passing in Tugboat 0.3.0. These covered real replies, permission approval and denial, resume after environment restart and sign-in, saved states, migrated and custom Codex profiles, shared accounts, and records and disk recovery. Removal recovery passed after one controlled CLI failure following a real stop. It removed only the approved extra Claude environment, guest home, and owned policy. Both Codex projects and the main Claude chat continued. Successful shared ChatGPT sign-out also preserved a new reply in the same open Claude session.

The original records location was restored exactly. All 18 normal record files remained byte-for-byte unchanged after the latest app reopened. Four test guests were stopped, five unrelated inventory entries remained unchanged, and the test disk was detached. The temporary CLI wrapper was removed. Other test homes, project files, the disk image, and the custom profile remain available for review. The initial Codex setup retry and stock Claude auto-update warning have no established cause. Evidence is in `artifacts/claude-code/step-9-native-session.json`.

### Workspace status bar

The status bar stays at the bottom of the workspace, below the scrolling main pane. It stays visible while a project is open. Elsewhere it appears for a message on the visible page. Use one message line. Project-folder, plan, session, account, settings-save, and Mac-check messages take priority over the latest network event. Keep these messages out of rows that move controls.

Use Support Surface, a (1px) top divider, Secondary Text and (12px) type in a (32px) bar. Keep Network activity as a text button on the right. The message truncates on one line and retains its details in a tooltip. The message uses a polite live status. In the network summary, show the direction and protocol or the connection failure, followed by the endpoint. Earlier events are available in the dialog.

When terminal output is no longer available, return to the project and show the message in Error Text. Dismiss it after (10 seconds) unless another message replaces it. When workspace messages clear, show the latest network event for the selected project.

### Terminal header, toolbar, and surface

The pale compact project header preserves the name, small branch, folder path, and project settings icon. The Brig reference is right-aligned below the settings icon. The independent dark toolbar shows purpose or process status and Return to project. Use Close terminal for ordinary running terminals. Preparation offers setup output and scoped cancellation while its native process is running. Open chat captions begin with the same (16 × 16px) agent logo, followed by an (8px) gap. The logo uses `currentColor` and keeps its width when the caption truncates. The accessible caption includes the agent name; the logo stays hidden from assistive technology. Other process captions have no agent logo. Its caption can truncate to one line with an ellipsis, and its full text remains in the tooltip. The action group does not shrink and can wrap, so caption length does not hide its controls. Toolbar secondary buttons use the terminal background and Sidebar Text. Hover uses Sidebar Hover. Keyboard focus underlines the label. The toolbar retains its bottom divider. Toolbar text and controls use Inter; native terminal glyphs use the separate 14pt font preference. Status text uses the terminal cursor color. The toolbar remains a distinct terminal widget within the pale workspace.

The terminal itself is an AppKit `NSView` rendered through CoreText, above and outside the WebView. It uses public `libghostty-vt` (1.0.1) and a real Rust pseudo-terminal. The WebView only supplies layout bounds and the surrounding controls. Do not replace the terminal with a DOM text area or a rendered transcript.

Preserve native input, input-method composition, text selection, scrollback, clipboard actions, keyboard encoding, focus ownership, and the exposed accessibility text-area role and text values. The terminal inset comes from `spacing.terminal-inset` on each side. The cell-height metric and pinned palette are recorded above and in the sidecar. These implementation facts do not certify complete assistive-technology behavior.

Return to project hides the terminal without ending its process. Selecting its chat or result in the sidebar restores it. The native Return to terminal menu command and ⌘2 shortcut remain available. The dashboard has no Return to terminal or Return to chat button. Close terminal directly ends an ordinary terminal process. Cancel preparation stops the running setup command before verification. Failed preparation retains its output for review. An ended process uses Close output, which removes its retained output. Closing the window or quitting with a live terminal uses the parented native warning with Cancel and End processes and close. The message explains that Tugboat saves usage and stops its project environments. If there are no live terminals, shutdown proceeds automatically. A failed stop keeps the window open.

**The Terminal Space Rule.** Keep the project header compact and the toolbar independent. Give remaining space to the native terminal without changing its pinned metrics.

### Removal preview

Project settings offer Preview environment removal for the selected agent and Preview all environments for the project. Both use the implemented modal dialog. Its reference, workspace, preview text, and external-session warning identify the affected resources. The preview names sessions, guest homes, bindings, and policies before confirmation. The user must type the exact displayed confirmation name before Remove session is enabled. Errors remain inside the dialog. Cancel closes the dialog and returns focus to the preview action that opened it. Removing one environment preserves the other agent's environment. Keep removal distinct from Close terminal, Stop Brig environment, and the record-only Forget action.

## Do's and Don'ts

### Do:

- **Do** preserve real macOS windowing, menus, folder panels, and parented close or quit warnings.
- **Do** keep English application labels, locally bundled Inter UI typography, native system typography, and the fixed dark-sidebar/pale-workspace composition.
- **Do** preserve light text on blue fills, white controls, and blue field borders on focus.
- **Do** retain the classic dark native window header above WebView content while keeping the document root/meta and body color scheme light.
- **Do** use flat rows, clear headings, and wrapping values in application Settings.
- **Do** use the shared Field typography, spacing, and border states while retaining native select popup and keyboard behavior.
- **Do** start the sidebar with Projects and keep Settings and the application version in its footer.
- **Do** keep Add new project in the Projects header of a populated library, project controls in the scoped settings dialog, and New Chat in the ready-project toolbar.
- **Do** keep every registered project in last-opened order and show only the selected project's saved sessions in its sidebar context.
- **Do** preserve full session titles in tooltips and accessible names while keeping list rows on one line.
- **Do** keep Settings below the scrollable project area and terminal controls visible beside a bounded caption.
- **Do** use `stroke-width="1.5"` for all Lucide icons, including Folder and Settings beside their navigation labels.
- **Do** preserve the fixed dark terminal palette, Consolas preference, bundled JetBrains Mono fallback at 14pt, native cell metrics, and equal terminal insets.
- **Do** retain underline or surface keyboard focus, current-navigation semantics, the bottom status bar, compact selectable paths, and full identity tooltips.
- **Do** keep policy, boundary, and session details grouped and preserve their actual enabled, disabled, and read-only states.
- **Do** preserve project totals through archive, Trash, and restore, with input, cached input, output, total, and API equivalent visible.
- **Do** show cached-input percentages in parentheses at totals, rows, and prompt requests; keep exact row counts in tooltips.
- **Do** keep the dated API-equivalent note in the Estimated API equivalent disclosure and make assumed, unknown, and unpriced information explicit.
- **Do** show retained Zustand data immediately, update it after persisted changes, and preserve unsaved form fields during refreshes.
- **Do** keep plan checks in the background and verify environment, account, and policy safety when starting or resuming a chat.
- **Do** retain standard HTML dialog behavior, static accessible headings, and the full session title in the usage body.

### Don't:

- **Don't** recreate native shell affordances as web chrome.
- **Don't** import the independent implementation report's styling or Turkish copy into the English application.
- **Don't** switch the sidebar or workspace colors with operating-system appearance.
- **Don't** add sidebar or selected-project Add new project controls, or a demo-creation flow.
- **Don't** add button focus rings, pressed borders, shadows, or movement.
- **Don't** apply Inter to terminal glyphs, bypass the Consolas/JetBrains Mono preference, recolor the terminal, or change its pinned geometry.
- **Don't** let long project identities expand the fixed header or replace full identity tooltips with visible path rows in the library.
- **Don't** run conflicting preparation or account actions in an environment with active terminals. New Chat remains available for parallel chats when ready.
- **Don't** present a split pane, DOM terminal, chip system, or mobile layout as an implemented component.
- **Don't** present API equivalents as ChatGPT subscription charges or missing rates as zero cost.
