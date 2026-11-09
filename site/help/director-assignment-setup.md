## Choose how cadets do the work

On **Assignments** in the top navigation, select **+ New assignment** or open one that is already saved. Under the title, kind and points the form shows **How cadets do this work**. The choices depend on the kind of assignment. The ⓘ beside the heading explains each one.

### Preflights and case studies

Pick one of four cards:

- **AI-graded questions.** Cadets answer in writing. The AI drafts the marks overnight and you review them. You write the questions in the box on the same form.
- **Instructor-graded questions.** The same typed answers, marked by an instructor.
- **Interactive tutor.** Cadets work through the material in a guided conversation with an AI tutor, and are graded on effort.
- **Both (cadets choose).** The assignment has AI-graded questions and the tutor. Each cadet picks one. **What earns credit** says whether both count or only one. When both count, **Once a cadet commits** says whether the cadet may change their mind.

### Every other kind of assignment

Pick one of three cards:

- **In class.** Done in person. Staff type in the scores.
- **Auto-graded questions.** Cadets answer on the site and it is marked for them. Only homework offers this. On any other kind the card is grayed out, and hovering over it says why. Select **Open the questions page** to add the questions.
- **Done elsewhere.** Done in another system, such as WebAssign or Gradescope. You import the scores.

A new assignment starts on the card that suits its kind. Changing the kind of a new assignment picks that kind's cards again.

### An assignment you saved earlier

It opens showing the setting it has. If that setting is not one of the cards for its kind, a card called **Current setting** is shown and a line says it is an older setting. Opening it changes nothing. Only selecting a card changes it. Any other combination is under **How the work is done** and **How it is graded** in **More options**.

A saved assignment cannot switch to or from **Auto-graded questions**. On such an assignment the cards that would do that are grayed out, and hovering over one says: "A saved assignment cannot switch to or from auto-graded questions. Make a new assignment instead." Make a new assignment with the setting you want, and remove the old one if you no longer need it.

### A link from a tutor builder

A link that carries a tutor opens a new assignment already on a card. A link that asks for the tutor alone opens on **Interactive tutor**. Any other link with a tutor opens on **Both**, which is AI-graded questions plus the tutor. If the card is AI-graded, a note under the cards tells you when a question worth points has no description of a good answer yet: add one to each, because the AI draft is checked against it. A link never changes an assignment you already saved this way.

### Set up a tutor from a file

When the card is **Interactive tutor** or **Both**, a box says **Drop the tutor setup file here**. Drop the file your AI tutor builder gave you, or select **Choose file**. The page fills in the tutor id, link, title and description, lists what it read, and keeps the tutor's objectives for the next save. Nothing is saved until you select **Save assignment**. If the file is wrong, the page says what is wrong and changes nothing: for example a file for a different course, or one that is not a tutor setup file.

To type the details yourself, open **Enter the details by hand**. Enter the **Tutor id** (lowercase letters, numbers and hyphens) and, when you have it, the **Tutor link**. The id cannot be changed once a link is saved. To use a different tutor, select **Replace this tutor…**.

Add the questions before you publish. The page does not let you publish an assignment that has none.

## Write an expression question

An expression question has an answer such as `m*v^2/2`. The site marks it with fixed rules. No AI marks it.

1. On the Questions page, select **+ Add a question**.
2. Set the format to **Expression (symbolic)**.
3. In **Expected expression**, type the correct answer.
4. In **Variables an answer may use**, list the names, separated by commas. Use one to eight names. Each starts with a letter.
5. Optional: in **Variables that can be negative**, list any variable that can be below zero, such as a position or a charge.
6. Optional: in **Try an answer**, type a trial answer and select **Show how it is read**. Nothing is saved.

The expected expression can use `+ - * / ^`, round brackets, and these functions: sin, cos, tan, asin, acos, atan, sinh, cosh, tanh, sqrt, exp, ln, log10 and abs.

### How an answer is marked

The site works out the cadet's answer and your expression at the same fixed values and compares the numbers. So `x*2`, `2x` and `2*x` are the same answer, and `(x+1)^2` and `x^2+2x+1` are both right. It does not check that an answer is simplified.

- Every variable is tried on positive values only. A variable you list as able to be negative is tried on negative values too. With positive values only, `sqrt(x^2)` matches `x`.
- A difference smaller than about one part in a billion is not seen.
- Units, vectors and equations are not read. An answer is at most 200 characters.
- An answer the site cannot read is refused with a message. It costs the cadet no try.
- The key stays on the server. A cadet's browser never receives your expression.

### How a fraction is read

`1/2 m v^2` is read as one half times m times v squared. A plain number over a plain number, then a space, then the rest, is read that way.

Without the space, `1/2x` is refused, because it could mean two things. A cadet writes `1/(2*x)` or `(1/2)*x`. A fraction of two letters followed by more, such as `a/b c`, is also refused.

Powers group from the right, so `x^2^3` is `x^(2^3)`.

### The letters e and pi

In an expression, `e` and `pi` are the numbers 2.718… and 3.14159…. If you list `e` or `pi` in **Variables an answer may use**, it is your variable in that question. The number is then not available in the answer or the key, and the cadet's page shows a button for your variable.

A Greek letter and its Latin spelling, such as theta, count as one name. Listing both is refused.

### Many expression questions from a file

Select **Upload a problem file** and use a CSV file. For an expression row, set the `type` column to `expression` and fill these columns:

- `expression`: the expected expression.
- `variables`: the names an answer may use, separated by `|`.
- `signed_variables`: optional, the ones also tried at negative values.

A formula cannot start with `=`, `+`, `-` or `@`. Write `0-x` or `(-x)*y` instead. Select **Check the file (dry run)** first. It shows how each expression is read, and it saves nothing. If any row is wrong, nothing is saved.

### Check answers an AI model wrote

An AI model can get an answer wrong. If an AI model wrote the answers in a file, a person must check each one before the assignment can be published. In the file, the `written_by` column says who wrote them. If the file has no such column, the page asks.

1. On the Questions page, select **Check them now** in the notice.
2. Work each problem yourself.
3. Tick a row only when you agree with the question, the answer and the range of answers that will be marked right.
4. Select **Mark the ticked answers as checked**.

Once every AI-written answer is checked, the notice no longer appears.

## Fix an expression question the Health page lists

**System health** is in the user menu and is open to directors. One of its lines is **Published expression question whose answer key cannot be read**.

The line means a published question has an expected expression or variable list that the checker cannot use. A cadet who answers it is told the question has a fault. Nothing is marked and no try is used, so the question cannot be worked at all.

Each row names the course, the assignment, the question and what is wrong with the key.

1. On **System health**, select the link on the row. It opens the assignment.
2. Open the Questions page and open that question.
3. Correct the expected expression or the variable list, then save.
4. Reload **System health**. The question leaves the list once its key reads.

The link opens the assignment, not the question, so look for the question named on the row.

If the line says the list could not be read, nothing has been checked. Reload the page. If the message stays, tell whoever manages the database.

## What an instructor sees on Assignments

An instructor can open **Assignments** and read it: the list, each row's dates and state, and the **Grade**, **Report** and **Launch tutor** buttons. They see only published assignments. They get no **New assignment**, **Edit** or **Remove**, and the page says that only directors change assignments. The database refuses an instructor's changes whatever the page shows.

Every assignment is edited here, including the ones entered on the older page. The older address, `lessons.html`, now forwards to this page, so an old bookmark or a link from an AI tutor build still lands in the right place. An assignment with cadet work can be removed from this page too: it asks you to hold a button for five seconds, after telling you how many submissions, grades and tutor reports go with it.
