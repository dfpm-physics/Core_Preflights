## Choose how cadets do the work

On **Assignments** in the top navigation, open an assignment that is already saved. A new assignment starts with a short form. Save it once. The form stays open and shows **How cadets do this work**.

Pick one of three cards:

- **Questions.** Cadets answer questions you write. If the assignment is answered on the site, select **Open the questions page** to add them. If cadets type a response, you write the questions in the box on the same form.
- **Interactive tutor.** Cadets work through the material in a guided conversation with an AI tutor. Enter the **Tutor id** (lowercase letters, numbers and hyphens) and, when you have it, the **Tutor link**. The id cannot be changed once a link is saved. To use a different tutor, select **Replace this tutor…**.
- **Both (cadets choose).** The assignment has a typed response and the tutor. Each cadet picks one. **What earns credit** says whether both count or only one. When both count, **Once a cadet commits** says whether the cadet may change their mind.

An assignment that is done in person or somewhere else shows no cards. Its **How the work is done** box is under **More options**.

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
