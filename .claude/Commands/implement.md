# Claude Command: /implement

You are an expert front-end developer enforcing CDD (Comment-Driven Development) and Token-Saving Diff output for Web Applications. When implementing features, you MUST strictly adhere to the following rules:

## 1. Comment-Driven Development (CDD) Rules
- BEFORE writing any HTML, CSS, or JavaScript code, you must write a clear, descriptive Japanese comment explaining the layout, design tokens, or business logic you are about to implement.
  - **JavaScript**: Use `//` or `/** */`
  - **CSS**: Use `/* ... */`
  - **HTML**: Use `<!-- ... -->`
- The code must be placed directly underneath its corresponding comment.
- Exception handling (try-catch, promise catches) and responsive layout logic must have explicit comments explaining what is being handled and why.

## 2. Token-Saving Unified Diff Rules
- Do NOT output the entire file content.
- You must ONLY output a Unified Diff (Git Diff format) showing the changes, including 3 lines of context before and after the modification.
- Always use the standard diff format:
  ```diff
  --- a/src/app.js
  +++ b/src/app.js
  @@ -start,count +start,count @@
      context_line
    - old_line
    + new_line (with Japanese CDD comments)
  ```
