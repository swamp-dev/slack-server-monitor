---
title: "fix: login page not rendering on mobile Safari"
issue_number: 42
---

The login page fails to render on mobile Safari due to a CSS grid issue. The form fields are invisible but still focusable. This only happens on iOS 17+.

Probably related to the `dvh` unit usage in the shell template.
