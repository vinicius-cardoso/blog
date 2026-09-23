---
title: "I tried the nine rules of object calisthenics on a real project"
description: "What each of the nine object calisthenics rules asks for, a deliberately wrong version next to real code that follows it, and which rules I kept, bent or ignored in a real project."
pubDate: 2026-09-23
lang: "en"
translationOf: "object-calisthenics"
tags: ["python", "typescript", "architecture", "clean-code"]
---

Object calisthenics is a set of nine rules Jeff Bay published in *The
ThoughtWorks Anthology* (2008). They're deliberately extreme: no `else`, no
getters, no class with more than two instance variables. Bay didn't present
them as laws for production code. He presented them as an **exercise**: write a
small project, around a thousand lines, following all nine strictly, and see how
it changes the way you design objects. Like calisthenics for the body, the point
is what the training leaves behind, not doing push-ups forever.

Below, each rule gets a short explanation, a **before** that breaks it, and an
**after** that follows it. The afters come from
[Wiredex](https://github.com/vinicius-cardoso/wiredex), a system I'm building to
manage my hardware parts and projects. Where the code already exists, the after
is copied from the repository. Two rules only matter in the business layer I'm
still building; there the after is the design I'm implementing, **marked as
such**. Every before is a version I wrote to break the rule.

At the end: which rules I kept, which I bent, which I ignored, and why.

## 1. Only one level of indentation per method

Every level of nesting is one more condition you have to hold in your head to
understand the line you're reading. The rule forces you to pull the inner block
out into a function with a name, and the nesting turns into a sentence.

**Before**: pick the interface language from a saved choice or the browser.

```ts
function initialLanguage(browserLanguages: readonly string[]): Language {
  const saved = localStorage.getItem("wiredex.language");
  if (saved === "en" || saved === "pt-BR") {
    return saved;
  } else {
    for (const tag of browserLanguages) {
      if (tag.toLowerCase().startsWith("pt")) {
        return "pt-BR";
      }
    }
    return "en";
  }
}
```

**After**:

```ts
export function initialLanguage(browserLanguages: readonly string[]): Language {
  const saved = preferences.read(LANGUAGE_KEY);
  return isLanguage(saved) ? saved : matchLanguage(browserLanguages);
}
```

The loop didn't disappear. It moved into `matchLanguage`, which does one thing
and can be tested on its own. As a bonus, `preferences.read` wraps
`localStorage`, which throws when the browser blocks site data. The before
version would crash there.

## 2. Don't use the `else` keyword

`else` makes you read both branches to understand either one. A guard clause
handles the unusual case first and gets out, so the normal path reads straight
down with no indentation.

**Before**:

```python
def _docs_path(settings: Settings, path: str) -> str | None:
    if settings.docs_enabled:
        return f"{API_PREFIX}{path}"
    else:
        return None
```

**After**:

```python
def _docs_path(settings: Settings, path: str) -> str | None:
    if not settings.docs_enabled:
        return None
    return f"{API_PREFIX}{path}"
```

The same shape works in any language. This is the light/dark/system theme
resolution on the frontend:

```ts
export function resolveTheme(
  preference: ThemePreference,
  systemPrefersDark: boolean,
): ResolvedTheme {
  if (preference !== "system") return preference;
  return systemPrefersDark ? "dark" : "light";
}
```

## 3. Wrap all primitives and strings

A bare `str` or `int` carries no rules. Any string can go into a parameter
called `email`, and any integer into `quantity`. Wrapping the value in a type
gives the rules a home, and lets the type checker tell apart things that merely
share a representation.

**Before**:

```python
database_url: str = "postgresql+asyncpg://wiredex:wiredex@localhost:5442/wiredex"
```

It works until the settings object gets logged, printed in a traceback or
shown by a debugger, and the password goes with it.

**After**:

```python
# SecretStr keeps the password out of logs and reprs.
database_url: SecretStr = SecretStr(DEFAULT_DATABASE_URL)
```

`SecretStr` prints as `**********`, and getting the real value takes an
explicit `.get_secret_value()`. The type also paid off right away: when I turned
mypy on for the test files, it flagged a test passing a plain string:

```
tests/system/test_readiness.py:62: error: Argument "database_url" to "Settings" has incompatible type "str"; expected "SecretStr"  [arg-type]
```

## 4. First-class collections

A class that holds a collection should hold nothing else. Then the rules about
that collection, such as uniqueness, ordering or limits, live in one place,
instead of being repeated by every function that touches the list.

*Wiredex's bill of materials is still being built. This after is the design.*

**Before**: the list lives inside the revision, and the rule lives in whatever
function adds to it.

```python
def add_line(revision: Revision, line: BomLine) -> None:
    if any(existing.designator == line.designator for existing in revision.bom_lines):
        raise ValueError("duplicate designator")
    revision.bom_lines.append(line)
```

**After**:

```python
class BillOfMaterials:
    def __init__(self, lines: tuple[BomLine, ...] = ()) -> None:
        self._lines = lines

    def with_line(self, line: BomLine) -> "BillOfMaterials":
        if line.designator in self.designators():
            raise DuplicateDesignator(line.designator)
        return BillOfMaterials((*self._lines, line))

    def designators(self) -> frozenset[Designator]:
        return frozenset(line.designator for line in self._lines)
```

Nothing can append a second `R1` any more, because nothing outside the class
can reach the list.

## 5. One dot per line

This is the Law of Demeter in a form you can count. `a.b.c.d()` means your code
knows how three other objects are built inside. When any of them changes, your
code breaks. Talk to your direct collaborators, and let them talk to theirs.

**Before**: a readiness endpoint that reaches through the app state into the
connection pool.

```python
@router.get("/health/ready")
async def ready(request: Request) -> dict[str, str]:
    async with request.app.state.engine.connect() as connection:
        await connection.execute(text("SELECT 1"))
    return {"status": "ready"}
```

**After**: the router asks a use case, and knows nothing about engines.

```python
readiness = await check_readiness()
if not readiness.is_ready:
    response.status_code = status.HTTP_503_SERVICE_UNAVAILABLE
return ReadinessResponse.from_readiness(readiness)
```

The before also has a hidden bug. When the database is down, it raises and
returns a 500 instead of an honest 503.

## 6. Don't abbreviate

An abbreviation saves the writer a few keystrokes and costs every reader a
moment of decoding. Bay adds a sharper point: if a name wants to be long, that's
often because the thing does too much, and the abbreviation hides that.

**Before**: from a deploy script.

```bash
wait_rdy() { for i in $(seq 1 60); do curl -sf "$U" && return 0; sleep 1; done; return 1; }
```

**After**:

```bash
wait_until_ready() {
  for _ in $(seq 1 60); do
    if curl --silent --fail --max-time 2 "$READY_URL" >/dev/null; then return 0; fi
    sleep 1
  done
  return 1
}
```

Long flags count too. `--silent --fail` is readable by someone who has never
opened curl's man page; `-sf` isn't.

## 7. Keep all entities small

Bay's numbers: no class over 50 lines, and no package with more than 10 files. The
exact limits matter less than the pressure they create. A class that can't grow
has to split, and splitting forces you to name the pieces.

**Before**: the class every project grows by accident.

```python
class SystemService:
    def __init__(self, settings, engine, logger, cache, mailer): ...
    def health(self): ...
    def version(self): ...
    def readiness(self): ...
    def export_openapi(self): ...
    def reset_demo_data(self): ...
    # ... and 400 more lines
```

**After**: the same concerns in Wiredex's `system` module, one job per file.

```
system/
├── domain/build_info.py                    11 lines
├── domain/readiness.py                     12 lines
├── application/ports.py                     7 lines
├── application/check_readiness.py          10 lines
├── infrastructure/sql_database_probe.py    22 lines
├── api/schemas.py                          37 lines
└── api/router.py                           33 lines
```

The largest file is 37 lines, and the whole module is 132.

## 8. No classes with more than two instance variables

This is the rule that feels most absurd, and it's the one that teaches the most.
A class with seven fields is usually two or three concepts sharing a room. Capping
it at two forces those concepts out into their own objects.

**Before**:

```python
class DatabaseProbe:
    def __init__(self, engine, timeout, retries, logger, settings, metrics, cache):
        ...
```

**After**:

```python
class SqlDatabaseProbe:
    """DatabaseProbe that runs `SELECT 1`, giving up after a short timeout."""

    def __init__(self, engine: AsyncEngine, timeout_seconds: float = 2.0) -> None:
        self._engine = engine
        self._timeout_seconds = timeout_seconds
```

Retries, logging and metrics weren't dropped. They belong to whoever *uses* the
probe. The probe answers one question: can I run a query right now?

## 9. No getters, setters or properties

Pulling data out of an object, deciding something, and pushing the result back
means the decision lives in the wrong place. Tell the object what you want and
let it enforce its own rules: *tell, don't ask*.

*Wiredex's stock ledger is still being built. This after is the design.*

**Before**:

```python
lot.quantity = lot.quantity - line.quantity
if lot.quantity < 0:
    raise ValueError("not enough stock")
```

Every caller has to remember the check, and one caller that forgets leaves the
stock negative.

**After**:

```python
lot.reserve(line.quantity)  # raises InsufficientStock, records a RESERVE movement
```

Existing Wiredex code already has one nuance. `Readiness.is_ready` *is* a
property, but it doesn't expose a field for someone else to reason with. It
answers a question from the object's own state. That's the kind of property
the rule is fine with.

## Applying it for real: what I kept, bent and ignored

Bay intended the rules for an exercise. In a real system I use them as a strong
default in one place, and as a direction everywhere else.

**Where they apply.** Strictly in the domain layer (business rules in plain
Python), loosely in the use cases, and **not at all** in response schemas, ORM
mappings, React components and tests. Those are data shapes and glue. This
Pydantic schema breaks rule 3 three times, on purpose:

```python
class VersionResponse(BaseModel):
    version: str
    commit: str
    built_at: datetime | None
```

Its job is to become JSON and an OpenAPI schema, and from that schema a
generated TypeScript client. Wrapping the fields would make the client worse and
nothing safer.

**Rules I bend:**

- **Indentation (1):** `matchLanguage` has a loop with `if`s inside, which is two
  levels. `SqlDatabaseProbe.is_reachable` has three: a `try`, then an
  `async with` for the timeout, then an `async with` for the connection. Nested
  context managers read better than split ones, so I enforce a complexity
  budget instead of an indentation count.
- **One dot per line (5):** fluent builders are exempt.
  `select(Part).where(...).order_by(...)` and
  `page.getByRole("button").click()` keep talking to the same object; they don't
  reach through strangers.
- **Abbreviations (6):** the domain's own terms stay short. BOM, MPN, GPIO and I²C
  are how hardware people talk, and spelling them out would make the code
  *less* familiar to them.
- **Two instance variables (8):** aspirational. Aggregates like a project
  revision will group their state into value objects rather than count fields.

**Rules a machine enforces.** Rules that live only in a document get forgotten,
so three of them fail the build:

```toml
[tool.ruff.lint.mccabe]
max-complexity = 6   # rule 1, approximately

[tool.ruff.lint.pylint]
max-args = 5         # rule 7, approximately
```

Plus ruff's `RET505`, which is rule 2 exactly. I wrote a deliberately bad
stock-reservation function to watch them fire:

```
$ uv run ruff check src/wiredex/_scratch/reserve.py
src/wiredex/_scratch/reserve.py:1:5: C901 `reserve` is too complex (7 > 6)
src/wiredex/_scratch/reserve.py:1:5: PLR0913 Too many arguments in function definition (6 > 5)
src/wiredex/_scratch/reserve.py:10:5: RET505 [*] Unnecessary `else` after `return` statement
src/wiredex/_scratch/reserve.py:13:9: RET505 [*] Unnecessary `else` after `return` statement
src/wiredex/_scratch/reserve.py:16:13: RET505 [*] Unnecessary `else` after `return` statement
```

These are approximations. Complexity counts branches, not indentation, so a
function can pass and still nest too deep. But CI remembers the budget when I
don't, and the rest is code review.

## The lesson

Do the exercise once, strictly, on something small. That's where the rules
change how you think. Then, in real code, decide *where* they apply before you
write it, let a linter hold the rules it can check, and treat the rest as the
direction your objects should move in, not a checklist.
