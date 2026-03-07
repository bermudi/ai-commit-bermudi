# Conventional Commits Specification 2.0.1 (Unofficial)

## Summary

The Conventional Commits specification is a lightweight convention on top of commit messages. It provides an easy set of rules for creating an explicit commit history, making it easier to write automated tools on top of. This convention dovetails with SemVer by describing the features, fixes, and breaking changes made in commit messages.

The commit message structure remains:

```
<type>[optional scope]!: <description>

[optional body]

[optional footer(s)]
```

The commit contains the following structural elements, to communicate intent to the consumers of your library:

- **fix:** a commit of the type `fix` patches a bug in your codebase (this correlates with **PATCH** in Semantic Versioning).
- **feat:** a commit of the type `feat` introduces a new feature to the codebase (this correlates with **MINOR** in Semantic Versioning).
- **spec:** a commit of the type `spec` modifies requirements, architecture, or design documents (this correlates with **MINOR** if adding capabilities, **PATCH** if clarifying).
- **BREAKING CHANGE:** a commit that appends a `!` after the type/scope introduces a breaking API change (correlating with **MAJOR** in Semantic Versioning). A BREAKING CHANGE can be part of commits of any type.
- **types other than fix: and feat:** are allowed. This specification recommends `build:`, `chore:`, `ci:`, `docs:`, `style:`, `refactor:`, `perf:`, `test:`, `i18n:`, and `spec:`.
- **footers other than BREAKING CHANGE:** may be provided and follow a convention similar to [git trailer format](https://git-scm.com/docs/git-interpret-trailers). The `BREAKING CHANGE:` footer is OPTIONAL. 

Additional types are not mandated by this specification, and have no implicit effect in Semantic Versioning (unless they include a BREAKING CHANGE). A scope may be provided to a commit's type, to provide additional contextual information and is contained within parenthesis, e.g., `feat(parser): add ability to parse arrays`.

---

## Quick Reference

### Recommended Types

| Type | Emoji | Purpose | SemVer Impact |
|------|-------|---------|---------------|
| `feat` | New feature | MINOR |
| `fix` | Bug fix | PATCH |
| `spec` | Requirements, architecture, or design docs | MINOR/PATCH* |
| `perf` | ⚡️ | Performance improvement | PATCH |
| `docs` | Documentation only | - |
| `style` | Code style/formatting | - |
| `refactor` | ♻️ | Code refactoring | - |
| `test` | Tests | - |
| `build` | 📦 | Build system/dependencies | - |
| `ci` | CI/CD configuration | - |
| `chore` | 🔧 | Other changes | - |
| `i18n` | 🌐 | Internationalization | - |
| `revert` | ↩️ | Revert previous commit | * |

**Note:** Any type with `!` = MAJOR version bump.

### Format Template

```
<type>(<scope>): <subject>

<body>

<footer>
```

---

## Examples

### Commit message with description and breaking change footer

```
feat!: allow provided config object to extend other configs

BREAKING CHANGE: `extends` key in config file is now used for extending other config files
```

### Commit message with `!` (mandatory for breaking changes)

```
feat!: send an email to the customer when a product is shipped
```

### Commit message with scope and `!`

```
feat(api)!: send an email to the customer when a product is shipped
```

### Commit message with both `!` and BREAKING CHANGE footer

```
chore!: drop support for Node 6

BREAKING CHANGE: use JavaScript features not available in Node 6.
```

### Commit message with no body (non-breaking)

```
docs: correct spelling of CHANGELOG
```

### Commit message with scope (non-breaking)

```
feat(lang): add Polish language
```

### Commit message with multi-paragraph body and multiple footers

```
fix: prevent racing of requests

- Introduce a request id and a reference to latest request.
- Dismiss incoming responses other than from latest request.

Remove timeouts which were used to mitigate the racing issue but are
obsolete now.

Reviewed-by: Z
```

### Revert commit

```
revert: let us never again speak of the noodle incident

Refs: 676104e, a215868
```

### Specification commit

```
spec(auth): define password reset requirements

- user must receive email within 30 seconds
- token expires after 15 minutes
- maximum 3 reset attempts per hour

```

---

## Specification

The key words "MUST", "MUST NOT", "REQUIRED", "SHALL", "SHALL NOT", "SHOULD", "SHOULD NOT", "RECOMMENDED", "MAY", and "OPTIONAL" in this document are to be interpreted as described in [RFC 2119](https://www.ietf.org/rfc/rfc2119.txt).

1. Commits MUST be prefixed with a type, which consists of a noun, `feat`, `fix`, etc., followed by the OPTIONAL scope, OPTIONAL `!`, and REQUIRED terminal colon and space.

2. The type `feat` MUST be used when a commit adds a new feature to your application or library.

3. The type `fix` MUST be used when a commit represents a bug fix for your application.

4. The type `spec` MAY be used when a commit modifies requirements, architecture, or design files (e.g., ADRs, RFCs, or similar decision records).

5. A scope MAY be provided after a type. A scope MUST consist of a noun describing a section of the codebase surrounded by parenthesis, e.g., `fix(parser):`. The scope SHOULD be written in English. For specification-driven workflows, the scope `impl` MAY be used when the commit strictly implements a previously defined specification.

6. A description MUST immediately follow the colon and space after the type/scope prefix. The description is a short summary of the code changes.
   - It MUST be written in the imperative mood, present tense (e.g., "add feature" not "added feature" or "adds feature").
   - It MUST NOT be capitalized (e.g., "fix bug" not "Fix bug").
   - It MUST NOT end with a period.
   - It SHOULD NOT exceed 50 characters in length.
   - Example: `fix(parser): correctly parse arrays with multiple spaces`

7. A longer commit body MAY be provided after the short description, providing additional contextual information about the code changes. The body MUST begin one blank line after the description.
   - Lines in the commit body SHOULD NOT exceed 72 characters.
   - Bullet points are RECOMMENDED for lists and MUST use a hyphen (`-`) followed by a space.
   - A commit body is free-form and MAY consist of any number of newline separated paragraphs.
   - Simple changes that would only restate the subject SHOULD omit the body and any footers; a concise header-only commit is RECOMMENDED in these cases.

8. One or more footers MAY be provided one blank line after the body. Each footer MUST consist of a word token, followed by either a `:<space>` or `<space>#` separator, followed by a string value (this is inspired by the [git trailer convention](https://git-scm.com/docs/git-interpret-trailers)). Footers like Refs:, Closes:, or Issue: are recommended for linking to external resources (such as issue trackers, Pull Requests, or discussion forums) 

9. A footer's token MUST use `-` in place of whitespace characters, e.g., `Acked-by` (this helps differentiate the footer section from a multi-paragraph body). An exception is made for `BREAKING CHANGE`, which MAY also be used as a token.

10. A footer's value MAY contain spaces and newlines, and parsing MUST terminate when the next valid footer token/separator pair is observed.

11. Breaking changes MUST be indicated by a `!` immediately before the `:` in the type/scope prefix. e.g., `feat(api)!:`.

12. A breaking change description MAY be provided as a footer, which MUST consist of the uppercase text `BREAKING CHANGE`, followed by a colon, space, and description, e.g., `BREAKING CHANGE: environment variables now take precedence over config files`. This footer is OPTIONAL.

13. If the `BREAKING CHANGE:` footer is not provided (and the `!` is present as required by rule 11), the commit description SHALL be used to describe the breaking change.

14. Types other than `feat` and `fix` MAY be used in your commit messages. This specification RECOMMENDS the following types: `build:`, `chore:`, `ci:`, `docs:`, `style:`, `refactor:`, `perf:`, `test:`, `i18n:`, and `spec:`.

15. The units of information that make up Conventional Commits MUST NOT be treated as case sensitive by implementors, with the exception of `BREAKING CHANGE` which MUST be uppercase.

16. `BREAKING-CHANGE` MUST be synonymous with `BREAKING CHANGE`, when used as a token in a footer.

---

## Why Use Conventional Commits

- Automatically generating CHANGELOGs.
- Automatically determining a semantic version bump (based on the types of commits landed).
- Communicating the nature of changes to teammates, the public, and other stakeholders.
- Triggering build and publish processes.
- Making it easier for people to contribute to your projects, by allowing them to explore a more structured commit history.
- Enabling AI agents to understand project history and locate relevant specifications when present.

---

## FAQ

### How should I deal with commit messages in the initial development phase?

We recommend that you proceed as if you've already released the product. Typically somebody, even if it's your fellow software developers, is using your software. They'll want to know what's fixed, what breaks etc.

### Are the types in the commit title uppercase or lowercase?

Lowercase. As per Specification rule 6, the description (subject) MUST be lowercase, and the type (e.g., `feat`, `fix`) SHOULD also be lowercase for consistency.

### What do I do if the commit conforms to more than one of the commit types?

Go back and make multiple commits whenever possible. **A single commit MUST represent a single logical change.** Part of the benefit of Conventional Commits is its ability to drive us to make more organized commits and PRs. Formats that combine multiple types into a single commit message are NOT compliant with this specification.

### Doesn't this discourage rapid development and fast iteration?

It discourages moving fast in a disorganized way. It helps you be able to move fast long term across multiple projects with varied contributors.

### Might Conventional Commits lead developers to limit the type of commits they make because they'll be thinking in the types provided?

Conventional Commits encourages us to make more of certain types of commits such as fixes. Other than that, the flexibility of Conventional Commits allows your team to come up with their own types and change those types over time.

### How does this relate to SemVer?

- `fix` type commits should be translated to **PATCH** releases.
- `feat` type commits should be translated to **MINOR** releases.
- Commits with a `!` in the type/scope prefix (indicating a breaking change), regardless of type, should be translated to **MAJOR** releases.
- `perf` type commits SHOULD be translated to **PATCH** releases, as performance improvements are bug fixes.
- `spec` type commits SHOULD be translated to **MINOR** if they add new capabilities, **PATCH** if they clarify existing ones.

### How should I version my extensions to the Conventional Commits Specification?

We recommend using SemVer to release your own extensions to this specification (and encourage you to make these extensions!)

### What do I do if I accidentally use the wrong commit type?

**When you used a type that's of the spec but not the correct type** (e.g. `fix` instead of `feat`): Prior to merging or releasing the mistake, we recommend using `git rebase -i` to edit the commit history. After release, the cleanup will be different according to what tools and processes you use.

**When you used a type not of the spec** (e.g. `feet` instead of `feat`): In a worst case scenario, it's not the end of the world if a commit lands that does not meet the Conventional Commits specification. It simply means that commit will be missed by tools that are based on the spec.

### Do all my contributors need to use the Conventional Commits specification?

No! If you use a squash based workflow on Git, lead maintainers can clean up the commit messages as they're merged—adding no workload to casual committers. A common workflow for this is to have your git system automatically squash commits from a pull request and present a form for the lead maintainer to enter the proper git commit message for the merge.

### How does Conventional Commits handle revert commits?

Reverting code can be complicated: are you reverting multiple commits? if you revert a feature, should the next release instead be a patch?

Conventional Commits does not make an explicit effort to define revert behavior. Instead we leave it to tooling authors to use the flexibility of types and footers to develop their logic for handling reverts.

One recommendation is to use the `revert` type, and a footer that references the commit SHAs that are being reverted:

```
revert: let us never again speak of the noodle incident
```

### Are the 50/72 character limits a hard rule?

The 50-character limit for the subject SHOULD NOT be exceeded, and the 72-character limit for the body SHOULD NOT be exceeded. This is a strong recommendation based on established git best practices for readability in various tools (like `git log` in a standard terminal). While tools will not fail if this is exceeded, it is highly discouraged.

### When should I use `spec:` vs `docs:`?

Use `spec:` for documents that define *requirements* or *decisions* that will govern future code changes (e.g., ADRs, RFCs, API contracts). Use `docs:` for documentation that *describes* existing behavior (e.g., README updates, user guides, inline comments).

---

## Validation Checklist

Before committing, verify:

- [ ] Type is present and lowercase (e.g., `feat`, `fix`, `spec`, `docs`)
- [ ] Description uses imperative mood (e.g., "add" not "added")
- [ ] Description is lowercase and has no trailing period
- [ ] Description is 50 characters or less (strongly recommended)
- [ ] Breaking changes have `!` before the colon
- [ ] Body lines are 72 characters or less (if body present)
- [ ] Bullet points use `-` (if lists present)
- [ ] Commit represents a single logical change
- [ ] `spec:` is used for requirement/design changes (if applicable)

---

**Version:** 2.0.1 (Unofficial)  
**Based on:** Conventional Commits 1.0.0  
**License:** CC BY 3.0

