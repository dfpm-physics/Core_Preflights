// new-page-guard.js — keeps the older staff pages away from items entered on the newer pages.
//
// An item carries `assignment_offerings.entered_on_new_page`. The flag says WHICH PAGE OWNS THE
// ROW, never what the work is, so nothing here looks at kind, delivery or grading. A preflight
// entered on the newer page is treated exactly like a homework entered there.
//
// What these guards are: a stop for honest mistakes on pages that do not understand such an item.
// They are not access control. A browser tab opened before the deploy has none of this until it
// reloads, and a direct API call ignores it. The database rules are what hold regardless of page.
//
// This module is temporary. When every page handles every item, the lesson editor reads the
// path instead of the flag, the picker, report and health exclusions come out, and the column is
// dropped.
//
// Nothing in this file imports the database client: each function is handed the client, so a test
// can pass a recording stub.

/** The column that says which page owns a row. */
export const NEW_PAGE_COLUMN = 'entered_on_new_page';

/** Where an item entered on the newer page is edited. */
export const NEW_PAGE_HREF = 'items.html';

/** True for a raw row (snake case) or a shaped lesson (camel case) that the newer page owns. */
export function isNewPageItem(x) {
  return !!x && (x[NEW_PAGE_COLUMN] === true || x.enteredOnNewPage === true);
}

/** The sentence shown when an old page declines to act on such an item. */
export function newPageMessage(action) {
  return `This item was entered on the newer page, so this page will not ${action} it. ` +
         `Open it on the newer page (${NEW_PAGE_HREF}) instead. Nothing was changed.`;
}

/**
 * The plain sentence for one publish refusal, or null for any other error.
 *
 * Publishing an item whose course offering is not active is refused by the database rule
 * `assignment_offerings_publish_needs_active`, whose own message carries an id and the rule name.
 * A director needs the reason, not the rule name; the caller logs the raw error.
 */
export function publishRefusalMessage(error) {
  if (/assignment_offerings_publish_needs_active/.test(String(error?.message || ''))) {
    return 'This term is not active, so its lessons cannot be published.';
  }
  return null;
}

/** The error object the editor functions return, in the same shape the database client uses. */
export function newPageError(action) {
  return { message: newPageMessage(action), code: 'new_page_item' };
}

/** A database error that only means the column does not exist yet, which means no row has the flag. */
function columnMissing(error) {
  if (!error) return false;
  if (error.code === '42703') return true;
  const text = String(error.message || '');
  return text.includes(NEW_PAGE_COLUMN) && /does not exist|schema cache|could not find/i.test(text);
}

/**
 * Whether an offering is owned by the newer page, read fresh from the database.
 *
 * Returns true, false, or throws nothing: a failed read returns `null`, which callers treat as
 * "cannot tell" and refuse on. A missing column returns false, because with no column no item can
 * carry the flag.
 */
export async function offeringIsNewPage(db, offeringId) {
  if (!offeringId) return false;
  const { data, error } = await db.from('assignment_offerings')
    .select(NEW_PAGE_COLUMN).eq('id', offeringId).maybeSingle();
  if (error) return columnMissing(error) ? false : null;
  return data ? data[NEW_PAGE_COLUMN] === true : false;
}

/**
 * The refusal for an action on an existing offering, or null when the action may go ahead.
 *
 * Call it before the first write. `known` is an already loaded lesson or row; if that says the
 * newer page owns it there is no need to ask again.
 *
 * @returns {Promise<null | { error: { message: string, code: string } }>}
 */
export async function refuseIfNewPage(db, offeringId, action, known = null) {
  if (isNewPageItem(known)) return { error: newPageError(action) };
  const owned = await offeringIsNewPage(db, offeringId);
  if (owned === true) return { error: newPageError(action) };
  if (owned === null) {
    return { error: { message: `Could not check which page owns this item, so this page will not ` +
                               `${action} it. Reload and try again. Nothing was changed.`,
                      code: 'new_page_unknown' } };
  }
  return null;
}

/**
 * Narrow an assignment_offerings query to items the older pages understand.
 * The Grade picker, the Report list and the Health page use it.
 */
export function withoutNewPageItems(query) {
  return query.eq(NEW_PAGE_COLUMN, false);
}
